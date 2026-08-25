import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Store, CheckCircle2, Copy, AlertTriangle, UserCheck2, Wallet, Users, Trash2, Plus, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { getStorePerformance } from "@/lib/performance.functions";
import { listStores, createStore, deleteStore } from "@/lib/stores.functions";
import { EmptyState } from "@/components/EmptyState";
import { requireWorkspaceRole } from "@/lib/route-guards";
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


export const Route = createFileRoute("/_authenticated/admin/stores")({
  head: () => ({
    meta: [
      { title: "Store Performance — HitroTech OrderScan" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: typeof s.returnTo === "string" ? s.returnTo : undefined,
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "manager", "accountant"] as const);
  },
  component: StorePerformancePage,
});

function StorePerformancePage() {
  const { returnTo } = Route.useSearch();
  const navigate = useNavigate();
  const fetchStores = useServerFn(getStorePerformance);
  const [month, setMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const monthDate = month + "-01";

  const { data, isLoading } = useQuery({
    queryKey: ["store-performance", monthDate],
    queryFn: () => fetchStores({ data: { month: monthDate } }),
  });

  const stores = data?.stores ?? [];
  const fmt = (n: number) => "PKR " + n.toLocaleString();

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {returnTo ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-primary">
            <Store className="w-4 h-4" />
            <span>Add a Store ID below, then return to continue.</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate({ to: returnTo })}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stores</h1>
          <p className="text-sm text-muted-foreground">Manage your Store IDs and see performance for {format(new Date(monthDate), "MMMM yyyy")}.</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm"
        />
      </div>

      <ManageStoresCard returnTo={returnTo} />




      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
        </div>
      ) : stores.length === 0 ? (
        <EmptyState icon={Store} title="No activity this month" description="Once activations start rolling in, store metrics show up here." />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {stores.map((s) => (
            <Card
              key={s.store_id}
              className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
              onClick={() => navigate({ to: "/orders", search: { store: s.store_id } })}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate({ to: "/orders", search: { store: s.store_id } }); } }}
              title={`View all orders for ${s.store_id}`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary grid place-items-center">
                      <Store className="w-4 h-4" />
                    </div>
                    <CardTitle className="text-base">{s.store_id}</CardTitle>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Commission</div>
                    <div className="text-lg font-semibold">{fmt(s.commission)}</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <StoreStat icon={CheckCircle2} label="Successful" value={s.success.toLocaleString()} accent="text-emerald-600" />
                <StoreStat icon={Copy} label="Duplicates" value={s.duplicates.toLocaleString()} accent="text-amber-600" />
                <StoreStat icon={AlertTriangle} label="Failed" value={s.failed.toLocaleString()} accent="text-destructive" />
                <StoreStat icon={AlertTriangle} label="Needs review" value={s.needs_review.toLocaleString()} accent="text-amber-600" />
                <div className="border-t pt-3 space-y-3">
                  <StoreStat icon={UserCheck2} label="Unassigned" value={s.unassigned.toLocaleString()} accent="text-amber-600" />
                  <StoreStat icon={Users} label="Partners" value={`${s.partners_active} / ${s.partners_total}`} accent="text-primary" sub="active / total" />
                  <StoreStat
                    icon={Wallet}
                    label="Avg / activation"
                    value={s.success ? fmt(Math.round(s.commission / s.success)) : "—"}
                    accent="text-primary"
                  />
                </div>
              </CardContent>
            </Card>
          ))}

        </div>
      )}
    </div>
  );
}

function StoreStat({ icon: Icon, label, value, accent, sub }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any; label: string; value: string; accent?: string; sub?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={`w-4 h-4 ${accent ?? ""}`} />
        <span>{label}</span>
      </div>
      <div className="text-right">
        <div className="font-medium">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

function ManageStoresCard({ returnTo }: { returnTo?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fetchStores = useServerFn(listStores);
  const doCreate = useServerFn(createStore);
  const doDelete = useServerFn(deleteStore);
  const { data: rows, isLoading } = useQuery({ queryKey: ["stores"], queryFn: () => fetchStores() });
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; code: string } | null>(null);


  const createM = useMutation({
    mutationFn: async () => {
      const trimmedCode = code.trim();
      if (!trimmedCode) throw new Error("Store code is required");
      return doCreate({ data: { code: trimmedCode, label: label.trim() || null } });
    },
    onSuccess: () => {
      setCode(""); setLabel("");
      qc.invalidateQueries({ queryKey: ["stores"] });
      toast.success("Store added");
      if (returnTo) navigate({ to: returnTo });
    },
    onError: (e: Error) => {
      // eslint-disable-next-line no-console
      console.error("createStore failed", e);
      toast.error(e.message || "Failed to add store");
    },
  });
  const deleteM = useMutation({
    mutationFn: async (id: string) => doDelete({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stores"] });
      toast.success("Store removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Manage Store IDs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); createM.mutate(); }}
        >
          <div className="grow min-w-40">
            <Label htmlFor="store-code">Store code</Label>
            <Input
              id="store-code"
              placeholder="e.g. FD4001"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={32}
              autoFocus
            />
          </div>
          <div className="grow min-w-48">
            <Label htmlFor="store-label">Label (optional)</Label>
            <Input id="store-label" placeholder="e.g. Main Branch" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button type="submit" disabled={createM.isPending}>
            <Plus className="w-4 h-4 mr-1" /> {createM.isPending ? "Adding…" : "Add store"}
          </Button>
        </form>
        {createM.isError ? (
          <p className="text-sm text-destructive">{(createM.error as Error)?.message ?? "Failed to add store"}</p>
        ) : null}

        {isLoading ? (
          <Skeleton className="h-16" />
        ) : (rows ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No stores yet. Add your first Store ID above.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(rows ?? []).map((s) => (
              <div key={s.id} className="flex items-center gap-1 rounded-md border bg-background pl-3 pr-1.5 py-1 text-sm hover:border-primary/50 transition-colors">
                <button
                  type="button"
                  className="flex items-center gap-2 py-0.5"
                  onClick={() => navigate({ to: "/orders", search: { store: s.code } })}
                  title={`View all orders for ${s.code}`}
                >
                  <Store className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-medium">{s.code}</span>
                  {s.label && <span className="text-muted-foreground">— {s.label}</span>}
                </button>
                <button
                  type="button"
                  className="ml-1 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setPendingDelete({ id: s.id, code: s.code })}
                  aria-label={`Remove ${s.code}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

        )}
      </CardContent>
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove store?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove store <span className="font-medium text-foreground">{pendingDelete?.code}</span> from your managed list. Existing order data is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) deleteM.mutate(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );

}
