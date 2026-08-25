import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, FileText, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { format } from "date-fns";
import { getPartnerHistory } from "@/lib/statements.functions";
import { requireWorkspaceRole } from "@/lib/route-guards";

const ROLE_LABEL: Record<string, string> = {
  franchise_owner: "Franchise Owner",
  retailer: "Retailer",
  franchise_as_retailer: "Franchise-as-Retailer",
  field_worker: "Field Worker",
  asm: "ASM",
};

export const Route = createFileRoute("/_authenticated/admin/performance/$partnerId")({
  head: () => ({
    meta: [
      { title: "Partner Performance — HitroTech OrderScan" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "manager", "accountant"] as const);
  },
  component: PerformancePage,
});

function fmt(n: number) {
  return "PKR " + n.toLocaleString();
}

function PerformancePage() {
  const { partnerId } = Route.useParams();
  const navigate = useNavigate();
  const fetchHistory = useServerFn(getPartnerHistory);
  const [months, setMonths] = useState<6 | 12>(6);

  const { data, isLoading } = useQuery({
    queryKey: ["partner-history", partnerId, months],
    queryFn: () => fetchHistory({ data: { partner_id: partnerId, months } }),
  });

  if (isLoading || !data) {
    return (
      <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const p = data.partner;
  const t = data.totals;
  const currentMonth = data.series[data.series.length - 1];
  const previousMonth = data.series[data.series.length - 2];
  const momCount =
    previousMonth && previousMonth.count > 0
      ? Math.round(((currentMonth.count - previousMonth.count) / previousMonth.count) * 100)
      : null;

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/admin/partners" })}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
            <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-xs">{ROLE_LABEL[p.role] ?? p.role}</Badge>
              {p.store_id && <Badge variant="outline" className="text-xs">{p.store_id}</Badge>}
              {!p.active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
              <span>{p.phone ?? "—"}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {([6, 12] as const).map((m) => (
            <Button key={m} size="sm" variant={months === m ? "default" : "outline"} onClick={() => setMonths(m)}>
              {m} months
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate({ to: "/admin/statements/$partnerId", params: { partnerId } })}
          >
            <FileText className="w-4 h-4 mr-1" /> Statement
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <KPI label="Activations" value={t.count.toString()} sub={`last ${t.months} months`} />
        <KPI label="Commission" value={fmt(t.commission)} sub={`avg ${fmt(t.months > 0 ? Math.round(t.commission / t.months) : 0)}/mo`} />
        <KPI
          label="Avg / day worked"
          value={t.avg_per_day.toString()}
          sub={`${t.avg_per_month}/month`}
        />
        <KPI
          label="This month"
          value={currentMonth.count.toString()}
          sub={
            momCount === null
              ? "no prior month"
              : `${momCount >= 0 ? "+" : ""}${momCount}% vs last`
          }
          tone={momCount === null ? undefined : momCount >= 0 ? "up" : "down"}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Activations by month
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--popover-foreground)",
                  }}
                  labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }}
                  itemStyle={{ color: "var(--popover-foreground)" }}
                />
                <Bar dataKey="count" fill="var(--primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Commission trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip
                  formatter={(v: number) => fmt(v)}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "hsl(var(--popover-foreground))",
                  }}
                  labelStyle={{ color: "hsl(var(--popover-foreground))", fontWeight: 600 }}
                  itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                />
                <Line
                  type="monotone"
                  dataKey="commission"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Monthly breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
                  <th className="py-2 pr-3">Month</th>
                  <th className="py-2 pr-3 text-right">Activations</th>
                  <th className="py-2 pr-3 text-right">Days worked</th>
                  <th className="py-2 pr-3 text-right">Avg / day</th>
                  <th className="py-2 pr-3 text-right">Commission</th>
                  <th className="py-2 pr-3">Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...data.series].reverse().map((r) => (
                  <tr key={r.month}>
                    <td className="py-2 pr-3 font-medium">{r.label}</td>
                    <td className="py-2 pr-3 text-right">{r.count}</td>
                    <td className="py-2 pr-3 text-right">{r.days_worked}</td>
                    <td className="py-2 pr-3 text-right">{r.avg_per_day}</td>
                    <td className="py-2 pr-3 text-right font-semibold">{fmt(r.commission)}</td>
                    <td className="py-2 pr-3">
                      {r.status === "paid" ? (
                        <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/15">
                          Paid
                          {r.paid_at ? ` · ${format(new Date(r.paid_at), "d MMM")}` : ""}
                        </Badge>
                      ) : r.status === "pending" ? (
                        <Badge variant="outline">Pending</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {t.best_month && (
            <div className="text-xs text-muted-foreground mt-3">
              Best month: <span className="font-medium text-foreground">{t.best_month}</span> ({t.best_month_count} activations)
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KPI({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "up" | "down" }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
        <div
          className={
            "text-[11px] mt-0.5 " +
            (tone === "up" ? "text-emerald-600" : tone === "down" ? "text-red-600" : "text-muted-foreground")
          }
        >
          {sub}
        </div>
      </CardContent>
    </Card>
  );
}
