// Server-only helpers for securing public webhook endpoints under /api/public/*.
// Import lazily inside handlers to avoid pulling into client bundles.
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify an HMAC-SHA256 signature over the raw request body.
 * Signature header format: "sha256=<hex>"
 * Returns { ok: true } when signature matches, or { ok: false, reason }.
 *
 * If `secret` is not configured, verification is SKIPPED and returns
 * { ok: true, skipped: true } so existing callers keep working until the
 * secret is set — enabling a gradual rollout.
 */
export function verifyHmacSignature(opts: {
  rawBody: string;
  header: string | null | undefined;
  secret: string | undefined;
}): { ok: boolean; skipped?: boolean; reason?: string } {
  if (!opts.secret) return { ok: true, skipped: true };
  if (!opts.header) return { ok: false, reason: "missing signature header" };

  const provided = opts.header.startsWith("sha256=") ? opts.header.slice(7) : opts.header;
  const expected = createHmac("sha256", opts.secret).update(opts.rawBody).digest("hex");

  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return { ok: false, reason: "signature length mismatch" };
  try {
    if (!timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "invalid signature encoding" };
  }
}

// --- Simple in-memory token-bucket rate limiter, keyed by IP or arbitrary key.
// Worker instances are short-lived and per-region, so this is a best-effort
// safety net against accidental bursts — not a global quota.
type Bucket = { tokens: number; updatedAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(opts: {
  key: string;
  capacity?: number; // max burst
  refillPerSec?: number; // sustained rate
}): { ok: boolean; retryAfterMs?: number } {
  const capacity = opts.capacity ?? 20;
  const refillPerSec = opts.refillPerSec ?? 5;
  const now = Date.now();
  const b = buckets.get(opts.key) ?? { tokens: capacity, updatedAt: now };
  const elapsed = (now - b.updatedAt) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
  b.updatedAt = now;
  if (b.tokens < 1) {
    buckets.set(opts.key, b);
    const retryAfterMs = Math.ceil(((1 - b.tokens) / refillPerSec) * 1000);
    return { ok: false, retryAfterMs };
  }
  b.tokens -= 1;
  buckets.set(opts.key, b);
  // Occasional GC to bound memory
  if (buckets.size > 5000) {
    const cutoff = now - 60_000;
    for (const [k, v] of buckets) if (v.updatedAt < cutoff) buckets.delete(k);
  }
  return { ok: true };
}

export function getClientIp(request: Request): string {
  const h = request.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    (h.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown"
  );
}
