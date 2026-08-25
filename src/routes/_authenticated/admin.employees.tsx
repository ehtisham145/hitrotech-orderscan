import { createFileRoute, redirect, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Plus, Search, MapPin, Phone, CreditCard, UserCheck, AlertTriangle, TrendingUp, Banknote } from "lucide-react";
import { toast } from "sonner";
import { listEmployees, deleteEmployee, getEmployeeUsage } from "@/lib/employees.functions";
import { EmptyState } from "@/components/EmptyState";
import { requireWorkspaceRole } from "@/lib/route-guards";
import { useWorkspace } from "@/components/WorkspaceContext";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatPkr } from "@/lib/plans";


const ROLE_LABEL: Record<string, string> = {
  bdo: "Business Development Officer",
  asm: "Area Sales Manager",
  rsm: "Regional Sales Manager",
};

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  rsm: "default",
  asm: "secondary",
  bdo: "outline",
};

export const Route = createFileRoute("/_authenticated/admin/employees")({
  head: () => ({
    meta: [
      { title: "Employees — HitroTech OrderScan" },
      { name: "description", content: "Manage BDOs, ASMs, and RSMs." },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "manager", "accountant"] as const);
  },
  component: () => <EmployeesRoute />,
});

function EmployeesRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (pathname !== "/admin/employees") {
    return <Outlet />;
  }

  return <EmployeesList />;
}

function EmployeesList() {
  const { isSuperAdmin } = useWorkspace();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchList = useServerFn(listEmployees);
  const doDelete = useServerFn(deleteEmployee);
  const fetchUsage = useServerFn(getEmployeeUsage);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const { data: usage } = useQuery({
    queryKey: ["employee-usage"],
    queryFn: () => fetchUsage(),
  });


  const { data, isLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: () => fetchList(),
  });

  const del = useMutation({
    mutationFn: (id: string) => doDelete({ data: { id } }),
    onSuccess: () => {
      toast.success("Employee removed");
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = (data ?? [] as any[]).filter((e: any) => {
    if (roleFilter !== "all" && e.role !== roleFilter) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      e.name.toLowerCase().includes(s) ||
      (e.phone ?? "").toLowerCase().includes(s) ||
      (e.cnic ?? "").toLowerCase().includes(s) ||
      (e.employee_id ?? "").toLowerCase().includes(s) ||
      (e.city ?? "").toLowerCase().includes(s) ||
      (e.area ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Employees</h1>
          <p className="text-sm text-muted-foreground font-medium">
            Manage your internal team members, roles, and performance.
</p>
        </div>
        <div className="flex items-center gap-3">
          {usage && usage.limit !== null && !isSuperAdmin && (
            <div className="hidden md:flex flex-col items-end mr-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                Usage: {usage.used} / {usage.limit}
              </span>
              <Progress value={(usage.used / usage.limit) * 100} className="w-24 h-1" />
            </div>
          )}
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    onClick={() => navigate({ to: "/admin/employees/$id", params: { id: "new" } })}
                    disabled={!isSuperAdmin && usage?.limit !== null && usage?.used !== undefined && usage.used >= usage.limit}
                  >
                    <Plus className="w-4 h-4 mr-2" /> Add employee
                  </Button>
                </span>
              </TooltipTrigger>
              {!isSuperAdmin && usage?.limit !== null && usage?.used !== undefined && usage.used >= usage.limit && (
                <TooltipContent>
                  <p>Limit reached ({usage.limit} employees). Upgrade your plan to add more.</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {!isSuperAdmin && usage?.limit !== null && usage?.used !== undefined && usage.used >= usage.limit && (
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 flex items-center gap-3 text-orange-800 animate-in fade-in slide-in-from-top-2">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div className="text-sm">
            <p className="font-bold">Plan limit reached</p>
            <p className="opacity-80">You have used all {usage.limit} employee slots on your {usage.planTier} plan. <Link to="/admin/billing" className="font-bold underline">Upgrade now</Link> to manage a larger team.</p>
          </div>
        </div>
      )}


      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="relative min-w-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, phone, CNIC, ID, city…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex min-w-0 flex-wrap gap-2 lg:justify-end">
              {["all", "bdo", "asm", "rsm"].map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={roleFilter === r ? "default" : "outline"}
                  onClick={() => setRoleFilter(r)}
                >
                  {r === "all" ? "All" : ROLE_LABEL[r as keyof typeof ROLE_LABEL]}
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
                  title={q || roleFilter !== "all" ? "No employees match" : "No employees yet"}
                  description={q || roleFilter !== "all" ? "Try clearing filters." : "Add your first internal team member."}
                  action={
                    q || roleFilter !== "all"
                      ? undefined
                      : { 
                          label: "Add employee", 
                          onClick: () => navigate({ to: "/admin/employees/$id", params: { id: "new" } }),
                          disabled: !isSuperAdmin && usage?.limit !== null && usage?.used !== undefined && usage.used >= usage.limit
                        }
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((e: any) => (
                <div key={e.id} className="group relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md">
                  <div className="flex items-start justify-between mb-4">
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-bold leading-tight">{e.name}</h2>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant={ROLE_VARIANT[e.role as keyof typeof ROLE_VARIANT] ?? "outline"} className="text-[10px] font-bold uppercase tracking-wider">
                          {ROLE_LABEL[e.role as keyof typeof ROLE_LABEL] ?? e.role}
                        </Badge>
                        {e.employee_id && <span className="text-xs text-muted-foreground font-mono">#{e.employee_id}</span>}
                      </div>
                    </div>
                    <Badge variant={e.status === 'active' ? 'default' : 'secondary'} className="rounded-full px-2 py-0 h-5 text-[9px] font-black uppercase tracking-tighter bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                      {e.status}
                    </Badge>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="w-3.5 h-3.5" />
                      <span className="truncate">{e.phone || "—"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <CreditCard className="w-3.5 h-3.5" />
                      <span className="truncate">{e.cnic || "—"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5" />
                      <span className="truncate">{e.area ? `${e.area}, ` : ""}{e.city || "—"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Banknote className="w-3.5 h-3.5" />
                      <span className="text-xs font-bold">{formatPkr(e.salary || 0)}</span>
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-primary" />
                      <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                        Target: {e.target_activations || 0}
                      </span>
                    </div>

                    <div className="flex gap-2">
                       <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" asChild>
                         <Link to="/admin/employees/$id" params={{ id: e.id }}><Search className="h-4 w-4" /></Link>
                       </Button>
                       <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={async () => {
                          if (await confirmDialog({ title: `Remove ${e.name}?`, description: "This will remove the employee record.", confirmLabel: "Remove", destructive: true })) {
                            del.mutate(e.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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

function Trash2(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}
