import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpRight, ArrowDownRight, Target, Store, Trophy, TrendingUp, Wallet } from "lucide-react";
import { getDashboardKpis } from "@/lib/kpis.functions";
import { usePlanFeatures } from "@/lib/use-plan-features";

const ROLE_LABEL: Record<string, string> = {
  franchise_owner: "Franchise Owner",
  retailer: "Retailer",
  franchise_as_retailer: "Franchise-as-Retailer",
  field_worker: "Field Worker",
  asm: "ASM",
};

function fmt(n: number) {
  return "PKR " + (n ?? 0).toLocaleString();
}

export function DashboardKpis() {
  const { can } = usePlanFeatures();
  const fetchKpis = useServerFn(getDashboardKpis);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-kpis"],
    queryFn: () => fetchKpis(),
  });

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  const mom = data.mom.count_pct;
  const momAmt = data.mom.amount_pct;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-5">
        <KpiTile
          label="Activations MTD"
          value={data.mtd.count.toLocaleString()}
          sub={
            mom === null
              ? "no prior month data"
              : `${mom >= 0 ? "+" : ""}${mom}% vs last month same day`
          }
          tone={mom === null ? undefined : mom >= 0 ? "up" : "down"}
        />
        {can("commissions") && (
          <>
            <KpiTile
              label="Partner Comm. MTD"
              value={fmt(data.mtd.amount)}
              sub={
                momAmt === null
                  ? "no prior month data"
                  : `${momAmt >= 0 ? "+" : ""}${momAmt}% vs last month same day`
              }
              tone={momAmt === null ? undefined : momAmt >= 0 ? "up" : "down"}
            />
            <KpiTile
              label="Total Expenses MTD"
              value={fmt(data.mtd.total_expenses)}
              sub={`${fmt(data.mtd.employee_cost)} salaries included`}
              icon={Wallet}
            />
          </>
        )}
        <KpiTile
          label="Projected month-end"
          value={data.projected.count.toLocaleString()}
          sub={can("commissions") ? `${fmt(data.projected.amount)} · pace of day ${data.day_of_month}` : `pace of day ${data.day_of_month}`}
          icon={TrendingUp}
        />
        <KpiTile
          label="Last month total"
          value={data.last_full.count.toLocaleString()}
          sub={can("commissions") ? fmt(data.last_full.amount) : `${data.last_full.count.toLocaleString()} activations`}
        />
      </div>


      {can("leaderboard") && (
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-2xl border-slate-200/60 shadow-sm">



          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><Trophy className="w-4 h-4" /> Top partners this month</CardTitle>
            <Link to="/admin/leaderboard" className="text-xs text-primary hover:underline">View all →</Link>
          </CardHeader>
          <CardContent>
            {data.top_partners.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">No linked activations yet this month.</div>
            ) : (
              <div className="space-y-2">
                {data.top_partners.map((p, i) => (
                  <div key={p.partner_id} className="flex items-center gap-3">
                    <div className={"h-7 w-7 rounded-2xl grid place-items-center text-xs font-bold " + medalTone(i)}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <Link
                        to="/admin/performance/$partnerId"
                        params={{ partnerId: p.partner_id }}
                        className="font-medium text-sm truncate block hover:underline"
                      >
                        {p.name}
                      </Link>
                      <div className="text-[11px] text-muted-foreground">{ROLE_LABEL[p.role] ?? p.role}</div>
                    </div>
                    <div className="text-sm font-semibold tabular-nums">{p.count}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200/60 shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><Store className="w-4 h-4" /> Top stores this month</CardTitle>
            <Link to="/admin/stores" className="text-xs text-primary hover:underline">View all →</Link>
          </CardHeader>
          <CardContent>
            {data.top_stores.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">No store activity yet this month.</div>
            ) : (
              <div className="space-y-2">
                {data.top_stores.map((s, i) => (
                  <div key={s.store_id} className="flex items-center gap-3">
                    <div className={"h-7 w-7 rounded-2xl grid place-items-center text-xs font-bold " + medalTone(i)}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{s.store_id}</div>
                      <div className="text-[11px] text-muted-foreground">{fmt(s.amount)}</div>
                    </div>
                    <div className="text-sm font-semibold tabular-nums">{s.count}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-slate-900 text-white shadow-2xl rounded-2xl">
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-2xl bg-white/15 blur-2xl pointer-events-none" />
          <div className="absolute -left-10 -bottom-10 h-28 w-28 rounded-2xl bg-white/10 blur-2xl pointer-events-none" />
          <CardHeader className="pb-2 flex flex-row items-center justify-between relative">
            <CardTitle className="text-sm flex items-center gap-2 text-white"><Target className="w-4 h-4" /> Near next slab</CardTitle>
            <Link to="/admin/leaderboard" className="text-xs font-semibold uppercase tracking-wider text-white/90 hover:text-white">Leaderboard →</Link>
          </CardHeader>
          <CardContent className="relative">
            {data.near_slab.length === 0 ? (
              <div className="text-xs text-white/85 italic">No partners within 3 activations of a slab bump.</div>
            ) : (
              <div className="space-y-2">
                {data.near_slab.map((n) => (
                  <Link
                    key={n.partner_id}
                    to="/admin/performance/$partnerId"
                    params={{ partnerId: n.partner_id }}
                    className="flex items-center gap-2 hover:bg-white/10 -mx-2 px-2 py-1 rounded-2xl"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate text-white">{n.name}</div>
                      <div className="text-[11px] text-white/80">
                        {n.count} → {n.next_at} · unlocks {fmt(n.next_rate)}/act
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs bg-white/15 text-white border-white/30">
                      {n.to_go} to go
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
      )}
    </div>
  );
}

function medalTone(i: number) {
  if (i === 0) return "bg-amber-400/20 text-amber-700";
  if (i === 1) return "bg-slate-300/40 text-slate-700";
  if (i === 2) return "bg-orange-400/20 text-orange-700";
  return "bg-muted text-muted-foreground";
}

function KpiTile({
  label,
  value,
  sub,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "up" | "down";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const ToneIcon = tone === "up" ? ArrowUpRight : tone === "down" ? ArrowDownRight : Icon;
  return (
    <Card className="relative overflow-hidden rounded-2xl border-slate-200/60 shadow-sm">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500/80">{label}</div>
          {ToneIcon && (
            <div
              className={
                "h-6 w-6 rounded-2xl grid place-items-center " +
                (tone === "up"
                  ? "bg-emerald-500/10 text-emerald-600"
                  : tone === "down"
                  ? "bg-red-500/10 text-red-600"
                  : "bg-muted text-muted-foreground")
              }
            >
              <ToneIcon className="w-3.5 h-3.5" />
            </div>
          )}
        </div>
        <div className="text-2xl font-bold tracking-tight mt-1.5 tabular-nums">{value}</div>
        <div
          className={
            "text-[11px] mt-1 font-medium " +
            (tone === "up" ? "text-emerald-600" : tone === "down" ? "text-red-600" : "text-muted-foreground")
          }
        >
          {sub}
        </div>
      </CardContent>
    </Card>
  );
}

