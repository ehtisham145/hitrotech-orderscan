import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { listAllWorkspaces, updateWorkspacePlan } from "@/lib/workspace-members.functions";
import { setActiveWorkspace } from "@/lib/workspace.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Users, ArrowRight, Sparkles, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

type Plan = "free" | "starter" | "pro" | "enterprise";

const PLAN_TONE: Record<Plan, string> = {
  free: "bg-muted text-muted-foreground border-border",
  starter: "bg-primary/10 text-primary border-primary/20",
  pro: "bg-primary/15 text-primary border-primary/30",
  enterprise: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
};

export const Route = createFileRoute("/_authenticated/superadmin")({
  head: () => ({
    meta: [
      { title: "All Workspaces — HitroTech OrderScan" },
      { name: "description", content: "Super admin view of every workspace in the platform." },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: r } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id).eq("role", "super_admin").maybeSingle();
    if (!r) throw redirect({ to: "/dashboard" });
  },
  component: SuperAdminPage,
});

function SuperAdminPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (pathname !== "/superadmin") {
    return <Outlet />;
  }

  return <SuperAdminWorkspaceList />;
}

function SuperAdminWorkspaceList() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAllWorkspaces);
  const setActiveFn = useServerFn(setActiveWorkspace);
  const updatePlanFn = useServerFn(updateWorkspacePlan);

  const { data: superAdminIds } = useQuery({
    queryKey: ["super-admin-ids"],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("user_id").eq("role", "super_admin");
      return new Set((data ?? []).map(r => r.user_id));
    }
  });
  const { data, isLoading } = useQuery({
    queryKey: ["superadmin-workspaces"],
    queryFn: () => listFn(),
  });

  const [editing, setEditing] = useState<{ id: string; name: string; plan: Plan; seatLimit: number } | null>(null);
  const [query, setQuery] = useState("");
  const [planFilter, setPlanFilter] = useState<"all" | Plan>("all");
  const [sortBy, setSortBy] = useState<"created" | "name" | "members" | "plan">("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const updatePlanM = useMutation({
    mutationFn: async (v: { workspaceId: string; planTier: Plan; seatLimit: number }) => updatePlanFn({ data: v }),
    onSuccess: () => {
      toast.success("Plan updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["superadmin-workspaces"] });
      qc.invalidateQueries({ queryKey: ["workspace-billing"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function enter(wsId: string) {
    try {
      await setActiveFn({ data: { workspaceId: wsId } });
      window.location.href = "/dashboard";
    } catch (e: any) {
      toast.error(e.message ?? "Failed to enter workspace");
    }
  }

  const q = query.trim().toLowerCase();
  const PLAN_RANK: Record<Plan, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 };
  const filtered = (data ?? [])
    .filter((w: any) => {
      if (planFilter !== "all" && (w.planTier ?? "free") !== planFilter) return false;
      if (!q) return true;
      const hay = [w.name, w.slug, w.planTier, w.owner?.email, w.owner?.full_name]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    })
    .slice()
    .sort((a: any, b: any) => {
      let cmp = 0;
      if (sortBy === "name") cmp = String(a.name).localeCompare(String(b.name));
      else if (sortBy === "members") cmp = (a.memberCount ?? 0) - (b.memberCount ?? 0);
      else if (sortBy === "plan") cmp = (PLAN_RANK[(a.planTier ?? "free") as Plan] ?? 0) - (PLAN_RANK[(b.planTier ?? "free") as Plan] ?? 0);
      else cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">All Workspaces</h1>
        <p className="text-sm text-muted-foreground">Super-admin view of every workspace on the platform.</p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or plan…"
            className="pl-9"
          />
        </div>
        <Select value={planFilter} onValueChange={(v) => setPlanFilter(v as any)}>
          <SelectTrigger className="w-full sm:w-[140px]"><SelectValue placeholder="Plan" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plans</SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="starter">Starter</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="enterprise">Enterprise</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
          <SelectTrigger className="w-full sm:w-[160px]"><SelectValue placeholder="Sort by" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="created">Created</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="members">Members</SelectItem>
            <SelectItem value="plan">Plan</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          title={sortDir === "asc" ? "Ascending" : "Descending"}
        >
          {sortDir === "asc" ? "Asc ↑" : "Desc ↓"}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-lg">
          {q || planFilter !== "all" ? "No workspaces match your filters." : "No workspaces yet."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((w: any) => {
            const plan = (w.planTier ?? "free") as Plan;
            return (
            <Card key={w.id} className="p-4 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg gradient-brand text-primary-foreground grid place-items-center shrink-0">
                  <Building2 className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-medium text-sm truncate">{w.name}</div>
                    <Badge variant="outline" className={`text-[10px] uppercase tracking-wider px-1.5 py-0 h-4 ${PLAN_TONE[plan]}`}>
                      {plan}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {(w.owner as any)?.email ?? "Unknown owner"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Created {formatDistanceToNow(new Date(w.createdAt), { addSuffix: true })}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> {w.memberCount} / {w.seatLimit ?? 0}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing({ id: w.id, name: w.name, plan, seatLimit: w.seatLimit ?? 3 })}
                    title="Change plan and seats"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => enter(w.id)}>
                    Enter <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit plan · {editing?.name}</DialogTitle>
            <DialogDescription>
              Change the plan tier and seat cap for this workspace.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Plan tier</Label>
                <Select value={editing.plan} onValueChange={(v) => setEditing({ ...editing, plan: v as Plan })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="pro">Pro</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seat-limit">Seat limit</Label>
                <Input
                  id="seat-limit"
                  type="number"
                  min={1}
                  max={10000}
                  value={editing.seatLimit}
                  onChange={(e) => setEditing({ ...editing, seatLimit: Math.max(1, Number(e.target.value) || 1) })}
                />
                <div className="text-[11px] text-muted-foreground">
                  Includes active members and pending non-expired invites.
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={!editing || updatePlanM.isPending}
              onClick={() => editing && updatePlanM.mutate({ workspaceId: editing.id, planTier: editing.plan, seatLimit: editing.seatLimit })}
            >
              {updatePlanM.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
