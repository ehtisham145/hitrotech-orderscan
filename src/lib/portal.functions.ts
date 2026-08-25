// Partner self-service portal server functions.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";

export const getMyPartner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("partners")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const listMyPayouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: partner } = await context.supabase
      .from("partners")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!partner) return [];
    const { data, error } = await context.supabase
      .from("partner_payouts")
      .select("*")
      .eq("partner_id", partner.id)
      .order("month", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
