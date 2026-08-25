// Cron endpoint: on the 1st of each month, auto-generate payouts for the previous month.
// Called by pg_cron with the Supabase anon key in the apikey header.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/public/hooks/rollover-payouts")({
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

        // Determine the month to roll over. Default = previous month.
        let month: string | undefined;
        try {
          const body = (await request.json()) as { month?: string };
          month = body?.month;
        } catch {
          // empty body is fine
        }
        const now = new Date();
        const targetMonth =
          month ??
          new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);

        const supabase = createClient(
          process.env.EXT_SUPABASE_URL!,
          process.env.EXT_SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        );

        // Aggregate this month's non-duplicate successful activations by partner.
        const { data: rows, error: rowsErr } = await supabase
          .from("extractions")
          .select("partner_id, commission_amount")
          .eq("status", "success")
          .eq("is_duplicate", false)
          .eq("commission_month", targetMonth)
          .not("partner_id", "is", null);

        if (rowsErr) {
          return new Response(JSON.stringify({ error: rowsErr.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const stats = new Map<string, { count: number; amount: number }>();
        for (const r of (rows ?? []) as Array<{ partner_id: string; commission_amount: number | null }>) {
          const s = stats.get(r.partner_id) ?? { count: 0, amount: 0 };
          s.count += 1;
          s.amount += r.commission_amount ?? 0;
          stats.set(r.partner_id, s);
        }

        const { data: existing } = await supabase
          .from("partner_payouts")
          .select("partner_id, status")
          .eq("month", targetMonth);
        const existingMap = new Map<string, string>();
        for (const e of (existing ?? []) as Array<{ partner_id: string; status: string }>) {
          existingMap.set(e.partner_id, e.status);
        }

        let created = 0;
        let updated = 0;
        let skipped = 0;
        for (const [partner_id, s] of stats) {
          const rate = s.count > 0 ? Math.round(s.amount / s.count) : 0;
          const existingStatus = existingMap.get(partner_id);
          if (existingStatus === "paid") {
            skipped += 1;
            continue;
          }
          const patch = {
            partner_id,
            month: targetMonth,
            activations_count: s.count,
            rate_pkr: rate,
            amount_pkr: s.amount,
            status: "pending" as const,
            snapshot_count: s.count,
            snapshot_amount: s.amount,
            snapshot_at: new Date().toISOString(),
          };
          const { error } = await supabase
            .from("partner_payouts")
            .upsert(patch, { onConflict: "partner_id,month" });
          if (!error) {
            if (existingStatus) updated += 1;
            else created += 1;
          }
        }

        return new Response(
          JSON.stringify({
            ok: true,
            month: targetMonth,
            partners: stats.size,
            created,
            updated,
            skipped,
            ran_at: new Date().toISOString(),
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
