import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/ext-client";
import { lookupInvite } from "@/lib/workspace-members.functions";
import { toast } from "sonner";
import { ArrowRight, Eye, EyeOff, Loader2, Mail } from "lucide-react";
import logo from "@/assets/hitrotech-logo.png.asset.json";

async function callOtp(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("otp-handler", { body: payload });
  if (error) {
    // Edge function returned non-2xx; try to surface the JSON error message
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = await ctx.json();
        if (body?.error) throw new Error(body.error);
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
      }
    }
    throw new Error(error.message || "Request failed");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}


export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — HitroTech Telecom OrderScan" },
      { name: "description", content: "Sign in to HitroTech Telecom OrderScan to extract telecom order data from screenshots." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { invite?: string } => ({
    invite: typeof s.invite === "string" ? s.invite : undefined,
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup";
type SignupStep = "form" | "verify";
type SigninStep = "form" | "twofa";
type ForgotStep = "email" | "verify";

function getPasswordIssue(password: string) {
  if (password.length < 12) return "Password must be at least 12 characters";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return "Use uppercase, lowercase, a number, and a symbol";
  }
  return null;
}

async function landingRouteForCurrentUser(): Promise<"/portal" | "/dashboard" | "/superadmin"> {
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) return "/dashboard";
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userRes.user.id);
  const rs = (roles ?? []).map((r) => r.role);
  if (rs.includes("super_admin" as any)) return "/superadmin";
  // Check workspace role
  const { data: prof } = await supabase.from("profiles").select("active_workspace_id").eq("id", userRes.user.id).maybeSingle();
  if (prof?.active_workspace_id) {
    const { data: mem } = await supabase.from("workspace_members").select("role").eq("user_id", userRes.user.id).eq("workspace_id", prof.active_workspace_id).maybeSingle();
    if (mem?.role === "partner") return "/portal";
  }
  return "/dashboard";
}


function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const inviteEmail = search.invite;
  const lookupFn = useServerFn(lookupInvite);
  const [inviteInfo, setInviteInfo] = useState<{ workspaceName: string; role: string } | null>(null);

  const [mode, setMode] = useState<Mode>(inviteEmail ? "signup" : "signin");
  const [email, setEmail] = useState(inviteEmail ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const [signupStep, setSignupStep] = useState<SignupStep>("form");
  const [signupCode, setSignupCode] = useState("");
  const [signinStep, setSigninStep] = useState<SigninStep>("form");
  const [twoFaCode, setTwoFaCode] = useState("");

  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState<ForgotStep>("email");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotSending, setForgotSending] = useState(false);

  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoverySending, setRecoverySending] = useState(false);

  const RESEND_COOLDOWN_SECONDS = 120;
  const [resendIn, setResendIn] = useState(0);
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  const doSendSignupOtp = (data: { email: string; password: string; fullName: string }) =>
    callOtp({ action: "send-signup", ...data });
  const doVerifySignupOtp = (data: { email: string; code: string }) =>
    callOtp({ action: "verify-signup", ...data });
  const doSendResetOtp = (data: { email: string }) => callOtp({ action: "send-reset", ...data });
  const doVerifyResetOtp = (data: { email: string; code: string; newPassword: string }) =>
    callOtp({ action: "verify-reset", ...data });


  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) { const to = await landingRouteForCurrentUser(); navigate({ to, replace: true }); }
    });
  }, [navigate]);

  // Look up invite context so we can show "You're joining X"
  useEffect(() => {
    if (!inviteEmail) return;
    lookupFn({ data: { email: inviteEmail } })
      .then((r) => { if (r.found) setInviteInfo({ workspaceName: r.workspaceName, role: r.role }); })
      .catch(() => { /* silent */ });
  }, [inviteEmail, lookupFn]);


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    if (mode === "signin") {
      // Validate password by signing in first.
      const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setLoading(false); return toast.error(error.message); }
      // Check if email 2FA is required for this account.
      const uid = signInData.user?.id;
      let need2fa = false;
      if (uid) {
        const { data: prof } = await supabase.from("profiles").select("email_2fa_enabled").eq("id", uid).maybeSingle();
        need2fa = !!prof?.email_2fa_enabled;
      }
      if (need2fa) {
        // Sign out the interim session and require the emailed code before granting access.
        await supabase.auth.signOut();
        try {
          await callOtp({ action: "send-login-2fa", email: email.trim().toLowerCase() });
          toast.success("We sent a 6-digit sign-in code to your email");
          setSigninStep("twofa");
          setResendIn(RESEND_COOLDOWN_SECONDS);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not send code");
        } finally {
          setLoading(false);
        }
        return;
      }
      setLoading(false);
      toast.success("Welcome back");
      { const to = await landingRouteForCurrentUser(); navigate({ to, replace: true }); }
    } else {
      if (password !== confirmPassword) {
        setLoading(false);
        return toast.error("Passwords do not match");
      }
      const passwordIssue = getPasswordIssue(password);
      if (passwordIssue) {
        setLoading(false);
        return toast.error(passwordIssue);
      }
      try {
        await doSendSignupOtp({ email: email.trim().toLowerCase(), password, fullName: name.trim() });
        toast.success("We sent a 6-digit code to your email");
        setSignupStep("verify");
        setResendIn(RESEND_COOLDOWN_SECONDS);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Signup failed. Please try again.");
      } finally {
        setLoading(false);
      }
    }
  }

  async function handleVerifyLogin2fa(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await callOtp({ action: "verify-login-2fa", email: email.trim().toLowerCase(), code: twoFaCode.trim() });
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw error;
      toast.success("Welcome back");
      setSigninStep("form"); setTwoFaCode("");
      { const to = await landingRouteForCurrentUser(); navigate({ to, replace: true }); }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleResendLogin2fa() {
    if (resendIn > 0) return;
    setLoading(true);
    try {
      await callOtp({ action: "send-login-2fa", email: email.trim().toLowerCase() });
      toast.success("A new code was sent");
      setResendIn(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resend code");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifySignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await doVerifySignupOtp({ email: email.trim().toLowerCase(), code: signupCode.trim() });
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw error;
      toast.success("Account verified — welcome!");
      // Fresh signups (no invite) land on onboarding to name their workspace.
      // Invite-based signups skip onboarding and go to their normal landing.
      if (inviteEmail) {
        const to = await landingRouteForCurrentUser();
        navigate({ to, replace: true });
      } else {
        navigate({ to: "/onboarding", replace: true });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleResendSignup() {
    if (resendIn > 0) return;
    setLoading(true);
    try {
      await doSendSignupOtp({ email: email.trim().toLowerCase(), password, fullName: name.trim() });
      toast.success("A new code was sent");
      setResendIn(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not resend code");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setForgotSending(true);
    try {
      await doSendResetOtp({ email: forgotEmail.trim().toLowerCase() });
      toast.success("If that email exists, we sent a 6-digit code");
      setForgotStep("verify");
      setResendIn(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send reset code");
    } finally {
      setForgotSending(false);
    }
  }

  async function handleResendForgot() {
    if (resendIn > 0) return;
    setForgotSending(true);
    try {
      await doSendResetOtp({ email: forgotEmail.trim().toLowerCase() });
      toast.success("A new code was sent");
      setResendIn(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not resend code");
    } finally {
      setForgotSending(false);
    }
  }

  async function handleForgotVerifySubmit(e: React.FormEvent) {
    e.preventDefault();
    const issue = getPasswordIssue(forgotNewPassword);
    if (issue) return toast.error(issue);
    setForgotSending(true);
    try {
      await doVerifyResetOtp({
        email: forgotEmail.trim().toLowerCase(),
        code: forgotCode.trim(),
        newPassword: forgotNewPassword,
      });

      toast.success("Password updated — you can sign in now");
      setForgotOpen(false);
      setForgotStep("email");
      setForgotCode("");
      setForgotNewPassword("");
      setPassword("");
      setEmail(forgotEmail.trim().toLowerCase());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reset password");
    } finally {
      setForgotSending(false);
    }
  }

  async function handleUseRecoveryCode(e: React.FormEvent) {
    e.preventDefault();
    setRecoverySending(true);
    try {
      const res = await callOtp({
        action: "use-recovery-code",
        email: recoveryEmail.trim().toLowerCase(),
        code: recoveryCode.trim(),
      });
      const hashedToken = res?.hashedToken as string | undefined;
      if (!hashedToken) throw new Error("Could not establish a session");
      const { error } = await supabase.auth.verifyOtp({ token_hash: hashedToken, type: "magiclink" });
      if (error) throw error;
      toast.success("Signed in — 2FA has been reset. Please re-enroll from Settings.");
      setRecoveryOpen(false);
      setRecoveryEmail(""); setRecoveryCode("");
      setSigninStep("form"); setTwoFaCode("");
      const to = await landingRouteForCurrentUser();
      navigate({ to, replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid recovery code");
    } finally {
      setRecoverySending(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    // Full-page redirect to Google, then back to this origin. Supabase-js
    // detects the session in the redirect URL automatically on load; the
    // getSession() effect above then routes the user to their landing page.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { 
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          prompt: 'select_account'
        }
      },
    });
    if (error) {
      setLoading(false);
      toast.error(error.message ?? "Google sign-in failed");
    }
    // On success the browser navigates away — nothing else to do here.
  }

  const isSignin = mode === "signin";
  const inVerifyStep = mode === "signup" && signupStep === "verify";
  const inTwoFaStep = mode === "signin" && signinStep === "twofa";

  return (
    <div className="min-h-screen w-full bg-background flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-6xl grid md:grid-cols-2 rounded-2xl overflow-hidden shadow-2xl bg-card min-h-[720px] border border-border/50">
        {/* Brand panel */}
        <div className="relative overflow-hidden p-10 md:p-14 flex flex-col justify-center text-primary-foreground gradient-brand">
          <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]" />
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 20%, var(--brand), transparent 70%), radial-gradient(circle at 80% 80%, var(--brand-3), transparent 70%)",
            }}
          />

          <div className="relative space-y-6 max-w-md">
            <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight">
              {isSignin ? "Welcome back" : "Get started"}
            </h1>
            <p className="text-primary-foreground/80 leading-relaxed">
              {isSignin
                ? "Sign in to continue managing telecom order screenshots with HitroTech OrderScan."
                : "Create your HitroTech account to start extracting telecom orders in seconds."}
            </p>
            <ul className="space-y-3 pt-2">
              {["AI-powered order extraction", "Duplicate & anomaly detection", "One-click Excel & PDF export"].map((item) => (
                <li key={item} className="flex items-center gap-3 text-primary-foreground/90">
                  <span className="h-1.5 w-1.5 rounded-full bg-card" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative grid grid-cols-3 gap-6 pt-8 mt-10 border-t border-white/15">
            <div>
              <div className="font-display text-2xl font-bold">99%+</div>
              <div className="text-xs text-primary-foreground/60 uppercase tracking-wider font-medium">Accuracy</div>
            </div>
            <div className="border-l border-white/20 pl-6">
              <div className="font-display text-2xl font-bold">Bulk</div>
              <div className="text-xs text-primary-foreground/60 uppercase tracking-wider font-medium">Batch upload</div>
            </div>
            <div className="border-l border-white/20 pl-6">
              <div className="font-display text-2xl font-bold">AI-First</div>
              <div className="text-xs text-primary-foreground/60 uppercase tracking-wider font-medium">Extraction engine</div>
            </div>
          </div>
        </div>


        {/* Form panel */}
        <div className="relative bg-card p-8 md:p-14 flex flex-col">
          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-muted-foreground">
              {isSignin ? "Don't have an account?" : "Already have an account?"}
            </span>
            <button
              type="button"
              onClick={() => {
                setMode(isSignin ? "signup" : "signin");
                setSignupStep("form");
                setSignupCode("");
              }}
              className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
            >
              {isSignin ? "Sign up" : "Sign in"}
            </button>
          </div>

          <div className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto py-10">
            {inTwoFaStep ? (
              <>
                <h2 className="font-display text-3xl font-bold text-foreground">Two-factor verification</h2>
                <p className="mt-2 text-muted-foreground">
                  Enter the 6-digit code we just emailed to <span className="font-semibold text-foreground">{email}</span>. It expires in 10 minutes.
                </p>
                <form onSubmit={handleVerifyLogin2fa} className="mt-8 space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">6-digit code</label>
                    <input
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      required
                      autoFocus
                      value={twoFaCode}
                      onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      className="w-full rounded-xl border border-border bg-card px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                  </div>
                  <div className="pt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => { setSigninStep("form"); setTwoFaCode(""); }}
                      className="text-sm font-semibold text-muted-foreground hover:text-foreground"
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      onClick={handleResendLogin2fa}
                      disabled={loading || resendIn > 0}
                      className="text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
                    >
                      {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                    </button>
                  </div>
                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={loading || twoFaCode.length !== 6}
                      className="inline-flex items-center gap-2 rounded-full gradient-brand px-8 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
                    >
                      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                      Verify & Sign in
                      {!loading && <ArrowRight className="h-4 w-4 font-bold" />}
                    </button>
                  </div>
                  <div className="pt-1 text-center">
                    <button
                      type="button"
                      onClick={() => { setRecoveryEmail(email); setRecoveryOpen(true); }}
                      className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                    >
                      Lost access to your 2FA? Use a recovery code
                    </button>
                  </div>
                </form>
              </>
            ) : inVerifyStep ? (
              <>
                <h2 className="font-display text-3xl font-bold text-foreground">Enter verification code</h2>
                <p className="mt-2 text-muted-foreground">
                  We sent a 6-digit code to <span className="font-semibold text-foreground">{email}</span>. It expires in 10 minutes.
                </p>
                <form onSubmit={handleVerifySignup} className="mt-8 space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">6-digit code</label>
                    <input
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      required
                      value={signupCode}
                      onChange={(e) => setSignupCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      className="w-full rounded-xl border border-border bg-card px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                  </div>
                  <div className="pt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setSignupStep("form");
                        setSignupCode("");
                      }}
                      className="text-sm font-semibold text-muted-foreground hover:text-foreground"
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      onClick={handleResendSignup}
                      disabled={loading || resendIn > 0}
                      className="text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
                    >
                      {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                    </button>
                  </div>
                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={loading || signupCode.length !== 6}
                      className="inline-flex items-center gap-2 rounded-full gradient-brand px-8 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
                    >
                      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                      Verify & Sign in
                      {!loading && <ArrowRight className="h-4 w-4 font-bold" />}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <h2 className="font-display text-3xl font-bold text-foreground">
                  {inviteInfo ? `Join ${inviteInfo.workspaceName}` : isSignin ? "Welcome back" : "Create your account"}
                </h2>
                <p className="mt-2 text-muted-foreground">
                  {inviteInfo
                    ? <>You've been invited as <span className="font-semibold text-foreground">{inviteInfo.role}</span>. Create your account to accept.</>
                    : isSignin
                    ? "Enter your credentials below to access your dashboard."
                    : "Fill in the details below to get started."}
                </p>

                {inviteEmail && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                    <Mail className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
                    <div className="text-xs text-amber-900 leading-snug">
                      Sign up using <span className="font-semibold">{inviteEmail}</span> to be added automatically.
                    </div>
                  </div>
                )}


                <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                  {mode === "signup" && (
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-foreground">Full name</label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="HitroTech Telecom"
                        className="w-full rounded-xl border border-border bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/15"
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">Email address</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      readOnly={!!inviteEmail}
                      placeholder="telecom@hitrotech.com"
                      className={`w-full rounded-xl border border-border bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/15 ${inviteEmail ? "bg-muted cursor-not-allowed" : ""}`}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">Password</label>
                    <div className="relative">
                      <input
                        type={showPw ? "text" : "password"}
                        required
                        minLength={mode === "signup" ? 12 : undefined}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={mode === "signup" ? "12+ chars, Aa1!" : "••••••••••••"}
                        className="w-full rounded-xl border border-border bg-card px-4 py-3 pr-11 text-foreground placeholder:text-muted-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/15"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((v) => !v)}
                        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground hover:text-muted-foreground"
                        aria-label={showPw ? "Hide password" : "Show password"}
                      >
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {!isSignin && (
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-foreground">Re-enter password</label>
                      <input
                        type={showPw ? "text" : "password"}
                        required
                        minLength={12}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full rounded-xl border border-border bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/15"
                      />
                      {confirmPassword.length > 0 && confirmPassword !== password && (
                        <p className="text-xs font-medium text-destructive">Passwords do not match</p>
                      )}
                    </div>
                  )}

                  {isSignin && (
                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={remember}
                          onChange={(e) => setRemember(e.target.checked)}
                          className="h-4 w-4 rounded border-border text-foreground focus:ring-primary/30"
                        />
                        Remember me
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setForgotEmail(email);
                          setForgotStep("email");
                          setForgotCode("");
                          setForgotNewPassword("");
                          setForgotOpen(true);
                        }}
                        className="text-sm font-semibold text-muted-foreground hover:text-foreground"
                      >
                        Forgot password?
                      </button>
                    </div>
                  )}

                  <div className="pt-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={loading}
                      className="inline-flex items-center gap-2 rounded-full gradient-brand px-8 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70"
                    >
                      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                      {isSignin ? "Sign In" : "Send verification code"}
                      {!loading && <ArrowRight className="h-4 w-4 font-bold" />}
                    </button>
                  </div>

                  <div className="relative py-3">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-card px-4 text-xs uppercase tracking-widest text-muted-foreground">or</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogle}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-card py-3 text-sm font-medium text-foreground transition-all hover:bg-muted disabled:opacity-70"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                    </svg>
                    Continue with Google
                  </button>
                </form>
              </>
            )}
          </div>

          <div className="flex items-center justify-center gap-3 pb-3">
            <img src={logo.url} alt="HitroTech Telecom" className="h-8 w-auto object-contain" />
            <div className="h-6 w-px bg-border" />
            <img src="/alhameed-logo.png" alt="Al Hameed Telecom" className="h-8 w-auto object-contain" />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} HitroTech Telecom. All rights reserved.
          </p>
        </div>
      </div>

      {forgotOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
          onClick={() => !forgotSending && setForgotOpen(false)}
        >
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {forgotStep === "email" ? (
              <>
                <h3 className="font-display text-xl font-bold text-foreground">Reset your password</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Enter your email and we'll send you a 6-digit code from <span className="font-semibold">no-reply@orders.hitrotech.com</span>.
                </p>
                <form onSubmit={handleForgotEmailSubmit} className="mt-5 space-y-4">
                  <input
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="you@hitrotech.com"
                      className="w-full rounded-xl border border-border bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setForgotOpen(false)}
                      disabled={forgotSending}
                      className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={forgotSending}
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md hover:bg-primary/90 disabled:opacity-70"
                    >
                      {forgotSending && <Loader2 className="h-4 w-4 animate-spin" />}
                      Send code
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <h3 className="font-display text-xl font-bold text-foreground">Enter code & new password</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  We sent a 6-digit code to <span className="font-semibold text-foreground">{forgotEmail}</span>. Codes expire in 10 minutes.
                </p>
                <form onSubmit={handleForgotVerifySubmit} className="mt-5 space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">6-digit code</label>
                    <input
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      required
                      value={forgotCode}
                      onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      className="w-full rounded-xl border border-border bg-card px-4 py-3 text-center text-xl font-mono tracking-[0.4em] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New password</label>
                    <input
                      type="password"
                      required
                      minLength={12}
                      value={forgotNewPassword}
                      onChange={(e) => setForgotNewPassword(e.target.value)}
                      placeholder="12+ chars, Aa1!"
                      className="w-full rounded-xl border border-border bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setForgotStep("email")}
                      disabled={forgotSending}
                      className="text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      onClick={handleResendForgot}
                      disabled={forgotSending || resendIn > 0}
                      className="text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
                    >
                      {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                    </button>
                    <button
                      type="submit"
                      disabled={forgotSending || forgotCode.length !== 6}
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md hover:bg-primary/90 disabled:opacity-60"
                    >
                      {forgotSending && <Loader2 className="h-4 w-4 animate-spin" />}
                      Update password
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {recoveryOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
          onClick={() => !recoverySending && setRecoveryOpen(false)}
        >
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-xl font-bold text-foreground">Sign in with a recovery code</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter one of the recovery codes you saved when you set up 2FA. Using a code will <strong>disable all 2FA</strong> on your account so you can re-enroll from Settings.
            </p>
            <form onSubmit={handleUseRecoveryCode} className="mt-5 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</label>
                <input
                  type="email"
                  required
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  placeholder="you@hitrotech.com"
                  className="w-full rounded-xl border border-border bg-card px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recovery code</label>
                <input
                  type="text"
                  required
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value.toLowerCase())}
                  placeholder="xxxx-xxxx-xxxx"
                  autoComplete="one-time-code"
                  className="w-full rounded-xl border border-border bg-card px-4 py-3 font-mono tracking-wider text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRecoveryOpen(false)}
                  disabled={recoverySending}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={recoverySending || !recoveryEmail || recoveryCode.length < 8}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md hover:bg-primary/90 disabled:opacity-60"
                >
                  {recoverySending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Sign in
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
