// Business trend data powering the dashboard KPI charts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";

export const getBusinessTrends = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workspaceId: z.string().uuid().optional().nullable() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    
    let wsId = data.workspaceId || null;
    if (!wsId) {
      const { data: p } = await supabase.from("profiles").select("active_workspace_id").eq("id", userId).maybeSingle();
      wsId = p?.active_workspace_id || null;
    }
    if (!wsId) return null;

    const now = new Date();
    const monthsBack = 5;
    const firstMonthStart = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const firstMonthKey = firstMonthStart.toISOString().slice(0, 10);
    const thisMonthStartKey = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    const [allRes, qualityRes, partnersRes] = await Promise.all([
      supabase
        .from("extractions")
        .select("partner_id, commission_amount, commission_month, activation_date_parsed, store_id, current_network, sim_type, number_type, package_name, paid_via, employee_name, status, is_duplicate, avg_confidence, created_at")
        .eq("workspace_id", wsId)
        .gte("commission_month", firstMonthKey),
      supabase
        .from("extractions")
        .select("status, is_duplicate")
        .eq("workspace_id", wsId)
        .gte("created_at", new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
      supabase.from("partners").select("id, name, role, active").eq("workspace_id", wsId),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allRows = (allRes.data ?? []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const partners = (partnersRes.data ?? []) as any[];

    // Filter to valid extractions for most charts
    const valid = allRows.filter(r => r.status === "success" && !r.is_duplicate);
    const thisMonthRows = valid.filter(r => r.commission_month === thisMonthStartKey);

    // --- 1. Daily pace (this month) ---
    const daily = [];
    for (let i = 1; i <= dayOfMonth; i++) {
      const dateStr = new Date(now.getFullYear(), now.getMonth(), i).toISOString().slice(0, 10);
      const dayRows = thisMonthRows.filter(r => r.activation_date_parsed === dateStr);
      const nets: Record<string, number> = {};
      dayRows.forEach(r => {
        const n = r.current_network || "Unknown";
        nets[n] = (nets[n] || 0) + 1;
      });
      daily.push({
        label: i.toString(),
        count: dayRows.length,
        cumulative: thisMonthRows.filter(r => r.activation_date_parsed && r.activation_date_parsed <= dateStr).length,
        ...nets
      });
    }

    // --- 2. Monthly momentum (last 6 months) ---
    const monthly = [];
    for (let i = monthsBack; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1).toISOString().slice(0, 10);
      const mRows = valid.filter(r => r.commission_month === m);
      const nets: Record<string, number> = {};
      mRows.forEach(r => {
        const n = r.current_network || "Unknown";
        nets[n] = (nets[n] || 0) + 1;
      });
      monthly.push({
        label: new Date(now.getFullYear(), now.getMonth() - i, 1).toLocaleDateString("en-US", { month: "short" }),
        count: mRows.length,
        amount: mRows.reduce((sum, r) => sum + (r.commission_amount || 0), 0),
        ...nets
      });
    }

    // --- 3. Role mix ---
    const roleMixMap = new Map<string, number>();
    thisMonthRows.forEach(r => {
      const p = partners.find(x => x.id === r.partner_id);
      const role = p?.role || "unassigned";
      roleMixMap.set(role, (roleMixMap.get(role) || 0) + 1);
    });
    const roleMix = Array.from(roleMixMap.entries()).map(([role, count]) => ({ role, count }));

    // --- 4. Store contribution ---
    const storeMap = new Map<string, { count: number, amount: number }>();
    thisMonthRows.forEach(r => {
      const s = r.store_id || "Unknown";
      const entry = storeMap.get(s) || { count: 0, amount: 0 };
      entry.count++;
      entry.amount += (r.commission_amount || 0);
      storeMap.set(s, entry);
    });
    const stores = Array.from(storeMap.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.count - a.count);

    // --- 5. Partner performance ---
    const partnerMap = new Map<string, { count: number, amount: number }>();
    thisMonthRows.forEach(r => {
      const p = partners.find(x => x.id === r.partner_id);
      const name = p?.name || "Unknown";
      const entry = partnerMap.get(name) || { count: 0, amount: 0 };
      entry.count++;
      entry.amount += (r.commission_amount || 0);
      partnerMap.set(name, entry);
    });
    const partnerStats = Array.from(partnerMap.entries())
      .map(([name, stats]) => ({
        name,
        count: stats.count,
        amount: stats.amount,
        rate: stats.count > 0 ? Math.round(stats.amount / stats.count) : 0
      }))
      .sort((a, b) => b.count - a.count);

    // --- 6. Networks ---
    const networks = Array.from(new Set(valid.map(r => r.current_network || "Unknown"))).slice(0, 8);

    // --- 7. Quality ---
    const qRaw = qualityRes.data ?? [];
    const quality = {
      total: qRaw.length,
      success: qRaw.filter((r: any) => r.status === "success" && !r.is_duplicate).length,
      failed: qRaw.filter((r: any) => r.status === "failed").length,
      duplicate: qRaw.filter((r: any) => r.is_duplicate).length,
      pending: qRaw.filter((r: any) => r.status === "pending" || r.status === "processing").length,
    };

    // --- 8. Network stats ---
    const netStatsMap = new Map<string, { count: number, amount: number }>();
    thisMonthRows.forEach(r => {
      const n = r.current_network || "Unknown";
      const entry = netStatsMap.get(n) || { count: 0, amount: 0 };
      entry.count++;
      entry.amount += (r.commission_amount || 0);
      netStatsMap.set(n, entry);
    });
    const networkStats = Array.from(netStatsMap.entries()).map(([name, s]) => ({
      name,
      count: s.count,
      rate: s.count > 0 ? Math.round(s.amount / s.count) : 0
    }));

    return {
      daily,
      monthly,
      role_mix: roleMix,
      stores,
      partners: partnerStats,
      networks,
      network_stats: networkStats,
      quality,
      day_of_month: dayOfMonth,
      days_in_month: daysInMonth,
      simTypes: Array.from(new Map(thisMonthRows.map(r => [r.sim_type || "Unknown", true])).keys()).map(name => ({
        name,
        count: thisMonthRows.filter(r => (r.sim_type || "Unknown") === name).length
      })),
      numberTypes: Array.from(new Map(thisMonthRows.map(r => [r.number_type || "Unknown", true])).keys()).map(name => ({
        name,
        count: thisMonthRows.filter(r => (r.number_type || "Unknown") === name).length
      })),
    };
  });
