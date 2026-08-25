import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, ArrowRight } from "lucide-react";
import logo from "@/assets/hitrotech-logo.png.asset.json";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — HitroTech Telecom OrderScan" },
      { name: "description", content: "Choose a new password for your HitroTech OrderScan account." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Supabase handles the recovery token in the URL hash and sets a session.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    if (password !== confirmPassword) return toast.error("Passwords do not match");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated — signing you in");
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="min-h-screen w-full bg-slate-100 flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 md:p-10 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-[#e63946] to-[#f4a261]">
            <img src={logo.url} alt="HitroTech" className="h-8 w-8 object-contain" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-lg font-bold text-slate-900">HitroTech</div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-slate-500">OrderScan</div>
          </div>
        </div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Choose a new password</h1>
        <p className="mt-2 text-sm text-slate-500">
          {ready ? "Enter a new password below." : "Verifying your reset link..."}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-800">New password</label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!ready}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-11 text-slate-900 outline-none transition-all focus:border-[#e63946] focus:ring-2 focus:ring-[#e63946]/15 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 hover:text-slate-600"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-800">Re-enter password</label>
            <input
              type={showPw ? "text" : "password"}
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={!ready}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition-all focus:border-[#e63946] focus:ring-2 focus:ring-[#e63946]/15 disabled:opacity-60"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !ready}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#e63946] to-[#f4a261] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(230,57,70,0.5)] transition-all hover:shadow-[0_14px_36px_-10px_rgba(230,57,70,0.65)] active:scale-[0.98] disabled:opacity-70"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Update password
            {!loading && <ArrowRight className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}
