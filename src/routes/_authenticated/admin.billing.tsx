import { createFileRoute, Link } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/SettingsSubNav";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useWorkspace } from "@/components/WorkspaceContext";
import { supabase } from "@/integrations/supabase/ext-client";
import { getWorkspacePlan, listWorkspaceBillingRequests, listWorkspaceRefundRequests } from "@/lib/billing.functions";
import { getPlan, formatPkr } from "@/lib/plans";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireWorkspaceRole } from "@/lib/route-guards";
import { format } from "date-fns";
import { Sparkles, ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/billing")({
  head: () => ({
    meta: [
      { title: "Billing & Plan — HitroTech OrderScan" },
      { name: "description", content: "Manage your workspace plan and payments." },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: () => requireWorkspaceRole(["owner", "admin"]),
  component: BillingPage,
});

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-red-500/10 text-red-700 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

function BillingPage() {
  const { workspace, isSuperAdmin, isImpersonating } = useWorkspace();
  // When a super admin enters someone else's workspace they operate fully inside
  // that account, so they must see that workspace's real plan and payments.
  // HOWEVER, when they are in their OWN workspace, they should see their Super Admin status.
  const showSuperAdminCard = isSuperAdmin && !isImpersonating;
  const getPlanFn = useServerFn(getWorkspacePlan);
  const listFn = useServerFn(listWorkspaceBillingRequests);
  const refundsFn = useServerFn(listWorkspaceRefundRequests);

  const { data: ownerSuperStatus } = useQuery({
    queryKey: ["owner-super-status", workspace?.owner_id],
    queryFn: async () => {
      if (!workspace?.owner_id) return false;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", workspace.owner_id).eq("role", "super_admin").maybeSingle();
      return !!data;
    },
    enabled: !!workspace,
  });

  const isOwnerSuperAdmin = !!ownerSuperStatus;
  const isEffectiveSuperAdmin = showSuperAdminCard || isOwnerSuperAdmin;


  const { data: plan } = useQuery({
    queryKey: ["workspace-plan", workspace?.id],
    queryFn: () => getPlanFn({ data: { workspaceId: workspace!.id } }),
    enabled: !!workspace && !isEffectiveSuperAdmin,
  });

  const { data: requests } = useQuery({
    queryKey: ["billing-requests", workspace?.id],
    queryFn: () => listFn({ data: { workspaceId: workspace!.id } }),
    enabled: !!workspace && !isEffectiveSuperAdmin,
  });

  const { data: refunds } = useQuery({
    queryKey: ["refund-requests", workspace?.id],
    queryFn: () => refundsFn({ data: { workspaceId: workspace!.id } }),
    enabled: !!workspace && !isEffectiveSuperAdmin,
  });

  if (!workspace) return null;
  const currentPlan = isEffectiveSuperAdmin ? getPlan("enterprise") : getPlan(plan?.plan_tier);
  const expiresAt = plan?.plan_expires_at ? new Date(plan.plan_expires_at) : null;
  const isActive = isEffectiveSuperAdmin || (currentPlan.id !== "free" && expiresAt && expiresAt > new Date());



  return (
    <SettingsLayout>
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing & Plan</h1>
        <p className="text-sm text-muted-foreground">Manage your subscription for {workspace.name}.</p>
      </div>

      {isEffectiveSuperAdmin ? (
        <Card className="p-6 border-primary/30 bg-primary/5 rounded-2xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Current plan</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xl font-semibold">Unlimited</span>
                <Badge>Super Admin</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Super admins have unrestricted access across all workspaces. No plan limits apply.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link to="/superadmin/billing">Manage plans</Link>
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 mt-6 text-sm">
            {[
              "Unlimited workspaces",
              "Unlimited team members",
              "Unlimited activations",
              "All features unlocked",
              "Cross-workspace administration",
              "Priority everything",
            ].map((f) => (
              <div key={f} className="flex gap-2">
                <Sparkles className="w-3.5 h-3.5 text-primary mt-1 shrink-0" />
                <span>{f}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card className="p-6 rounded-2xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Current plan</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xl font-semibold">{isOwnerSuperAdmin ? "Unlimited (Super Admin)" : currentPlan.name}</span>
                {currentPlan.id !== "free" && (
                  <Badge variant={isActive ? "default" : "destructive"}>
                    {isActive ? "Active" : "Expired"}
                  </Badge>
                )}
              </div>
              {isOwnerSuperAdmin ? (
                <Badge className="mt-2 bg-primary/10 text-primary border-primary/20 rounded-2xl">SUPER ADMIN VIEW</Badge>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">{currentPlan.tagline}</p>
              )}
              {expiresAt && (
                <p className="text-xs text-muted-foreground mt-2">
                  {isActive ? "Renews / expires" : "Expired"} on{" "}
                  <b>{format(expiresAt, "MMM d, yyyy")}</b>
                </p>
              )}
            </div>
            <Button asChild>
              <Link to="/onboarding/plan">
                {currentPlan.id === "free" ? "Upgrade" : "Change plan / Renew"}
                <ArrowUpRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-6">
            {[
              { label: "Team seats", value: String(currentPlan.seatLimit) },
              {
                label: "Employees",
                value:
                  currentPlan.employeeLimit === null
                    ? "Unlimited"
                    : String(currentPlan.employeeLimit),
              },
              {
                label: "Activations / month",
                value:
                  currentPlan.activationsPerMonth === null
                    ? "Unlimited"
                    : currentPlan.activationsPerMonth.toLocaleString(),
              },
              {
                label: "Partners",
                value:
                  currentPlan.partnerLimit === null
                    ? "Unlimited"
                    : String(currentPlan.partnerLimit),
              },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border bg-muted/30 px-3 py-2">
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className="text-lg font-semibold">{s.value}</div>
              </div>
            ))}
          </div>


          <div className="mt-6">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              What's included
            </div>
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              {currentPlan.features.map((f) => (
                <div key={f} className="flex gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-primary mt-1 shrink-0" />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {!isEffectiveSuperAdmin && plan?.scheduled_plan_tier && plan.scheduled_starts_at && (
        <Card className="p-4 border-amber-500/40 bg-amber-500/5 rounded-2xl">
          <div className="text-sm">
            <span className="font-medium">Scheduled plan change · </span>
            You keep {currentPlan.name} until{" "}
            <b>{format(new Date(plan.scheduled_starts_at), "MMM d, yyyy")}</b>, then your workspace
            moves to <b className="capitalize">{plan.scheduled_plan_tier}</b>
            {plan.scheduled_months ? ` for ${plan.scheduled_months} month${plan.scheduled_months === 1 ? "" : "s"}` : ""}.
            No paid time is lost.
          </div>
        </Card>
      )}




      {!isEffectiveSuperAdmin && (
        <Card className="p-6 rounded-2xl">
          <h2 className="font-semibold mb-4">Payment history</h2>
          {!requests || requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payment requests yet.</p>
          ) : (
            <div className="divide-y">
              {requests.map((r) => (
                <div key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium capitalize">
                      {r.plan_tier} · {formatPkr(r.amount_pkr)} · {r.months} mo
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(r.created_at), "MMM d, yyyy 'at' h:mm a")}
                      {r.payment_reference && <> · Ref: {r.payment_reference}</>}
                    </div>
                    {r.admin_note && (
                      <div className="text-xs text-muted-foreground mt-1">Note: {r.admin_note}</div>
                    )}
                  </div>
                  <Badge className={(STATUS_STYLE[r.status] ?? "") + " rounded-2xl"} variant="secondary">
                    {r.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
      {!isEffectiveSuperAdmin && refunds && refunds.length > 0 && (
        <Card className="p-6 rounded-2xl">
          <h2 className="font-semibold mb-4">Refund requests</h2>
          <div className="divide-y">
            {refunds.map((r: any) => (
              <div key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {formatPkr(r.amount_pkr)} · {r.unused_days} unused day(s)
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(r.created_at), "MMM d, yyyy 'at' h:mm a")}
                  </div>
                  {r.admin_note && (
                    <div className="text-xs text-muted-foreground mt-1">Note: {r.admin_note}</div>
                  )}
                </div>
                <Badge className={(STATUS_STYLE[r.status] ?? "") + " rounded-2xl"} variant="secondary">
                  {r.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
    </SettingsLayout>
  );
}
