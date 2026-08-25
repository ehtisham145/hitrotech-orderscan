import { createFileRoute, redirect, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { listPartners, deletePartner } from "@/lib/partners.functions";
import { EmptyState } from "@/components/EmptyState";
import { requireWorkspaceRole } from "@/lib/route-guards";
import { PlanGate } from "@/components/PlanGate";
import { useWorkspace } from "@/components/WorkspaceContext";
import { getPartnerLimit, getPlan } from "@/lib/plans";

const ROLE_LABEL: Record<string, string> = {
  franchise_owner: "Franchise Owner",
  retailer: "Retailer",
  franchise_as_retailer: "Franchise-as-Retailer",
};

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  franchise_owner: "default",
  retailer: "secondary",
  franchise_as_retailer: "outline",
};

export const Route = createFileRoute("/_authenticated/admin/partners")({
  head: () => ({
    meta: [
      { title: "Partners — HitroTech OrderScan" },
      { name: "description", content: "Manage retailers, franchisees, and field workers, their stores, and commission info." },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "manager", "accountant"] as const);
  },
  component: () => <PlanGate feature="partners"><PartnersRoute /></PlanGate>,
});

function PartnersRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (pathname !== "/admin/partners") {
    return <Outlet />;
  }

  return <PartnersList />;
}

function PartnersList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchList = useServerFn(listPartners);
  const doDelete = useServerFn(deletePartner);
  const { workspace, isSuperAdmin, isImpersonating } = useWorkspace();
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["partners"],
    queryFn: () => fetchList(),
  });

  const tier = workspace?.plan_tier;
  const limit = isSuperAdmin && !isImpersonating ? null : getPartnerLimit(tier);
  const used = (data ?? []).length;
  const atLimit = limit !== null && used >= limit;
  const planName = getPlan(tier).name;

  const del = useMutation({
    mutationFn: (id: string) => doDelete({ data: { id } }),
    onSuccess: () => {
      toast.success("Partner deleted");
      qc.invalidateQueries({ queryKey: ["partners"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = (data ?? []).filter((p) => {
    if (roleFilter !== "all" && p.role !== roleFilter) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      p.name.toLowerCase().includes(s) ||
      (p.phone ?? "").toLowerCase().includes(s) ||
      (p.cnic ?? "").toLowerCase().includes(s) ||
      (p.store_id ?? "").toLowerCase().includes(s) ||
      (p.city ?? "").toLowerCase().includes(s) ||
      ((p.match_keys as string[] | null) ?? []).some((k) => k.toLowerCase().includes(s))
    );
  });

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Partners</h1>
          <p className="text-sm text-muted-foreground">
            Retailers and franchisees linked to activations.
            {limit !== null ? (
              <span className="ml-1">
                Your {planName} plan allows <strong>{limit}</strong> partner{limit === 1 ? "" : "s"} ({used}/{limit} used).
              </span>
            ) : null}
          </p>
        </div>
        <Button
          onClick={() => navigate({ to: "/admin/partners/$id", params: { id: "new" } })}
          disabled={atLimit}
          title={atLimit ? `Your ${planName} plan is limited to ${limit} partner${limit === 1 ? "" : "s"}. Upgrade to add more.` : undefined}
        >
          <Plus className="w-4 h-4 mr-2" /> Add partner
        </Button>
      </div>
      {atLimit ? (
        <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-center justify-between gap-3">
          <span>You have reached the {limit}-partner limit on the {planName} plan.</span>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/billing">Upgrade plan</Link>
          </Button>
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="relative min-w-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, phone, CNIC, store, match keys…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex min-w-0 flex-wrap gap-2 lg:justify-end">
              {["all", "franchise_owner", "retailer", "franchise_as_retailer"].map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={roleFilter === r ? "default" : "outline"}
                  onClick={() => setRoleFilter(r)}
                >
                  {r === "all" ? "All" : ROLE_LABEL[r]}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="py-8">
                <EmptyState
                  icon={Users}
                  title={q || roleFilter !== "all" ? "No partners match" : "No partners yet"}
                  description={q || roleFilter !== "all" ? "Try clearing filters." : "Add your first retailer or franchisee."}
                  action={
                    q || roleFilter !== "all"
                      ? undefined
                      : { label: "Add partner", onClick: () => navigate({ to: "/admin/partners/$id", params: { id: "new" } }) }
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {filtered.map((p) => (
                <div key={p.id} className="overflow-hidden rounded-lg border bg-card shadow-sm">
                  <div className="space-y-4 p-4">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-semibold leading-tight">{p.name}</h2>
                        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                          {!p.active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                          <Badge variant={ROLE_VARIANT[p.role] ?? "outline"} className="text-xs">
                            {ROLE_LABEL[p.role] ?? p.role}
                          </Badge>
                          {p.store_id && <Badge variant="outline" className="text-xs">{p.store_id}</Badge>}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div className="min-w-0 rounded-md border bg-muted/30 p-3">
                        <div className="text-xs font-medium text-muted-foreground">Phone</div>
                        <div className="mt-1 truncate font-medium">{p.phone || "—"}</div>
                      </div>
                      <div className="min-w-0 rounded-md border bg-muted/30 p-3">
                        <div className="text-xs font-medium text-muted-foreground">CNIC</div>
                        <div className="mt-1 truncate font-medium">{p.cnic || "—"}</div>
                      </div>
                      <div className="min-w-0 rounded-md border bg-muted/30 p-3">
                        <div className="text-xs font-medium text-muted-foreground">City</div>
                        <div className="mt-1 truncate font-medium">{p.city || "—"}</div>
                      </div>
                      <div className="min-w-0 rounded-md border bg-muted/30 p-3">
                        <div className="text-xs font-medium text-muted-foreground">Address</div>
                        <div className="mt-1 truncate font-medium">{p.address || "—"}</div>
                      </div>
                    </div>

                    {((p.match_keys as string[] | null) ?? []).length > 0 && (
                      <div className="break-words text-xs text-muted-foreground">
                        Match keys: <span className="text-foreground">{((p.match_keys as string[] | null) ?? []).join(", ")}</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t bg-muted/20 p-3 md:flex md:justify-end">
                    <Button size="sm" variant="outline" className="w-full md:w-auto" asChild>
                      <Link to="/admin/performance/$partnerId" params={{ partnerId: p.id }}>Performance</Link>
                    </Button>
                    <Button size="sm" variant="outline" className="w-full md:w-auto" asChild>
                      <Link to="/admin/statements/$partnerId" params={{ partnerId: p.id }}>Statement</Link>
                    </Button>
                    <Button size="sm" variant="outline" className="w-full md:w-auto" asChild>
                      <Link to="/admin/partners/$id" params={{ id: p.id }}>Edit</Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-destructive md:w-auto"
                      onClick={async () => {
                        if (await confirmDialog({ title: `Delete ${p.name}?`, description: "Their past activations will remain but become unlinked.", confirmLabel: "Delete", destructive: true })) {
                          del.mutate(p.id);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
