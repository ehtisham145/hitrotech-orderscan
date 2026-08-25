import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Calendar, Store, Phone, Hash, Repeat, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { EmptyState } from "@/components/EmptyState";
import { listAnomalies } from "@/lib/reliability.functions";
import { requireWorkspaceRole } from "@/lib/route-guards";
import { PlanGate } from "@/components/PlanGate";

const FLAG_META: Record<string, { label: string; icon: typeof AlertTriangle; tone: string }> = {
  future_activation_date: { label: "Future date", icon: Calendar, tone: "text-amber-600 border-amber-500/40 bg-amber-500/10" },
  unknown_store_id: { label: "Unknown store", icon: Store, tone: "text-orange-600 border-orange-500/40 bg-orange-500/10" },
  missing_phone: { label: "Missing phone", icon: Phone, tone: "text-red-600 border-red-500/40 bg-red-500/10" },
  malformed_phone: { label: "Malformed phone", icon: Phone, tone: "text-red-600 border-red-500/40 bg-red-500/10" },
  missing_order_number: { label: "No order #", icon: Hash, tone: "text-slate-600 border-slate-500/40 bg-slate-500/10" },
  repeat_phone_this_month: { label: "Repeat phone", icon: Repeat, tone: "text-purple-600 border-purple-500/40 bg-purple-500/10" },
};

export const Route = createFileRoute("/_authenticated/admin/anomalies")({
  head: () => ({
    meta: [
      { title: "Anomalies — HitroTech OrderScan" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "manager", "accountant"] as const);
  },
  component: () => <PlanGate feature="anomalies"><AnomaliesPage /></PlanGate>,
});

function AnomaliesPage() {
  const fetchList = useServerFn(listAnomalies);
  const [month, setMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [filter, setFilter] = useState<string>("all");

  const monthDate = month + "-01";
  const { data, isLoading } = useQuery({
    queryKey: ["anomalies", monthDate],
    queryFn: () => fetchList({ data: { month: monthDate } }),
  });

  const rows = data?.rows ?? [];
  const filtered = filter === "all" ? rows : rows.filter((r) => r.anomalies.includes(filter));

  // counts per flag
  const counts = new Map<string, number>();
  for (const r of rows) for (const f of r.anomalies) counts.set(f, (counts.get(f) ?? 0) + 1);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Anomalies</h1>
          <p className="text-sm text-muted-foreground">
            Suspicious activations that need review for {format(new Date(monthDate), "MMMM yyyy")}.
          </p>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm"
        />
      </div>

      <Card>
        <CardContent className="pt-5 flex flex-wrap gap-2 items-center">
          <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
            All <Badge variant="secondary" className="ml-2">{rows.length}</Badge>
          </Button>
          {Array.from(counts.entries()).map(([flag, count]) => {
            const meta = FLAG_META[flag] ?? { label: flag, icon: AlertTriangle, tone: "" };
            const Icon = meta.icon;
            return (
              <Button key={flag} size="sm" variant={filter === flag ? "default" : "outline"} onClick={() => setFilter(flag)}>
                <Icon className="w-3.5 h-3.5 mr-1" />
                {meta.label}
                <Badge variant="secondary" className="ml-2">{count}</Badge>
              </Button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Flagged activations</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="No anomalies" description="Everything looks clean for this filter." />
          ) : (
            <div className="divide-y">
              {filtered.map((r) => (
                <div key={r.id} className="py-3 flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{r.customer_name ?? "—"}</span>
                      {r.phone_number && <span className="text-xs text-muted-foreground">· {r.phone_number}</span>}
                      {r.order_number && <span className="text-xs text-muted-foreground">· {r.order_number}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {r.store_id ? `${r.store_id} · ` : ""}
                      {r.employee_name ? `${r.employee_name} · ` : ""}
                      {r.activation_date ?? "no date"}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {r.anomalies.map((f) => {
                        const meta = FLAG_META[f] ?? { label: f, icon: AlertTriangle, tone: "" };
                        const Icon = meta.icon;
                        return (
                          <span
                            key={f}
                            className={"inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] " + meta.tone}
                          >
                            <Icon className="w-3 h-3" />
                            {meta.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <Link
                    to="/batches/$id"
                    params={{ id: r.batch_id }}
                    className="text-xs inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Open batch <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
