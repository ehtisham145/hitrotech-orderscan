import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/SettingsSubNav";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useWorkspace } from "@/components/WorkspaceContext";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, Mail, UserPlus, Crown, ShieldCheck, LifeBuoy, UserPlus2, Loader2 } from "lucide-react";
import { AdminRecoveryDialog } from "@/components/AdminRecoveryDialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { PermissionDenied } from "@/components/PermissionDenied";
import { requireWorkspaceRole } from "@/lib/route-guards";
import {
  listWorkspaceMembers,
  updateMemberRole,
  removeMember,
  inviteMember,
  revokeInvite,
  resendInvite,
  transferOwnership,
  getWorkspaceBilling,
} from "@/lib/workspace-members.functions";

type Role = "admin" | "manager" | "employee" | "operator" | "accountant" | "partner";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({
    meta: [
      { title: "Members — HitroTech OrderScan" },
      { name: "description", content: "Manage workspace members, roles, and invites." },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "manager"] as const);
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    return { currentUserId: data.user.id };
  },
  component: MembersPage,
});

function MembersPage() {
  const qc = useQueryClient();
  const { isSuperAdmin, isImpersonating } = useWorkspace();
  const seatsUnlimited = isSuperAdmin && !isImpersonating;
  const { currentUserId } = Route.useRouteContext();

  const listFn = useServerFn(listWorkspaceMembers);
  const updateRoleFn = useServerFn(updateMemberRole);
  const removeFn = useServerFn(removeMember);
  const inviteFn = useServerFn(inviteMember);
  const revokeFn = useServerFn(revokeInvite);
  const resendFn = useServerFn(resendInvite);
  const transferFn = useServerFn(transferOwnership);
  const billingFn = useServerFn(getWorkspaceBilling);

  const { data, isLoading } = useQuery({
    queryKey: ["workspace-members"],
    queryFn: () => listFn(),
  });

  const { data: billing } = useQuery({
    queryKey: ["workspace-billing"],
    queryFn: () => billingFn(),
    staleTime: 30_000,
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("employee");
  const [pendingRemove, setPendingRemove] = useState<{ id: string; name: string } | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<{ userId: string; name: string } | null>(null);
  const [recoveryFor, setRecoveryFor] = useState<{ userId: string; name: string } | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["workspace-members"] });
    qc.invalidateQueries({ queryKey: ["workspace-billing"] });
  };

  const setRoleM = useMutation({
    mutationFn: async (v: { memberId: string; role: Role }) => updateRoleFn({ data: v }),
    onSuccess: () => { toast.success("Role updated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeM = useMutation({
    mutationFn: async (memberId: string) => removeFn({ data: { memberId } }),
    onSuccess: () => { toast.success("Member removed"); setPendingRemove(null); invalidate(); },
    onError: (e: Error) => { toast.error(e.message); setPendingRemove(null); },
  });

  const inviteM = useMutation({
    mutationFn: async () => inviteFn({ data: { email: inviteEmail.trim(), role: inviteRole, origin: window.location.origin } }),
    onSuccess: (res: any) => {
      if (res?.emailSent) {
        toast.success(`Invitation email sent to ${inviteEmail}`);
      } else {
        toast.warning(`Invite created for ${inviteEmail}, but email did not send`, {
          description: res?.emailError ?? "Check Resend connector setup",
        });
      }
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("employee");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeM = useMutation({
    mutationFn: async (inviteId: string) => revokeFn({ data: { inviteId } }),
    onSuccess: () => { toast.success("Invite revoked"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resendM = useMutation({
    mutationFn: async (inviteId: string) => resendFn({ data: { inviteId, origin: window.location.origin } }),
    onSuccess: (res: any) => {
      if (res?.emailSent) toast.success("Invitation email resent");
      else toast.warning("Invite extended but email did not send", { description: res?.emailError ?? "Check Resend connector setup" });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transferM = useMutation({
    mutationFn: async (newOwnerUserId: string) => transferFn({ data: { newOwnerUserId } }),
    onSuccess: () => { toast.success("Ownership transferred"); setPendingTransfer(null); invalidate(); },
    onError: (e: Error) => { toast.error(e.message); setPendingTransfer(null); },
  });

  const currentMember = data?.members.find((m) => m.userId === currentUserId);
  const canManage = currentMember?.role === "owner" || currentMember?.role === "admin" || isSuperAdmin;
  const isOwner = currentMember?.role === "owner";

  // If the member somehow lands here without manage rights (deep link,
  // role changed while page was open), show a friendly denial instead
  // of a read-only wall of controls that all appear broken.
  if (!isLoading && data && currentMember && !canManage) {
    return (
      <PermissionDenied
        title="Members are managed by workspace admins"
        action="invite people or change roles"
        requires="admin"
      />
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
    <SettingsLayout>
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 leading-tight">Members</h1>
          <p className="text-sm text-muted-foreground mt-1">
            People with access to <span className="font-semibold text-slate-900">{data?.workspace?.name ?? "HitroTech Telecom"}</span>.
          </p>
        </div>
        <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap">
          {billing && !seatsUnlimited && (
            <div className="hidden sm:block text-right">
              <div className="text-sm font-semibold text-slate-900">
                {billing.seatsUsed} / {billing.seatLimit}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                Seats Used
              </div>
            </div>
          )}
        {canManage && !isSuperAdmin && (
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button
                  className="rounded-2xl px-6 gradient-brand shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all"
                  disabled={!seatsUnlimited && !!billing && billing.seatsUsed >= billing.seatLimit}
                  id="invite-member-button"
                >
                  <UserPlus2 className="w-4 h-4 mr-2" />
                  Invite member
                </Button>
              </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">Invite a member</DialogTitle>
                <DialogDescription>
                  Invite a teammate to your workspace by their email address.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-email" className="text-xs font-bold uppercase tracking-wider text-slate-500">Email address</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="name@hitrotech.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="rounded-2xl border-slate-200 focus:border-primary focus:ring-primary/20"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-role" className="text-xs font-bold uppercase tracking-wider text-slate-500">Workspace Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                    <SelectTrigger id="invite-role" className="rounded-2xl border-slate-200 focus:border-primary focus:ring-primary/20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl">
                      <SelectItem value="admin">Admin — All settings except billing</SelectItem>
                      <SelectItem value="manager">Manager — Day-to-day operations</SelectItem>
                      <SelectItem value="employee">Employee — Imports and orders</SelectItem>
                      <SelectItem value="operator">Operator — Data entry only</SelectItem>
                      <SelectItem value="accountant">Accountant — Read-only finance</SelectItem>
                      <SelectItem value="partner">Partner — Limited portal access</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" onClick={() => setInviteOpen(false)} className="rounded-2xl px-6">Cancel</Button>
                <Button 
                  onClick={() => inviteM.mutate()} 
                  disabled={inviteM.isPending || !inviteEmail.trim()}
                  className="rounded-2xl px-8 gradient-brand"
                >
                  {inviteM.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Send invite
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          )}
        </div>
      </div>

      {/* Pending invites */}
      {data?.invites && data.invites.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Pending invites</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.invites.map((inv) => {
              const expired = new Date(inv.expiresAt).getTime() < Date.now();
              return (
                <Card key={inv.id} className="p-3 flex items-center gap-3 rounded-2xl">
                  <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium truncate">{inv.email}</span>
                      {expired && (
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider px-1.5 py-0 h-4 bg-destructive/10 text-destructive border-destructive/20 rounded-2xl">
                          Expired
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {inv.role} · sent {formatDistanceToNow(new Date(inv.createdAt), { addSuffix: true })}
                      {" · "}
                      {expired
                        ? `expired ${formatDistanceToNow(new Date(inv.expiresAt), { addSuffix: true })}`
                        : `expires ${formatDistanceToNow(new Date(inv.expiresAt), { addSuffix: true })}`}
                    </div>
                  </div>
                  {canManage && !isSuperAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resendM.mutate(inv.id)}
                        disabled={resendM.isPending}
                        title="Resend invitation email and extend expiry"
                      >
                        {resendM.isPending && resendM.variables === inv.id ? "Sending…" : "Resend"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => revokeM.mutate(inv.id)}
                        disabled={revokeM.isPending}
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        Revoke
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Members */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-4 rounded-2xl">
              <Skeleton className="h-12 w-12 rounded-2xl mb-3" />
              <Skeleton className="h-4 w-2/3 mb-2" />
              <Skeleton className="h-9 w-full" />
            </Card>
          ))}
        </div>
      ) : (data?.members ?? []).length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-2xl">
          No members yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data!.members.map((m) => {
            const isSelf = m.userId === currentUserId;
            const isMemberOwner = !!m.isOwner;
            const initials = ((m.fullName || m.email || "?").split("@")[0].split(/[._\s-]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("")) || "?";
            const roleTone =
              m.role === "owner" ? "bg-primary/10 text-primary border-primary/20"
              : m.role === "admin" ? "bg-primary/5 text-primary border-primary/20"
              : m.role === "manager" ? "bg-secondary text-secondary-foreground border-border"
              : m.role === "accountant" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
              : m.role === "operator" ? "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20"
              : m.role === "partner" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
              : "bg-muted text-muted-foreground border-border";
            return (
              <Card key={m.id} className="p-4 flex flex-col gap-4 rounded-2xl">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-12 w-12 shrink-0 rounded-2xl gradient-brand text-primary-foreground grid place-items-center text-sm font-semibold shadow-sm">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <div className="font-medium text-sm truncate">
                        {m.fullName || m.email?.split("@")[0] || m.userId}
                      </div>
                      <Badge variant="outline" className={`text-[10px] uppercase tracking-wider px-1.5 py-0 h-4 rounded-2xl ${roleTone}`}>
                        {isMemberOwner ? <><Crown className="w-3 h-3 mr-0.5 inline" />{m.role}</> : m.role}
                      </Badge>
                      {isSelf && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">You</span>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5" title={m.email ?? ""}>{m.email}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Joined {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex-1">
                        <Select
                          value={isMemberOwner ? "owner" : m.role}
                          onValueChange={(v) => setRoleM.mutate({ memberId: m.id, role: v as Role })}
                          disabled={setRoleM.isPending || !canManage || isSuperAdmin || (isMemberOwner && !isSuperAdmin) || isSelf}
                        >
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(isMemberOwner || isSuperAdmin) && <SelectItem value="owner" disabled={!isSuperAdmin}>Owner</SelectItem>}
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="employee">Employee</SelectItem>
                            <SelectItem value="operator">Operator</SelectItem>
                            <SelectItem value="accountant">Accountant</SelectItem>
                            <SelectItem value="partner">Partner</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </TooltipTrigger>
                    {((isMemberOwner && !isSuperAdmin) || isSelf || !canManage) && (
                      <TooltipContent>
                        {isMemberOwner && !isSuperAdmin
                          ? "The Owner role can only change via Transfer ownership."
                          : isSelf
                            ? "You can't change your own role. Ask another admin."
                            : "Only admins can change roles."}
                      </TooltipContent>
                    )}
                  </Tooltip>
                  {(isOwner || isSuperAdmin) && !isMemberOwner && !isSelf && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Transfer ownership"
                          onClick={() => setPendingTransfer({ userId: m.userId, name: m.fullName || m.email || "this member" })}>
                          <ShieldCheck className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Transfer ownership to this member</TooltipContent>
                    </Tooltip>
                  )}
                  {canManage && (!isMemberOwner || isSuperAdmin) && !isSelf && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon"
                          onClick={() => setRecoveryFor({ userId: m.userId, name: m.fullName || m.email || "this member" })}
                          className="text-muted-foreground hover:text-primary"
                          aria-label="Recover access">
                          <LifeBuoy className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Recover access (reset 2FA, change email, send reset)</TooltipContent>
                    </Tooltip>
                  )}
                   {canManage && (!isMemberOwner || isSuperAdmin) && !isSelf && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon"
                          onClick={() => setPendingRemove({ id: m.id, name: m.fullName || m.email || "this member" })}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          aria-label="Remove member">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove from this workspace</TooltipContent>
                    </Tooltip>
                  )}
                  {isSelf && (
                    <span className="text-[10px] text-muted-foreground pr-1">Signed in</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!pendingRemove} onOpenChange={(o) => !o && setPendingRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingRemove?.name} from this workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll lose access immediately. Their sign-in account is preserved and their historical data stays in this workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeM.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeM.isPending}
              onClick={() => pendingRemove && removeM.mutate(pendingRemove.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeM.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingTransfer} onOpenChange={(o) => !o && setPendingTransfer(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer ownership to {pendingTransfer?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll become an admin. The new owner will have full control over this workspace including billing and deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={transferM.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={transferM.isPending}
              onClick={() => pendingTransfer && transferM.mutate(pendingTransfer.userId)}
            >
              {transferM.isPending ? "Transferring…" : "Transfer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {recoveryFor && (
        <AdminRecoveryDialog
          open={!!recoveryFor}
          onOpenChange={(o) => !o && setRecoveryFor(null)}
          memberUserId={recoveryFor.userId}
          memberName={recoveryFor.name}
        />
      )}
    </div>
    </SettingsLayout>
    </TooltipProvider>
  );
}
