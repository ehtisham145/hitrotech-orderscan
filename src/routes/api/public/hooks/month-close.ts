// Cron endpoint: on the 1st of each month, close the previous month for every workspace.
// Called by pg_cron with the Supabase anon key in the apikey header.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { runMonthClose, previousMonthStart, monthStartOf } from "@/lib/month-close.server";

export const Route = createFileRoute("/api/public/hooks/month-close")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.EXT_SUPABASE_PUBLISHABLE_KEY;
        if (!apikey || !expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let month: string | undefined;
        try {
          const body = (await request.json()) as { month?: string };
          month = body?.month;
        } catch {
          // empty body is fine
        }
        const targetMonth = month ? monthStartOf(month) : previousMonthStart();

        const supabase = createClient(
          process.env.EXT_SUPABASE_URL!,
          process.env.EXT_SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        );

        const { data: workspaces, error } = await supabase.from("workspaces").select("id");
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const results: unknown[] = [];
        for (const ws of (workspaces ?? []) as Array<{ id: string }>) {
          try {
            results.push(
              await runMonthClose(supabase, ws.id, targetMonth, { automatic: true, lock: true }),
            );
          } catch (e) {
            results.push({ workspace_id: ws.id, error: (e as Error).message });
          }
        }

        return new Response(
          JSON.stringify({ ok: true, month: targetMonth, workspaces: results.length, results, ran_at: new Date().toISOString() }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
