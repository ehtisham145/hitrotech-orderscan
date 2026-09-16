// Partner self-service portal server functions.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import type { ServerContext } from "./server-context";

// Each handler is a plain `<name>Core(data, context)` function with a one-line
// createServerFn wrapper under it — see src/lib/server-context.ts for why.

export async function getMyPartnerCore(context: ServerContext) {
  const { data, error } = await context.supabase
    .from("partners")
    .select("*")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export const getMyPartner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => getMyPartnerCore(context));

// BUG FIX: the partner lookup's error was discarded — a failed query looked
// identical to "this account isn't linked to a partner" and silently
// returned an empty payout list instead of surfacing the failure.
export async function listMyPayoutsCore(context: ServerContext) {
  const { data: partner, error: partnerErr } = await context.supabase
    .from("partners")
    .select("id")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (partnerErr) throw new Error(partnerErr.message);
  if (!partner) return [];
  const { data, error } = await context.supabase
    .from("partner_payouts")
    .select("*")
    .eq("partner_id", partner.id)
    .order("month", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export const listMyPayouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => listMyPayoutsCore(context));
