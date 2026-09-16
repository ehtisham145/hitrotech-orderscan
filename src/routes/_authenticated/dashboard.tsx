import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, FileImage, CheckCircle2, AlertTriangle, Copy, Zap, Clock, CalendarRange } from "lucide-react";
import { formatDistanceToNow, format, subDays, startOfDay, differenceInCalendarDays } from "date-fns";
import { useMemo, useState } from "react";
import { ExtractionsBubbles } from "@/components/dashboard/ExtractionsBubbles";
import { SimGauges } from "@/components/dashboard/SimGauges";
import {
  CHART, PALETTES, NEON_CARD, brandColorFor, ChartGradientDefs,
} from "@/components/dashboard/chart-theme";
import {
  StatCard, CategoryDonut, CategoryExplodedPie, CategoryFunnel,
  CategoryHalfDonut, CategoryLegendDonut, CategoryPictorial, CategoryRadial,
} from "@/components/dashboard/dashboard-charts";
import { EmptyState } from "@/components/EmptyState";
import { useServerFn } from "@tanstack/react-start";
import { getCommissionSummary } from "@/lib/commission.functions";
import { Wallet, Trophy, UserCheck2 } from "lucide-react";
import { DashboardKpis } from "@/components/dashboard/DashboardKpis";
import { BusinessKpiCharts } from "@/components/dashboard/BusinessKpiCharts";
import { ActivationUsageCard } from "@/components/ActivationUsageCard";
import { useWorkspace } from "@/components/WorkspaceContext";
import { getRecentActivity, type ActivityEvent } from "@/lib/activity.functions";
import { usePlanFeatures } from "@/lib/use-plan-features";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — HitroTech OrderScan" },
      { name: "description", content: "Overview of your telecom order extractions: recent batches, duplicate detection stats, and network breakdown." },
      { property: "og:title", content: "Dashboard — HitroTech OrderScan" },
      { property: "og:description", content: "Overview of your telecom order extractions: recent batches, duplicate detection stats, and network breakdown." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});





type Preset = "24h" | "7d" | "14d" | "30d" | "all" | "custom";

function Dashboard() {
  const { workspace: activeWs } = useWorkspace();
  const { can } = usePlanFeatures();
  const [preset, setPreset] = useState<Preset>("14d");
  const [customFrom, setCustomFrom] = useState<string>(format(subDays(new Date(), 13), "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState<string>(format(new Date(), "yyyy-MM-dd"));

  // Compute range first so the extractions query can filter server-side.
  const { fromMs, toMs, isAllTime } = useMemo(() => {
    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    let start: Date;
    if (preset === "24h") start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    else if (preset === "7d") start = startOfDay(subDays(now, 6));
    else if (preset === "14d") start = startOfDay(subDays(now, 13));
    else if (preset === "30d") start = startOfDay(subDays(now, 29));
    else if (preset === "all") return { fromMs: 0, toMs: end.getTime(), isAllTime: true };
    else {
      start = startOfDay(new Date(customFrom));
      const e = new Date(customTo);
      e.setHours(23, 59, 59, 999);
      return { fromMs: start.getTime(), toMs: e.getTime(), isAllTime: false };
    }
    return { fromMs: start.getTime(), toMs: end.getTime(), isAllTime: false };
  }, [preset, customFrom, customTo]);

  const { data: raw, isLoading } = useQuery({
    queryKey: ["dashboard-raw", activeWs?.id, isAllTime ? "all" : `${fromMs}-${toMs}`],
    queryFn: async () => {
      const wsId = activeWs?.id;
      if (!wsId) return { recentBatches: [], rows: [] };
      
      const batchesPromise = supabase
        .from("batches")
        .select("id, name, total_images, processed_count, failed_count, duplicate_count, status, created_at")
        .eq("workspace_id", wsId)
        .order("created_at", { ascending: false })
        .limit(5);
      
      let extractionsQ = supabase
        .from("extractions")
        .select("id, status, is_duplicate, avg_confidence, created_at, needs_review, current_network, branch_name, sim_type, number_type, package_name, paid_via, store_id, employee_name")
        .eq("workspace_id", wsId);
      
      if (!isAllTime) {
        extractionsQ = extractionsQ
          .gte("created_at", new Date(fromMs).toISOString())
          .lte("created_at", new Date(toMs).toISOString());
      }
      const [batches, extractions] = await Promise.all([batchesPromise, extractionsQ]);
      return { recentBatches: batches.data ?? [], rows: extractions.data ?? [] };
    },
    enabled: !!activeWs?.id,
  });

  const days = useMemo(() => {
    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    if (preset === "24h") return 1;
    if (preset === "7d") return 7;
    if (preset === "14d") return 14;
    if (preset === "30d") return 30;
    if (preset === "custom") {
      const start = startOfDay(new Date(customFrom));
      const e = new Date(customTo);
      e.setHours(23, 59, 59, 999);
      return Math.max(1, differenceInCalendarDays(e, start) + 1);
    }
    // all-time: derive from earliest row (capped at 90 to match previous behavior)
    const earliest = (raw?.rows ?? []).reduce(
      (min, r) => Math.min(min, new Date(r.created_at).getTime()),
      Date.now(),
    );
    return Math.min(90, Math.max(1, differenceInCalendarDays(now, new Date(earliest)) + 1));
  }, [preset, customFrom, customTo, raw]);


  const s = useMemo(() => {
    if (!raw) return null;
    const rows = raw.rows.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= fromMs && t <= toMs;
    });
    // Only successful, non-duplicate extractions count as "orders" for KPIs & breakdowns.
    const valid = rows.filter((r) => r.status === "success" && !r.is_duplicate);
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const series: { date: string; label: string; total: number; success: number; failed: number; duplicates: number; avgAcc: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = startOfDay(subDays(new Date(toMs), i));
      const next = d.getTime() + day;
      const inDay = rows.filter((r) => {
        const t = new Date(r.created_at).getTime();
        return t >= d.getTime() && t < next;
      });
      const inDayValid = inDay.filter((r) => r.status === "success" && !r.is_duplicate);
      const accVals = inDayValid.map((r) => Number(r.avg_confidence)).filter((v) => !isNaN(v) && v > 0);
      series.push({
        date: d.toISOString(),
        label: format(d, days > 31 ? "MMM d" : "MMM d"),
        total: inDayValid.length,
        success: inDayValid.length,
        failed: inDay.filter((r) => r.status === "failed").length,
        duplicates: inDay.filter((r) => r.is_duplicate).length,
        avgAcc: accVals.length ? Math.round(accVals.reduce((a, b) => a + b, 0) / accVals.length) : 0,
      });
    }

    const groupBy = (key: keyof (typeof valid)[number], limit = 8) => {
      const m = new Map<string, number>();
      valid.forEach((r) => {
        const v = ((r as any)[key] ?? "").toString().trim();
        if (!v) return;
        m.set(v, (m.get(v) ?? 0) + 1);
      });
      return Array.from(m.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    };

    return {
      recentBatches: raw.recentBatches,
      total: valid.length,
      success: valid.length,
      failed: rows.filter((r) => r.status === "failed").length,
      processing: rows.filter((r) => r.status === "processing" || r.status === "pending").length,
      duplicates: rows.filter((r) => r.is_duplicate).length,
      needsReview: rows.filter((r) => r.needs_review).length,
      today: valid.filter((r) => now - new Date(r.created_at).getTime() < day).length,
      week: valid.filter((r) => now - new Date(r.created_at).getTime() < 7 * day).length,
      avgConfidence:
        valid.filter((r) => r.avg_confidence).reduce((a, b) => a + Number(b.avg_confidence), 0) /
        Math.max(1, valid.filter((r) => r.avg_confidence).length),
      series,
      networks: groupBy("current_network", 6),
      branches: groupBy("branch_name", 6),
      stores: groupBy("store_id", 20),
      simTypes: groupBy("sim_type", 6),
      numberTypes: groupBy("number_type", 6),
      packages: groupBy("package_name", 6),
      paidVia: groupBy("paid_via", 6),
      employees: groupBy("employee_name", 8),
    };
  }, [raw, fromMs, toMs, days]);




  // Only show bar-chart series for categories that actually appear in the data
  const activeSeriesKeys = s
    ? ([
        { key: "success", name: "Success", color: CHART.success, total: s.success },
        { key: "failed", name: "Failed", color: CHART.failed, total: s.failed },
        { key: "duplicates", name: "Duplicates", color: CHART.duplicates, total: s.duplicates },
      ].filter((k) => k.total > 0))
    : [];


  const rangeLabel =
    preset === "24h" ? "Last 24 hours" :
    preset === "7d" ? "Last 7 days" :
    preset === "14d" ? "Last 14 days" :
    preset === "30d" ? "Last 30 days" :
    preset === "all" ? "All time" :
    `${format(new Date(customFrom), "MMM d")} – ${format(new Date(customTo), "MMM d, yyyy")}`;

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8">
      <ChartGradientDefs />
      <div className="relative overflow-hidden rounded-2xl px-6 py-8 md:px-10 md:py-10 gradient-brand border border-white/10 shadow-lg">
        <div className="absolute -top-16 -right-10 h-56 w-56 rounded-2xl bg-white/10 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-10 h-56 w-56 rounded-2xl bg-white/5 blur-2xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0 text-white">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/50">Overview · {rangeLabel}</div>
            <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight mt-1 drop-shadow-sm">Dashboard</h1>
            <p className="text-sm text-white/85 mt-1">
              Overview of your telecom order extractions, batches, and team activity.
</p>
          </div>
          <Button asChild size="sm" className="shrink-0 bg-white/20 text-white hover:bg-white/30 border border-white/20 shadow-lg backdrop-blur-sm rounded-2xl font-bold px-5">
            <Link to="/batches/new"><Upload className="w-4 h-4 mr-2" /> New Import</Link>
          </Button>
        </div>
      </div>



      {/* Extraction pipeline health */}
      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader className="pb-4 flex flex-row items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="text-base font-bold tracking-tight">Extraction pipeline</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{rangeLabel}</p>
          </div>
          <div className="flex items-center gap-1 flex-wrap p-1 rounded-2xl bg-muted/60 border border-border/50">
            <CalendarRange className="w-3.5 h-3.5 text-muted-foreground ml-1.5 mr-0.5" />
            {([
              ["24h", "24h"],
              ["7d", "7d"],
              ["14d", "14d"],
              ["30d", "30d"],
              ["all", "All"],
              ["custom", "Custom"],
            ] as [Preset, string][]).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={preset === key ? "default" : "ghost"}
                onClick={() => setPreset(key)}
                className={
                  "h-7 px-2.5 text-xs font-bold " +
                  (preset === key ? "shadow-sm gradient-brand text-white" : "hover:bg-background text-slate-500 hover:text-slate-900")
                }
              >
                {label}
              </Button>
            ))}
            {preset === "custom" && (
              <div className="flex items-center gap-1.5 ml-1">
                <Input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className="h-7 w-auto text-xs rounded-2xl" />
                <span className="text-muted-foreground text-xs">→</span>
                <Input type="date" value={customTo} min={customFrom} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setCustomTo(e.target.value)} className="h-7 w-auto text-xs rounded-2xl" />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          {/* Seven across only from xl. At lg (1024px) seven cards left each one
              about 95px of content — the width that made the labels collide
              with their icons in the first place. Below that it steps down to
              four and then two, which is two tidy rows instead of one cramped
              one. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <StatCard icon={FileImage} label="Total Orders" value={s?.total ?? 0} loading={isLoading} />
            <StatCard icon={CheckCircle2} label="Extracted" value={s?.success ?? 0} loading={isLoading} tone="success" />
            <StatCard icon={Zap} label="Avg Accuracy" value={s?.avgConfidence ? `${Math.round(s.avgConfidence)}%` : "—"} loading={isLoading} />
            <StatCard icon={FileImage} label="Today / Week" value={s ? `${s.today} / ${s.week}` : "—"} loading={isLoading} />
            <StatCard icon={Clock} label="Processing" value={s?.processing ?? 0} loading={isLoading} tone="muted" />
            <StatCard icon={AlertTriangle} label="Needs Review" value={s?.needsReview ?? 0} loading={isLoading} tone="warn" />
            <StatCard icon={AlertTriangle} label="Failed" value={s?.failed ?? 0} loading={isLoading} tone="danger" />
          </div>
        </CardContent>
      </Card>


      {(() => {
        const total = s?.total || 0;
        const extSlices = s ? [
          { label: "Success",      value: s.success,     from: "var(--brand-2)", to: "var(--brand)" },
          { label: "Processing",   value: s.processing,  from: "var(--muted)", to: "var(--muted-foreground)" },
          { label: "Needs review", value: s.needsReview, from: "var(--warning)", to: "var(--brand)" },
          { label: "Failed",       value: s.failed,      from: "var(--destructive)", to: "var(--brand-3)" },
        ].filter((x) => x.value > 0) : [];

        const card = (
          key: string,
          title: string,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: any[] | undefined,
          palette: string[],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          Comp: any,
        ) =>
          (data?.length ?? 0) > 0
            ? <Comp key={key} title={title} data={data} palette={palette} />
            : null;

        const overviewCards: React.ReactNode[] = [];
        const networkCards: React.ReactNode[] = [];
        const partnerCards: React.ReactNode[] = [];
        const qualityCards: React.ReactNode[] = [];

        if (s) {
          overviewCards.push(
            <Card key="ext" className="min-h-[360px] flex flex-col rounded-2xl border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-foreground">Extractions</CardTitle>
                <p className="text-xs text-muted-foreground">Status breakdown — {rangeLabel.toLowerCase()}</p>
              </CardHeader>
              <CardContent className="relative flex-1 flex items-center justify-center pb-6">
                <div className="w-full"><ExtractionsBubbles slices={extSlices} total={total} /></div>
              </CardContent>
            </Card>,
          );
          overviewCards.push(<ThroughputCard key="throughput" s={s} label={rangeLabel.toLowerCase()} />);
          qualityCards.push(<QualitySnapshotCard key="quality" s={s} />);
        }

        // Networks & product mix
        networkCards.push(
          card(
            "networks",
            "Networks",
            s?.networks,
            (s?.networks ?? []).map((d, i) => brandColorFor(d.name, PALETTES.networks[i % PALETTES.networks.length])),
            CategoryExplodedPie,
          ),
        );
        if ((s?.simTypes.length ?? 0) > 0) {
          networkCards.push(
            <Card key="sim" className={NEON_CARD}>
              <CardContent className="pt-6"><SimGauges title="SIM type" data={s!.simTypes} palette={PALETTES.simType} /></CardContent>
            </Card>,
          );
        }
        if ((s?.numberTypes.length ?? 0) > 0) {
          networkCards.push(<CategoryRadial key="nt" title="Number type" data={s!.numberTypes} palette={PALETTES.numberType} />);
        }
        if ((s?.paidVia.length ?? 0) > 0) {
          networkCards.push(<CategoryDonut key="pv" title="Paid via" data={s!.paidVia} palette={PALETTES.paidVia} />);
        }
        networkCards.push(card("packages", "Top packages", s?.packages, PALETTES.packages, CategoryFunnel));

        // Partners, stores & people
        if (can("store_performance")) {
          partnerCards.push(card("branches", "Branches", s?.branches, PALETTES.branches, CategoryLegendDonut));
          partnerCards.push(card("stores", "Stores", s?.stores, PALETTES.stores, CategoryHalfDonut));
        }
        if (can("leaderboard")) {
          partnerCards.push(card("employees", "Employees", s?.employees, PALETTES.employees, CategoryPictorial));
        }

        const chartGrid = (cards: React.ReactNode[]) => {
          const list = cards.filter(Boolean);
          if (list.length === 0) return null;
          // 6-col grid: cards are 1/3 wide. If the last row would hold a single
          // card, rebalance the tail into rows of two half-width cards instead.
          const rem = list.length % 3;
          const tail = rem === 1 ? 4 : rem === 2 ? 2 : 0;
          const spanFor = (i: number) =>
            tail > 0 && i >= list.length - tail ? "xl:col-span-3" : "xl:col-span-2";
          return (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6 auto-rows-fr items-stretch">
              {list.map((c, i) => (
                <div
                  key={i}
                  className={`h-full [&>*]:h-full [&>*]:flex [&>*]:flex-col ${spanFor(i)}`}
                >
                  {c}
                </div>
              ))}
            </div>
          );
        };


        return (
          <div className="space-y-6">
            {can("commissions") && <CommissionTiles />}
            <ActivationUsageCard />
            <DashboardKpis />
            <BusinessKpiCharts />
            {chartGrid([...overviewCards, ...networkCards, ...partnerCards, ...qualityCards])}

            <Card className="rounded-2xl border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Recent batches</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-sm text-muted-foreground">Loading…</div>
                ) : (s?.recentBatches?.length ?? 0) === 0 ? (
                  <EmptyState
                    compact
                    icon={FileImage}
                    title="No batches yet"
                    description="Upload your first screenshots to start extracting orders."
                    action={{ label: "Create a batch", to: "/batches/new" }}
                  />
                ) : (
                  <div className="divide-y divide-slate-100">
                    {s!.recentBatches.map((b) => (
                      <Link key={b.id} to="/batches/$id" params={{ id: b.id }} className="flex items-center justify-between py-3 hover:bg-slate-50/50 transition-colors group">
                        <div>
                          <div className="font-bold text-sm text-foreground group-hover:text-primary transition-colors">{b.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(b.created_at), { addSuffix: true })} · {b.total_images} images
                          </div>
                        </div>
                        <div className="text-xs flex gap-2">
                          <span className="text-emerald-600">{b.processed_count} done</span>
                          {b.failed_count > 0 && <span className="text-destructive">{b.failed_count} failed</span>}
                          {b.duplicate_count > 0 && <span className="text-amber-600">{b.duplicate_count} dup</span>}
                          <span className="uppercase text-muted-foreground text-[10px] font-semibold ml-2 self-center px-2 py-0.5 rounded-2xl bg-muted">{b.status}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <RecentActivityCard />
          </div>
        );
      })()}

    </div>
  );
}

function RecentActivityCard() {
  const fetchActivity = useServerFn(getRecentActivity);
  const { data, isLoading } = useQuery({
    queryKey: ["recent-activity"],
    queryFn: () => fetchActivity({ data: { limit: 10 } }),
    staleTime: 30_000,
  });
  const events = data ?? [];
  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Recent activity</CardTitle>
        <Link to="/admin/audit" className="text-xs text-primary hover:underline">View all</Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : events.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">No activity yet.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {events.map((e: ActivityEvent) => (
              <li key={e.id} className="py-2.5 flex items-start gap-3 text-sm">
                <div className="h-8 w-8 rounded-full bg-primary/10 text-primary text-xs font-semibold grid place-items-center shrink-0">
                  {(e.actor_name ?? "?").slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    <span className="font-medium">{e.actor_name ?? "Someone"}</span>{" "}
                    <span className="text-muted-foreground">{e.label}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CommissionTiles() {
  const fetchSummary = useServerFn(getCommissionSummary);
  const { data } = useQuery({
    queryKey: ["commission-summary"],
    queryFn: () => fetchSummary({ data: {} }),
  });
  const fmt = (n: number) => "PKR " + (n ?? 0).toLocaleString();
  const monthLabel = data?.month ? format(new Date(data.month), "MMMM yyyy") : format(new Date(), "MMMM yyyy");
  return (
    <div className="grid gap-4 h-full sm:grid-cols-5">
      <Card className="sm:col-span-3 relative overflow-hidden rounded-2xl border-border shadow-sm">
        <div className="absolute -top-8 -right-8 h-32 w-32 rounded-full bg-primary/10 pointer-events-none" />
        <CardContent className="pt-6 pb-6 relative">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500/80">Commission · {monthLabel}</div>
          <div className="mt-2 flex items-end gap-3">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary grid place-items-center shrink-0">
              <Wallet className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="text-3xl font-extrabold tracking-tight text-foreground">{fmt(data?.total_commission ?? 0)}</div>
              <div className="text-xs text-muted-foreground">{data?.total_activations ?? 0} activations linked</div>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="sm:col-span-2 rounded-2xl border-border shadow-sm">
        <CardContent className="pt-6 pb-6 h-full flex flex-col items-center justify-center text-center">
          <div className="relative">
            <div
              className="h-24 w-24 rounded-2xl grid place-items-center"
              style={{
                background:
                  "conic-gradient(from 220deg, var(--brand-2), var(--brand), var(--brand-3), var(--brand-2))",
                padding: 3,
              }}
            >
              <div className="h-full w-full rounded-2xl bg-card grid place-items-center">
                <span className="font-display text-2xl font-bold text-foreground">
                  {(data?.top_earner?.name ?? "—").slice(0, 1).toUpperCase()}
                </span>
              </div>
            </div>
            <div className="absolute -bottom-1 -right-1 h-8 w-8 rounded-2xl bg-amber-400 text-white grid place-items-center shadow-md ring-2 ring-card">
              <Trophy className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 text-lg font-bold truncate max-w-full text-foreground">{data?.top_earner?.name ?? "—"}</div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500/80">Top earner this month</div>
          <div className="mt-2 text-lg font-bold bg-clip-text text-transparent gradient-brand">
            {data?.top_earner ? fmt(data.top_earner.commission) : "—"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}



type StatsShape = {
  total: number; success: number; failed: number; processing: number;
  duplicates: number; needsReview: number; avgConfidence: number;
  today: number; week: number;
  series: { label: string; total: number }[];
};

function QualitySnapshotCard({ s }: { s: StatsShape }) {
  const acc = Math.max(0, Math.min(100, Math.round(s.avgConfidence || 0)));
  const r = 52;
  const c = 2 * Math.PI * r;
  const rows = [
    { label: "Needs review", value: s.needsReview, color: "#a78bfa" },
    { label: "Duplicates", value: s.duplicates, color: "#f59e0b" },
    { label: "Failed", value: s.failed, color: "#ef4444" },
  ];
  return (
    <Card className="rounded-2xl border-border shadow-sm flex flex-col h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold text-foreground">Data quality</CardTitle>
        <p className="text-xs text-muted-foreground">Accuracy and exceptions in range</p>
      </CardHeader>
      <CardContent className="flex-1 flex items-center gap-6 pb-6">

        <svg width="132" height="132" viewBox="0 0 132 132" className="shrink-0">
          <defs>
            <linearGradient id="qualityRing" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#22d3a3" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>
          <circle cx="66" cy="66" r={r} fill="none" stroke="rgba(15,23,42,0.05)" strokeWidth="12" />
          <circle
            cx="66" cy="66" r={r} fill="none" stroke="url(#qualityRing)" strokeWidth="12"
            strokeLinecap="round" strokeDasharray={`${(acc / 100) * c} ${c}`}
            transform="rotate(-90 66 66)"
          />
          <text x="66" y="62" textAnchor="middle" fontSize="26" fontWeight="800" fill="currentColor" className="text-foreground">{acc}%</text>
          <text x="66" y="80" textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor" className="text-slate-400" letterSpacing="1">ACCURACY</text>
        </svg>
        <div className="flex-1 min-w-0 space-y-2.5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 text-slate-500/80 font-medium text-[13px]">
                <span className="h-2.5 w-2.5 rounded-2xl" style={{ background: row.color }} />
                {row.label}
              </span>
              <span className="font-bold text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ThroughputCard({ s, label }: { s: StatsShape; label: string }) {
  const data = s.series.slice(-14);
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <Card className="rounded-2xl border-border shadow-sm flex flex-col h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold text-foreground">Extraction throughput</CardTitle>
        <p className="text-xs text-muted-foreground">Orders per day — {label}</p>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center pb-6">
        <div className="flex items-end gap-1.5 h-32">

          {data.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col justify-end h-full" title={`${d.label}: ${d.total}`}>
              <div
                className="rounded-t-none"
                style={{
                  height: `${Math.max(4, (d.total / max) * 100)}%`,
                  background: "var(--color-primary)",
                  opacity: d.total ? 1 : 0.25,
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            { k: "Today", v: s.today },
            { k: "This week", v: s.week },
            { k: "In progress", v: s.processing },
          ].map((x) => (
            <div key={x.k} className="rounded-2xl bg-slate-50/80 py-2 border border-slate-200/40">
              <div className="text-lg font-bold text-foreground">{x.v}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500/70">{x.k}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
