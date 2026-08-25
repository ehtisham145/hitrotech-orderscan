import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, ArrowUp } from "lucide-react";
import { format } from "date-fns";
import { getLeaderboard } from "@/lib/performance.functions";
import { listStores } from "@/lib/stores.functions";
import type { PartnerRole } from "@/lib/partners.functions";
import { EmptyState } from "@/components/EmptyState";
import { requireWorkspaceRole } from "@/lib/route-guards";
import { PlanGate } from "@/components/PlanGate";

const ROLE_LABEL: Record<string, string> = {
  franchise_owner: "Franchise Owner",
  retailer: "Retailer",
  franchise_as_retailer: "Franchise-as-Retailer",
};
const ROLES: Array<PartnerRole | "all"> = ["all", "franchise_owner", "retailer", "franchise_as_retailer"];

export const Route = createFileRoute("/_authenticated/admin/leaderboard")({
  head: () => ({
    meta: [
      { title: "Leaderboard — HitroTech OrderScan" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "manager", "accountant"] as const);
  },
  component: () => <PlanGate feature="leaderboard"><LeaderboardPage /></PlanGate>,
});

function LeaderboardPage() {
  const fetchList = useServerFn(getLeaderboard);
  const fetchStores = useServerFn(listStores);
  const { data: storeRows } = useQuery({ queryKey: ["stores"], queryFn: () => fetchStores() });
  const storeOptions = ["all", ...((storeRows ?? []).map((s) => s.code))];
  const [month, setMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [role, setRole] = useState<PartnerRole | "all">("all");
  const [store, setStore] = useState<string>("all");

  const monthDate = month + "-01";
  const { data, isLoading } = useQuery({
    queryKey: ["leaderboard", monthDate, role, store],
    queryFn: () => fetchList({ data: { month: monthDate, role, store_id: store } }),
  });

  const rows = data?.rows ?? [];
  const totalCommission = rows.reduce((acc, r) => acc + r.commission, 0);
  const totalActivations = rows.reduce((acc, r) => acc + r.count, 0);
  const fmt = (n: number) => "PKR " + n.toLocaleString();

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="text-sm text-muted-foreground">Partner rankings for {format(new Date(monthDate), "MMMM yyyy")}.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 px-3 rounded-md border border-input bg-background text-sm"
          />
        </div>
      </div>

      <Card>
        <CardContent className="pt-5 flex flex-wrap gap-2 items-center">
          <span className="text-xs uppercase tracking-wider text-muted-foreground mr-1">Role</span>
          {ROLES.map((r) => (
            <Button key={r} size="sm" variant={role === r ? "default" : "outline"} onClick={() => setRole(r as PartnerRole | "all")}>
              {r === "all" ? "All" : ROLE_LABEL[r]}
            </Button>
          ))}
          <span className="text-xs uppercase tracking-wider text-muted-foreground ml-4 mr-1">Store</span>
          {storeOptions.map((s) => (
            <Button key={s} size="sm" variant={store === s ? "default" : "outline"} onClick={() => setStore(s)}>
              {s === "all" ? "All" : s}
            </Button>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Partners" value={rows.length.toString()} sub="matching filters" />
        <SummaryCard label="Activations" value={totalActivations.toLocaleString()} sub="this month" />
        <SummaryCard label="Commission" value={fmt(totalCommission)} sub="this month" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Rankings</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : rows.length === 0 ? (
            <EmptyState icon={Trophy} title="No partners yet" description="Add partners and link activations to see rankings." />
          ) : (
            <div className="divide-y">
              {rows.map((r, i) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="w-7 text-center font-semibold text-muted-foreground">{i + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{r.name}</span>
                      {!r.active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                      <Badge variant="secondary" className="text-xs">{ROLE_LABEL[r.role]}</Badge>
                      {r.store_id && <Badge variant="outline" className="text-xs">{r.store_id}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {r.count} activation{r.count === 1 ? "" : "s"} · rate {fmt(r.current_rate)}/activation
                      {r.to_go !== null && r.next_rate !== null && r.to_go > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1 text-primary">
                          <ArrowUp className="w-3 h-3" />
                          {r.to_go} more to reach {fmt(r.next_rate)}/activation
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold">{fmt(r.commission)}</div>
                    <div className="text-[11px] text-muted-foreground">earned</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}
