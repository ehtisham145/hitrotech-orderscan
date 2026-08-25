import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Only echo Access-Control-Allow-Origin for same-origin requests. The
// wildcard is intentionally NOT used because this endpoint forwards a user
// bearer token.
function isAllowedOrigin(origin: string | null, requestUrl: string): string | null {
  if (!origin) return null;
  try {
    const o = new URL(origin);
    const self = new URL(requestUrl);
    if (o.host === self.host) return origin;
    return null;
  } catch {
    return null;
  }
}

function buildCorsHeaders(request: Request): Record<string, string> {
  const allowed = isAllowedOrigin(request.headers.get("origin"), request.url);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    Vary: "Origin",
  };
  if (allowed) headers["Access-Control-Allow-Origin"] = allowed;
  return headers;
}

function textResponse(body: string, status: number, request: Request) {
  return new Response(body, { status, headers: buildCorsHeaders(request) });
}

function jsonResponse(body: unknown, status: number, request: Request) {
  return Response.json(body, { status, headers: buildCorsHeaders(request) });
}

export const Route = createFileRoute("/api/extract")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: buildCorsHeaders(request) }),
      POST: async ({ request }) => {
        try {
          const authHeader = request.headers.get("authorization");
          if (!authHeader?.startsWith("Bearer ")) return textResponse("Unauthorized", 401, request);

          const token = authHeader.slice(7);

          const body = (await request.json()) as { extraction_id: string };
          if (!body.extraction_id) return textResponse("Missing extraction_id", 400, request);

          const SUPABASE_URL = process.env.EXT_SUPABASE_URL!;
          const SUPABASE_KEY = process.env.EXT_SUPABASE_PUBLISHABLE_KEY!;
          const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY } },
            auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
          });

          // Trust the JWT via RLS instead of hitting Supabase Auth /user on every
          // request — 50+ concurrent calls to /auth/v1/user hit rate limits and
          // can cascade into the browser client's own token refresh failing,
          // which surfaces to the user as an unexpected sign-out.

          // Ownership check happens implicitly through RLS — the update in
          // runExtraction will no-op if this user doesn't own the row.
          const { runExtraction } = await import("@/lib/extract-core.server");
          const result = await runExtraction(supabase, body.extraction_id);
          const status = result.ok || result.error === "paused" || result.error === "cancelled" ? 200 : 500;
          return jsonResponse(result, status, request);
        } catch (err) {
          console.error("[extract] error", err);
          return jsonResponse({ ok: false, error: String(err) }, 500, request);
        }
      },

    },
  },
});
