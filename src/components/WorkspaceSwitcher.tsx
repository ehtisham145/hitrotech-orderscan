import { useMemo, useState } from "react";
import { useWorkspace } from "@/components/WorkspaceContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Building2, Check, ChevronsUpDown, LogOut, Plus, Search, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

export function WorkspaceSwitcher() {
  const {
    workspace,
    workspaces,
    isSuperAdmin,
    switchWorkspace,
    createNewWorkspace,
    leaveWorkspaceById,
    loading,
  } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [leaveTarget, setLeaveTarget] = useState<{ id: string; name: string } | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);

  const isFreePlan = (workspace?.plan_tier ?? "free") === "free";
  const ownedCount = workspaces.filter((w) => w.role === "owner").length;
  const atWorkspaceLimit = !isSuperAdmin && isFreePlan && ownedCount >= 1;


  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter((w) => w.name.toLowerCase().includes(q));
  }, [workspaces, query]);

  if (loading) {
    return (
      <div className="mx-3 my-2 h-11 rounded-2xl border border-border/60 bg-muted/40 animate-pulse" />
    );
  }

  async function onCreate() {
    if (!newName.trim()) return;
    if (atWorkspaceLimit) {
      setCreating(false);
      setOpen(false);
      setLimitOpen(true);
      return;
    }
    setBusy(true);
    try {
      const id = await createNewWorkspace(newName.trim());
      await switchWorkspace(id);
      toast.success("Workspace created");
      setCreating(false);
      setNewName("");
      setOpen(false);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (/row-level security|permission denied|policy/i.test(msg)) {
        setCreating(false);
        setOpen(false);
        setLimitOpen(true);
      } else {
        toast.error(msg || "Failed to create workspace");
      }
    } finally {
      setBusy(false);
    }
  }


  async function onSwitch(id: string) {
    if (id === workspace?.id) { setOpen(false); return; }
    setBusy(true);
    try {
      await switchWorkspace(id);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to switch workspace");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmLeave() {
    if (!leaveTarget) return;
    setBusy(true);
    try {
      await leaveWorkspaceById(leaveTarget.id);
      toast.success(`Left ${leaveTarget.name}`);
      setLeaveTarget(null);
      setOpen(false);
      // Reload to refresh workspace-scoped data (mirrors switch behaviour)
      window.location.reload();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to leave workspace");
    } finally {
      setBusy(false);
    }
  }

  const showSearch = workspaces.length > 5;

  return (
    <div className="px-3 pb-2">
      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setQuery(""); setCreating(false); } }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-2xl border border-border/60 bg-background/50 px-3 py-2 text-left hover:bg-accent/60 transition-colors"
          >
            <div className="h-8 w-8 rounded-2xl gradient-brand text-primary-foreground grid place-items-center shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Workspace</div>
              <div className="text-sm font-medium truncate">{workspace?.name ?? "None"}</div>
            </div>
            <ChevronsUpDown className="w-4 h-4 text-muted-foreground shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2">
          {isSuperAdmin && (
            <Link
              to="/superadmin"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-2xl px-2 py-2 text-sm hover:bg-accent"
            >
              <Shield className="w-4 h-4 text-primary" />
              <span className="flex-1">All workspaces</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Super admin</span>
            </Link>
          )}

          {showSearch && (
            <div className="relative px-1 pt-1 pb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search workspaces..."
                className="h-8 pl-7 text-sm"
              />
            </div>
          )}

          <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pt-2 pb-1">
            Your workspaces
          </div>
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-2 py-4 text-xs text-muted-foreground text-center">No workspaces match.</div>
            ) : (
              filtered.map((w) => {
                const isActive = w.id === workspace?.id;
                const canLeave = w.role !== "owner";
                return (
                  <div
                    key={w.id}
                    className={cn(
                      "group flex items-center gap-1 rounded-2xl pr-1 hover:bg-accent",
                      isActive && "bg-accent",
                    )}
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onSwitch(w.id)}
                      className="flex-1 flex items-center gap-2 px-2 py-2 text-sm text-left min-w-0"
                    >
                      <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{w.name}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{w.role}</div>
                      </div>
                      {isActive && <Check className="w-4 h-4 text-primary shrink-0" />}
                    </button>
                    {canLeave && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => { e.stopPropagation(); setLeaveTarget({ id: w.id, name: w.name }); }}
                        title="Leave workspace"
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity h-7 w-7 grid place-items-center rounded-2xl hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-border/60 mt-2 pt-2">
            {creating ? (
              <div className="space-y-2 px-1">
                <Input
                  autoFocus
                  placeholder="Workspace name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onCreate()}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={onCreate} disabled={busy || !newName.trim()} className="flex-1">Create</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setNewName(""); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => (atWorkspaceLimit ? (setOpen(false), setLimitOpen(true)) : setCreating(true))}
                className="w-full flex items-center gap-2 rounded-2xl px-2 py-2 text-sm hover:bg-accent text-left"
              >
                <Plus className="w-4 h-4" />
                <span className="flex-1">Create new workspace</span>
                {atWorkspaceLimit && (
                  <span className="text-[10px] uppercase tracking-wider rounded-2xl border border-border/60 px-2 py-0.5 text-muted-foreground">
                    Pro
                  </span>
                )}
              </button>
            )}
          </div>

        </PopoverContent>
      </Popover>

      <AlertDialog open={!!leaveTarget} onOpenChange={(v) => { if (!v) setLeaveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {leaveTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll lose access to this workspace's data. An admin will need to re-invite you to return.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); onConfirmLeave(); }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Leaving..." : "Leave workspace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={limitOpen} onOpenChange={setLimitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="h-10 w-10 rounded-2xl gradient-brand text-primary-foreground grid place-items-center mb-2">
              <Building2 className="w-5 h-5" />
            </div>
            <AlertDialogTitle>Workspace limit reached</AlertDialogTitle>
            <AlertDialogDescription>
              Your Free plan includes 1 workspace. Upgrade to a paid plan to run multiple
              workspaces with separate teams, partners and reporting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Maybe later</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Link to="/onboarding/plan" onClick={() => setLimitOpen(false)}>View plans</Link>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

