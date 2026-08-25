// OTP handler edge function: send + verify 6-digit codes via Resend for signup/reset.
// Runs with service role, so it can create/update auth users and bypass RLS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

const FROM = "HitroTech <no-reply@orders.hitrotech.com>";
const RESEND_API_URL = "https://api.resend.com/emails";
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

async function hashCode(email: string, code: string) {
  return sha256Hex(`${email.toLowerCase()}:${code}`);
}

function validEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 255;
}
function validCode(v: unknown): v is string {
  return typeof v === "string" && /^\d{6}$/.test(v);
}
function validPassword(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length >= 12 &&
    v.length <= 128 &&
    /[a-z]/.test(v) &&
    /[A-Z]/.test(v) &&
    /\d/.test(v) &&
    /[^A-Za-z0-9]/.test(v)
  );
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(email: string) {
  const target = email.trim().toLowerCase();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const u = data.users.find((x) => (x.email ?? "").toLowerCase() === target);
  if (!u) return null;
  return { id: u.id, email_confirmed_at: u.email_confirmed_at ?? null };
}

type OtpPurpose = "signup" | "reset" | "login";
type EmailPurpose = OtpPurpose | "password_change";

/** Generate a formatted recovery code like "a3f9-k2mp-x7qw" (base32-ish, no ambiguous chars). */
function generateRecoveryCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/i/l
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i === 3 || i === 7) out += "-";
  }
  return out;
}

async function hashRecoveryCode(code: string) {
  return sha256Hex(`recovery:${code.trim().toLowerCase()}`);
}

async function getUserFromAuthHeader(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

/** Wipe all 2FA methods for a user (used when a recovery code is consumed, or admin resets). */
async function wipeAllMfa(userId: string) {
  // 1. Email 2FA flag on profile
  await admin.from("profiles").update({ email_2fa_enabled: false }).eq("id", userId);
  // 2. Supabase MFA factors (TOTP)
  try {
    const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId });
    for (const f of factors?.factors ?? []) {
      await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
    }
  } catch (err) {
    console.error("wipeAllMfa: listFactors/deleteFactor failed", err);
  }
  // 3. Recovery codes themselves
  await admin.from("user_recovery_codes").delete().eq("user_id", userId);
}

async function storeCode(email: string, purpose: OtpPurpose, code: string) {
  const normalized = email.trim().toLowerCase();
  await admin
    .from("verification_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("email", normalized)
    .eq("purpose", purpose)
    .is("used_at", null);

  const expires_at = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();
  const { error } = await admin.from("verification_codes").insert({
    email: normalized,
    purpose,
    code_hash: await hashCode(normalized, code),
    expires_at,
  });
  if (error) throw error;
}

async function consumeCode(email: string, purpose: OtpPurpose, code: string) {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await admin
    .from("verification_codes")
    .select("id, code_hash, expires_at, attempts, used_at")
    .eq("email", normalized)
    .eq("purpose", purpose)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  if (new Date(data.expires_at).getTime() < Date.now()) return false;
  if (data.attempts >= MAX_ATTEMPTS) return false;

  const expected = data.code_hash;
  const provided = await hashCode(normalized, code);
  const ok = expected === provided;

  if (!ok) {
    await admin.from("verification_codes").update({ attempts: data.attempts + 1 }).eq("id", data.id);
    return false;
  }
  await admin.from("verification_codes").update({ used_at: new Date().toISOString() }).eq("id", data.id);
  return true;
}

async function sendCodeEmail(email: string, purpose: EmailPurpose, code: string) {
  const heading =
    purpose === "signup" ? "Verify your email"
    : purpose === "password_change" ? "Confirm password change"
    : purpose === "reset" ? "Reset your password"
    : "Your sign-in code";
  const intro =
    purpose === "signup" ? "Use the code below to finish creating your HitroTech account."
    : purpose === "password_change" ? "Use the code below to confirm this password change for your HitroTech account."
    : purpose === "reset" ? "Use the code below to reset your HitroTech password."
    : "Use the code below to finish signing in to HitroTech.";
  const subject =
    purpose === "signup" ? `Your HitroTech verification code: ${code}`
    : purpose === "password_change" ? `Your HitroTech password change code: ${code}`
    : purpose === "reset" ? `Your HitroTech password reset code: ${code}`
    : `Your HitroTech sign-in code: ${code}`;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.06)">
      <tr><td style="background:linear-gradient(135deg,#e63946,#f4a261);padding:22px 28px;color:#fff">
        <div style="font-size:18px;font-weight:700;letter-spacing:.2px">HitroTech Telecom</div>
        <div style="font-size:12px;opacity:.9;text-transform:uppercase;letter-spacing:.2em;margin-top:2px">OrderScan</div>
      </td></tr>
      <tr><td style="padding:32px 28px">
        <h1 style="margin:0 0 8px 0;font-size:22px;color:#0f172a">${heading}</h1>
        <p style="margin:0 0 20px 0;color:#475569;line-height:1.55">${intro}</p>
        <div style="margin:8px 0 20px 0;padding:18px 20px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;text-align:center">
          <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:34px;letter-spacing:10px;font-weight:700;color:#e63946">${code}</div>
        </div>
        <p style="margin:0;color:#64748b;font-size:13px;line-height:1.55">This code expires in ${CODE_TTL_MINUTES} minutes. If you didn't request it, you can safely ignore this email.</p>
      </td></tr>
      <tr><td style="padding:16px 28px 24px;color:#94a3b8;font-size:12px;border-top:1px solid #f1f5f9">
        © ${new Date().getFullYear()} HitroTech Telecom · no-reply@orders.hitrotech.com
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: FROM, to: [email], subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Resend send failed [${res.status}]: ${body}`);
    throw new Error("Failed to send verification email");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { action, email, password, fullName, code, newPassword } = await req.json();

    if (!validEmail(email)) return json({ error: "Invalid email" }, 400);
    const normalizedEmail = email.trim().toLowerCase();

    if (action === "send-signup") {
      if (!validPassword(password)) return json({ error: "Password too weak" }, 400);
      if (typeof fullName !== "string" || !fullName.trim()) return json({ error: "Name required" }, 400);
      const existing = await findUserByEmail(normalizedEmail);
      if (existing && existing.email_confirmed_at) {
        return json({ error: "An account with this email already exists. Please sign in." }, 400);
      }
      if (existing) {
        const { error } = await admin.auth.admin.updateUserById(existing.id, {
          password,
          user_metadata: { full_name: fullName },
        });
        if (error) return json({ error: error.message }, 400);
      } else {
        const { error } = await admin.auth.admin.createUser({
          email: normalizedEmail,
          password,
          email_confirm: false,
          user_metadata: { full_name: fullName },
        });
        if (error) return json({ error: error.message }, 400);
      }
      const c = generateCode();
      await storeCode(normalizedEmail, "signup", c);
      await sendCodeEmail(normalizedEmail, "signup", c);
      return json({ ok: true });
    }

    if (action === "verify-signup") {
      if (!validCode(code)) return json({ error: "Enter the 6-digit code" }, 400);
      const ok = await consumeCode(normalizedEmail, "signup", code);
      if (!ok) return json({ error: "Invalid or expired code. Please request a new one." }, 400);
      const user = await findUserByEmail(normalizedEmail);
      if (!user) return json({ error: "Account not found. Please sign up again." }, 400);
      const { error } = await admin.auth.admin.updateUserById(user.id, { email_confirm: true });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "send-reset") {
      const user = await findUserByEmail(normalizedEmail);
      if (user && user.email_confirmed_at) {
        const c = generateCode();
        await storeCode(normalizedEmail, "reset", c);
        await sendCodeEmail(normalizedEmail, "reset", c);
      }
      return json({ ok: true });
    }

    if (action === "verify-reset") {
      if (!validCode(code)) return json({ error: "Enter the 6-digit code" }, 400);
      if (!validPassword(newPassword)) return json({ error: "Password too weak" }, 400);
      const ok = await consumeCode(normalizedEmail, "reset", code);
      if (!ok) return json({ error: "Invalid or expired code. Please request a new one." }, 400);
      const user = await findUserByEmail(normalizedEmail);
      if (!user) return json({ error: "Account not found." }, 400);
      const { error } = await admin.auth.admin.updateUserById(user.id, { password: newPassword });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "send-password-change") {
      const authedUser = await getUserFromAuthHeader(req);
      if (!authedUser) return json({ error: "Not signed in" }, 401);
      if ((authedUser.email ?? "").toLowerCase() !== normalizedEmail) {
        return json({ error: "Email does not match signed-in user" }, 400);
      }
      const c = generateCode();
      await storeCode(normalizedEmail, "reset", c);
      await sendCodeEmail(normalizedEmail, "password_change", c);
      return json({ ok: true });
    }

    if (action === "verify-password-change") {
      const authedUser = await getUserFromAuthHeader(req);
      if (!authedUser) return json({ error: "Not signed in" }, 401);
      if ((authedUser.email ?? "").toLowerCase() !== normalizedEmail) {
        return json({ error: "Email does not match signed-in user" }, 400);
      }
      if (!validCode(code)) return json({ error: "Enter the 6-digit code" }, 400);
      if (!validPassword(newPassword)) return json({ error: "Password too weak" }, 400);
      const ok = await consumeCode(normalizedEmail, "reset", code);
      if (!ok) return json({ error: "Invalid or expired code. Please request a new one." }, 400);
      const { error } = await admin.auth.admin.updateUserById(authedUser.id, { password: newPassword });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "send-login-2fa") {
      // Called after password was validated on the client. Only sends a code
      // if the account exists AND has email_2fa_enabled=true on its profile.
      const user = await findUserByEmail(normalizedEmail);
      if (!user) return json({ required: false });
      const { data: prof } = await admin
        .from("profiles")
        .select("email_2fa_enabled")
        .eq("id", user.id)
        .maybeSingle();
      if (!prof?.email_2fa_enabled) return json({ required: false });
      const c = generateCode();
      await storeCode(normalizedEmail, "login", c);
      await sendCodeEmail(normalizedEmail, "login", c);
      return json({ required: true });
    }

    if (action === "verify-login-2fa") {
      if (!validCode(code)) return json({ error: "Enter the 6-digit code" }, 400);
      const ok = await consumeCode(normalizedEmail, "login", code);
      if (!ok) return json({ error: "Invalid or expired code. Please request a new one." }, 400);
      return json({ ok: true });
    }

    if (action === "send-enroll-email-2fa") {
      // Authenticated: user is enabling email 2FA on their own account.
      const authedUser = await getUserFromAuthHeader(req);
      if (!authedUser) return json({ error: "Not signed in" }, 401);
      if ((authedUser.email ?? "").toLowerCase() !== normalizedEmail) {
        return json({ error: "Email does not match signed-in user" }, 400);
      }
      const c = generateCode();
      await storeCode(normalizedEmail, "login", c);
      await sendCodeEmail(normalizedEmail, "login", c);
      return json({ ok: true });
    }

    if (action === "verify-enroll-email-2fa") {
      const authedUser = await getUserFromAuthHeader(req);
      if (!authedUser) return json({ error: "Not signed in" }, 401);
      if ((authedUser.email ?? "").toLowerCase() !== normalizedEmail) {
        return json({ error: "Email does not match signed-in user" }, 400);
      }
      if (!validCode(code)) return json({ error: "Enter the 6-digit code" }, 400);
      const ok = await consumeCode(normalizedEmail, "login", code);
      if (!ok) return json({ error: "Invalid or expired code. Please request a new one." }, 400);
      const { error } = await admin.from("profiles").update({ email_2fa_enabled: true }).eq("id", authedUser.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "regenerate-recovery-codes") {
      // Auth required — user regenerates their own codes.
      const user = await getUserFromAuthHeader(req);
      if (!user) return json({ error: "Not signed in" }, 401);
      // Wipe old codes
      await admin.from("user_recovery_codes").delete().eq("user_id", user.id);
      // Generate 10 new codes
      const plaintext: string[] = [];
      const rows: Array<{ user_id: string; code_hash: string }> = [];
      for (let i = 0; i < 10; i++) {
        const code = generateRecoveryCode();
        plaintext.push(code);
        rows.push({ user_id: user.id, code_hash: await hashRecoveryCode(code) });
      }
      const { error } = await admin.from("user_recovery_codes").insert(rows);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, codes: plaintext, generatedAt: new Date().toISOString() });
    }

    if (action === "use-recovery-code") {
      // Unauth flow — user typed email + recovery code on the sign-in page.
      if (typeof code !== "string" || code.trim().length < 8) return json({ error: "Enter a recovery code" }, 400);
      const user = await findUserByEmail(normalizedEmail);
      if (!user) return json({ error: "Invalid recovery code" }, 400);
      const codeHash = await hashRecoveryCode(code);
      const { data: match } = await admin
        .from("user_recovery_codes")
        .select("id")
        .eq("user_id", user.id)
        .eq("code_hash", codeHash)
        .is("used_at", null)
        .maybeSingle();
      if (!match) return json({ error: "Invalid or already-used recovery code" }, 400);
      // Consume
      await admin.from("user_recovery_codes").update({ used_at: new Date().toISOString() }).eq("id", match.id);
      // Wipe all other 2FA — user is recovering because they lost access
      await wipeAllMfa(user.id);
      // Restore the just-consumed row so remaining count is accurate; then delete after wiping
      // (wipeAllMfa above deletes recovery codes too, which is what we want — clean slate.)
      // Generate a magic-link so the client can establish a session
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: normalizedEmail,
      });
      if (linkErr || !linkData) return json({ error: "Could not create sign-in link" }, 500);
      const hashedToken = (linkData.properties as { hashed_token?: string } | null)?.hashed_token;
      if (!hashedToken) return json({ error: "Could not create sign-in link" }, 500);
      return json({ ok: true, hashedToken });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("otp-handler error", e);
    return json({ error: (e as Error).message ?? "Unexpected error" }, 500);
  }
});
