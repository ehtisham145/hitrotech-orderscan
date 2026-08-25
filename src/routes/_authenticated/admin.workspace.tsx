import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/SettingsSubNav";
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/ext-client";
import { useWorkspace } from "@/components/WorkspaceContext";
import { renameWorkspace, deleteWorkspace } from "@/lib/workspace.functions";
import { getWorkspaceBilling } from "@/lib/workspace-members.functions";
import { PermissionDenied } from "@/components/PermissionDenied";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Trash2, Save, Sparkles, Users } from "lucide-react";
import {
  WorkspaceBrandingCard,
  TeamRolesCard,
  LockedMonthsCard,
  StatsCard,
  ExportCard,
} from "./admin.settings";

const PLAN_META: Record<string, { label: string; blurb: string; tone: string }> = {
  free:       { label: "Free",       blurb: "For getting started",       tone: "bg-muted text-muted-foreground border-border" },
  starter:    { label: "Starter",    blurb: "For small teams",           tone: "bg-primary/10 text-primary border-primary/20" },
  pro:        { label: "Pro",        blurb: "For growing operations",    tone: "bg-primary/15 text-primary border-primary/30" },
  enterprise: { label: "Enterprise", blurb: "Custom terms & higher caps", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" },
};

export const Route = createFileRoute("/_authenticated/admin/workspace")({
  head: () => ({
    meta: [
      { title: "Workspace Settings — HitroTech OrderScan" },
      { name: "description", content: "Rename or delete your workspace." },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: WorkspaceSettingsPage,
});

function WorkspaceSettingsPage() {
  const { workspace, loading, isSuperAdmin, isImpersonating } = useWorkspace();
  const showSuperAdminPlan = isSuperAdmin && !isImpersonating;
  const renameFn = useServerFn(renameWorkspace);
  const deleteFn = useServerFn(deleteWorkspace);
  const billingFn = useServerFn(getWorkspaceBilling);

  const { data: billing } = useQuery({
    queryKey: ["workspace-billing", workspace?.id],
    queryFn: () => billingFn(),
    enabled: !!workspace,
    staleTime: 30_000,
  });

  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (workspace) setName(workspace.name);
  }, [workspace]);

  const isOwner = workspace?.role === "owner";
  const canRename = isOwner || workspace?.role === "admin";

  const renameM = useMutation({
    mutationFn: async () => renameFn({ data: { workspaceId: workspace!.id, name } }),
    onSuccess: () => {
      toast.success("Workspace renamed");
      window.location.reload();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: async () =>
      deleteFn({ data: { workspaceId: workspace!.id, confirmName: confirmText } }),
    onSuccess: () => {
      toast.success("Workspace deleted");
      window.location.href = "/";
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading || !workspace) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!canRename) {
    return (
      <PermissionDenied
        title="Workspace settings are admin-only"
        action="rename or delete this workspace"
        requires="admin"
      />
    );
  }

  return (
    <SettingsLayout>
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workspace Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your workspace name and access.</p>
      </div>

      <Card className="p-5 space-y-4 rounded-2xl">
        <div>
          <h2 className="text-base font-semibold">General</h2>
          <p className="text-xs text-muted-foreground">Rename your workspace. Slug and members are unaffected.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ws-name">Workspace name</Label>
          <Input
            id="ws-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canRename}
            maxLength={80}
          />
          <div className="text-[11px] text-muted-foreground">Slug: {workspace.slug}</div>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => renameM.mutate()}
            disabled={!canRename || renameM.isPending || !name.trim() || name.trim() === workspace.name}
            size="sm"
          >
            <Save className="w-4 h-4 mr-1.5" />
            {renameM.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-4 rounded-2xl">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Plan &amp; seats
            </h2>
            <p className="text-xs text-muted-foreground">Your workspace's subscription tier and how many people can join.</p>
          </div>
          {showSuperAdminPlan ? (
            <Badge variant="outline" className="text-[11px] uppercase tracking-wider px-2 py-0.5 bg-primary/10 text-primary border-primary/20 rounded-2xl">
              Super Admin
            </Badge>
          ) : billing && (
            <Badge variant="outline" className={`text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-2xl ${PLAN_META[billing.planTier]?.tone ?? ""}`}>
              {PLAN_META[billing.planTier]?.label ?? billing.planTier}
            </Badge>
          )}
        </div>
        {showSuperAdminPlan ? (
          <>
            <div className="text-xs text-muted-foreground -mt-2">
              Unlimited access across all workspaces
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Users className="w-3.5 h-3.5" /> Seats
                </span>
                <span className="font-bold text-primary">∞</span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {billing?.membersCount ?? 0} active member{(billing?.membersCount ?? 0) === 1 ? "" : "s"}
                {(billing?.pendingInvites ?? 0) > 0 && ` · ${billing?.pendingInvites} pending invite${billing?.pendingInvites === 1 ? "" : "s"}`}
              </div>
            </div>
          </>
        ) : billing ? (
          <>
            <div className="text-xs text-muted-foreground -mt-2">
              {PLAN_META[billing.planTier]?.blurb}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Users className="w-3.5 h-3.5" /> Seats
                </span>
                <span className={billing.seatsUsed >= billing.seatLimit ? "font-medium text-destructive" : "font-medium"}>
                  {billing.seatsUsed} <span className="text-muted-foreground font-normal">/ {billing.seatLimit}</span>
                </span>
              </div>
              <Progress
                value={billing.seatLimit > 0 ? Math.min(100, (billing.seatsUsed / billing.seatLimit) * 100) : 0}
                className="h-1.5"
              />
              <div className="text-[11px] text-muted-foreground">
                {billing.membersCount} active member{billing.membersCount === 1 ? "" : "s"}
                {billing.pendingInvites > 0 && ` · ${billing.pendingInvites} pending invite${billing.pendingInvites === 1 ? "" : "s"}`}
                {billing.seatsUsed >= billing.seatLimit && " · seat limit reached"}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
              <div className="text-xs text-muted-foreground">
                {billing.planTier === "enterprise"
                  ? "You're on our highest tier. Need custom terms? Reach out."
                  : "Need more seats or a higher tier? Upgrade your plan."}
              </div>
              {billing.planTier === "enterprise" ? (
                <Button size="sm" variant="outline" asChild>
                  <a href="mailto:telecom@hitrotech.com?subject=Enterprise%20plan%20inquiry">Contact sales</a>
                </Button>
              ) : (
                <Button size="sm" asChild>
                  <a href="/admin/billing">Upgrade plan</a>
                </Button>
              )}
            </div>

          </>
        ) : (
          <div className="text-xs text-muted-foreground">Loading plan…</div>
        )}
      </Card>


      <WorkspaceBrandingCard />
      <TeamRolesCard />
      <StatsCard />
      <LockedMonthsCard />
      <ExportCard />


      {isOwner && (
        <Card className="p-5 space-y-4 border-destructive/40 rounded-2xl">
          <div>
            <h2 className="text-base font-semibold text-destructive">Danger zone</h2>
            <p className="text-xs text-muted-foreground">
              Permanently delete this workspace and all of its data (batches, orders, partners, payouts, etc). This cannot be undone.
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="w-4 h-4 mr-1.5" /> Delete workspace
          </Button>
        </Card>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={(o) => { if (!o) { setConfirmDelete(false); setConfirmText(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{workspace.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the workspace and all associated data. Type <span className="font-semibold">{workspace.name}</span> below to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={workspace.name}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteM.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteM.isPending || confirmText.trim() !== workspace.name}
              onClick={(e) => { e.preventDefault(); deleteM.mutate(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteM.isPending ? "Deleting…" : "Delete forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </SettingsLayout>
  );
}
