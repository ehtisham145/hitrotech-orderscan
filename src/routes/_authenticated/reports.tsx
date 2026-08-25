import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Download, FileSpreadsheet, FileText, Filter, Save, Trash2, Printer, BookmarkCheck } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { PlanGate } from "@/components/PlanGate";


const REPORT_ROW_CAP = 5000;

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — HitroTech OrderScan" },
      { name: "description", content: "Analytics and breakdowns of extracted telecom orders by network, status, city, and time period. Export to Excel." },
      { property: "og:title", content: "Reports — HitroTech OrderScan" },
      { property: "og:description", content: "Analytics and breakdowns of extracted telecom orders by network, status, city, and time period." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportsPage,
});

type Filters = {
  from: string;
  to: string;
  batchIds: string[];
  status: string;
  network: string;
  branch: string;
  needsReview: boolean;
  duplicatesOnly: boolean;
};

const defaultFilters: Filters = {
  from: "",
  to: "",
  batchIds: [],
  status: "all",
  network: "all",
  branch: "all",
  needsReview: false,
  duplicatesOnly: false,
};

function ReportsPage() {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [applied, setApplied] = useState<Filters>(defaultFilters);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "view" | "schedule"; id: string; label?: string } | null>(null);

  const { data: batches } = useQuery({
    queryKey: ["reports-batches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("batches").select("id, name, created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: facets } = useQuery({
    queryKey: ["reports-facets"],
    queryFn: async () => {
      const { data } = await supabase
        .from("extractions")
        .select("current_network, branch_name, order_status")
        .limit(5000);
      const networks = Array.from(new Set((data ?? []).map((r) => r.current_network).filter(Boolean))) as string[];
      const branches = Array.from(new Set((data ?? []).map((r) => r.branch_name).filter(Boolean))) as string[];
      const statuses = Array.from(new Set((data ?? []).map((r) => r.order_status).filter(Boolean))) as string[];
      return { networks: networks.sort(), branches: branches.sort(), statuses: statuses.sort() };
    },
  });

  const { data: rows, isFetching } = useQuery({
    queryKey: ["reports-rows", applied],
    queryFn: async () => {
      let q = supabase.from("extractions").select("*").order("created_at", { ascending: false }).limit(REPORT_ROW_CAP);
      if (applied.from) q = q.gte("created_at", new Date(applied.from).toISOString());
      if (applied.to) {
        const to = new Date(applied.to);
        to.setDate(to.getDate() + 1);
        q = q.lt("created_at", to.toISOString());
      }
      if (applied.batchIds.length > 0) q = q.in("batch_id", applied.batchIds);
      if (applied.status !== "all") q = q.eq("order_status", applied.status);
      if (applied.network !== "all") q = q.eq("current_network", applied.network);
      if (applied.branch !== "all") q = q.eq("branch_name", applied.branch);
      if (applied.needsReview) q = q.eq("needs_review", true);
      if (applied.duplicatesOnly) q = q.eq("is_duplicate", true);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const summary = useMemo(() => {
    const all = rows ?? [];
    // KPIs & breakdowns count only successful, non-duplicate extractions.
    // Keep duplicates/needsReview as their own totals from the full result set.
    const list = all.filter((r) => r.status === "success" && !r.is_duplicate);
    const byNetwork = new Map<string, number>();
    const byBranch = new Map<string, number>();
    const byStatus = new Map<string, number>();
    let duplicates = 0;
    let needsReview = 0;
    for (const r of all) {
      if (r.is_duplicate) duplicates++;
      if (r.needs_review) needsReview++;
    }
    for (const r of list) {
      if (r.current_network) byNetwork.set(r.current_network, (byNetwork.get(r.current_network) ?? 0) + 1);
      if (r.branch_name) byBranch.set(r.branch_name, (byBranch.get(r.branch_name) ?? 0) + 1);
      if (r.order_status) byStatus.set(r.order_status, (byStatus.get(r.order_status) ?? 0) + 1);
    }
    return {
      total: list.length,
      duplicates,
      needsReview,
      byNetwork: [...byNetwork.entries()].sort((a, b) => b[1] - a[1]),
      byBranch: [...byBranch.entries()].sort((a, b) => b[1] - a[1]),
      byStatus: [...byStatus.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [rows]);

  function toggleBatch(id: string) {
    setFilters((f) => ({
      ...f,
      batchIds: f.batchIds.includes(id) ? f.batchIds.filter((x) => x !== id) : [...f.batchIds, id],
    }));
  }

  function apply() {
    setApplied(filters);
  }
  function reset() {
    setFilters(defaultFilters);
    setApplied(defaultFilters);
  }

  const qc = useQueryClient();
  const { data: views } = useQuery({
    queryKey: ["report-views"],
    queryFn: async () => {
      const { data, error } = await supabase.from("report_views").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ id: string; name: string; filters: Filters; created_at: string }>;
    },
  });

  function openSaveView() {
    setViewName("");
    setSaveOpen(true);
  }

  async function confirmSaveView() {
    const name = viewName.trim();
    if (!name) { toast.error("Please enter a name"); return; }
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { data: profile } = await supabase.from("profiles").select("active_workspace_id").eq("id", userData.user.id).maybeSingle();
    if (!profile?.active_workspace_id) { toast.error("No active workspace"); return; }
    const { error } = await supabase.from("report_views").insert({
      user_id: userData.user.id,
      workspace_id: profile.active_workspace_id,
      name,
      filters: filters as never,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("View saved");
    setSaveOpen(false);
    qc.invalidateQueries({ queryKey: ["report-views"] });
  }

  async function performDeleteView(id: string) {
    const { error } = await supabase.from("report_views").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("View deleted");
    qc.invalidateQueries({ queryKey: ["report-views"] });
  }

  function loadView(v: { filters: Filters }) {
    const merged = { ...defaultFilters, ...v.filters };
    setFilters(merged);
    setApplied(merged);
  }

  function printReport() {
    window.print();
  }


  function exportExcel() {
    const list = rows ?? [];
    const batchNameById = new Map((batches ?? []).map((b) => [b.id, b.name]));
    const exportRows = list.map((r, i) => ({
      "#": i + 1,
      "Batch": batchNameById.get(r.batch_id) ?? "",
      "Customer Name": r.customer_name,
      "Phone Number": r.phone_number,
      "Current Network": r.current_network,
      "Order Number": r.order_number,
      "CNIC": r.cnic,
      "Email": r.email,
      "Plan Price": r.plan_price,
      "Number Charges": r.number_charges,
      "Paid Via": r.paid_via,
      "Discount": r.discount,
      "Deposit": r.deposit,
      "Remaining Deposit": r.remaining_deposit,
      "Store ID": r.store_id,
      "Reference": r.reference,
      "Activation Date": r.activation_date,
      "Activation Time": r.activation_time,
      "Employee Name": r.employee_name,
      "Branch Name": r.branch_name,
      "Status": r.order_status,
      "Remarks": r.remarks,
      "Duplicate": r.is_duplicate ? "YES" : "",
      "Needs Review": r.needs_review ? "YES" : "",
      "Created": r.created_at,
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    if (exportRows.length > 0) {
      const cols = Object.keys(exportRows[0]).map((k) => ({
        wch: Math.min(40, Math.max(k.length + 2, ...exportRows.map((r) => String((r as Record<string, unknown>)[k] ?? "").length))),
      }));
      ws["!cols"] = cols;
    }

    const summaryRows = [
      { Metric: "Total rows", Value: summary.total },
      { Metric: "Duplicates", Value: summary.duplicates },
      { Metric: "Needs review", Value: summary.needsReview },
      {},
      { Metric: "By Network", Value: "" },
      ...summary.byNetwork.map(([k, v]) => ({ Metric: k, Value: v })),
      {},
      { Metric: "By Branch", Value: "" },
      ...summary.byBranch.map(([k, v]) => ({ Metric: k, Value: v })),
      {},
      { Metric: "By Status", Value: "" },
      ...summary.byStatus.map(([k, v]) => ({ Metric: k, Value: v })),
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows, { skipHeader: false });
    wsSummary["!cols"] = [{ wch: 30 }, { wch: 20 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    const stamp = format(new Date(), "yyyyMMdd-HHmm");
    XLSX.writeFile(wb, `report-${stamp}.xlsx`);
  }

  function exportCsv() {
    const list = rows ?? [];
    if (list.length === 0) return;
    const batchNameById = new Map((batches ?? []).map((b) => [b.id, b.name]));
    const exportRows = list.map((r, i) => ({
      "#": i + 1,
      Batch: batchNameById.get(r.batch_id) ?? "",
      "Customer Name": r.customer_name ?? "",
      "Phone Number": r.phone_number ?? "",
      "Current Network": r.current_network ?? "",
      "Order Number": r.order_number ?? "",
      CNIC: r.cnic ?? "",
      Email: r.email ?? "",
      "Plan Price": r.plan_price ?? "",
      "Store ID": r.store_id ?? "",
      "Activation Date": r.activation_date ?? "",
      "Employee Name": r.employee_name ?? "",
      "Branch Name": r.branch_name ?? "",
      Status: r.order_status ?? "",
      Remarks: r.remarks ?? "",
      Duplicate: r.is_duplicate ? "YES" : "",
      "Needs Review": r.needs_review ? "YES" : "",
      Created: r.created_at,
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${format(new Date(), "yyyyMMdd-HHmm")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }


  return (
    <PlanGate feature="reports">
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
        
            <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
            <p className="text-sm text-muted-foreground">Build a custom report with filters and export to Excel.</p>
          </div>
          <div className="flex gap-2 print:hidden">
            <Button variant="outline" onClick={printReport} disabled={(rows?.length ?? 0) === 0}>
              <Printer className="w-4 h-4 mr-2" /> Print / PDF
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={(rows?.length ?? 0) === 0}>
              <FileText className="w-4 h-4 mr-2" /> Export CSV
            </Button>
            <Button onClick={exportExcel} disabled={(rows?.length ?? 0) === 0}>
              <Download className="w-4 h-4 mr-2" /> Export Excel
            </Button>
          </div>
        </div>

      {(rows?.length ?? 0) >= REPORT_ROW_CAP && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm print:hidden">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium text-amber-900 dark:text-amber-200">Showing the first {REPORT_ROW_CAP.toLocaleString()} rows.</div>
            <div className="text-xs text-amber-800/80 dark:text-amber-200/80">Summary totals and breakdowns reflect only these rows. Narrow the date range or filters to see accurate totals.</div>
          </div>
        </div>
      )}

      <Card className="print:hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><BookmarkCheck className="w-4 h-4" /> Saved views</CardTitle>
        </CardHeader>
        <CardContent>
          {(views?.length ?? 0) === 0 ? (
            <div className="text-xs text-muted-foreground">No saved views yet. Configure filters and click "Save current view".</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {views!.map((v) => (
                <div key={v.id} className="inline-flex items-center gap-1 rounded-2xl border bg-muted/40 pl-2 pr-1 py-1 text-xs">
                  <button className="hover:text-primary font-medium" onClick={() => loadView(v)}>{v.name}</button>
                  <button className="p-1 hover:text-destructive" onClick={() => setConfirmDelete({ kind: "view", id: v.id, label: v.name })} title="Delete" aria-label={`Delete view ${v.name}`}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={openSaveView}>
              <Save className="w-3.5 h-3.5 mr-2" /> Save current view
            </Button>
          </div>
        </CardContent>
      </Card>

      <PlanGate feature="scheduled_reports">
        <ScheduledReportsSection views={views ?? []} />
      </PlanGate>



      <Card className="print:hidden rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Filter className="w-4 h-4" /> Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
                <SelectTrigger><SelectValue placeholder={facets?.statuses.length ? "All statuses" : "No data"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {(facets?.statuses ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Network</Label>
              <Select value={filters.network} onValueChange={(v) => setFilters({ ...filters, network: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All networks</SelectItem>
                  {(facets?.networks ?? []).map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Branch</Label>
              <Select value={filters.branch} onValueChange={(v) => setFilters({ ...filters, branch: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All branches</SelectItem>
                  {(facets?.branches ?? []).map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Checkbox id="nr" checked={filters.needsReview} onCheckedChange={(v) => setFilters({ ...filters, needsReview: !!v })} />
              <Label htmlFor="nr" className="text-sm cursor-pointer">Needs review only</Label>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Checkbox id="dup" checked={filters.duplicatesOnly} onCheckedChange={(v) => setFilters({ ...filters, duplicatesOnly: !!v })} />
              <Label htmlFor="dup" className="text-sm cursor-pointer">Duplicates only</Label>
            </div>
          </div>

          <div>
            <Label className="text-xs">Batches ({filters.batchIds.length || "all"})</Label>
            <div className="mt-2 max-h-40 overflow-auto border rounded-2xl p-2 space-y-1">
              {(batches ?? []).map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted cursor-pointer">
                  <Checkbox checked={filters.batchIds.includes(b.id)} onCheckedChange={() => toggleBatch(b.id)} />
                  <span className="flex-1 truncate">{b.name}</span>
                  <span className="text-xs text-muted-foreground">{format(new Date(b.created_at), "MMM d, yyyy")}</span>
                </label>
              ))}
              {(batches?.length ?? 0) === 0 && <div className="text-xs text-muted-foreground p-2">No batches yet.</div>}
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={apply}>Apply filters</Button>
            <Button variant="outline" onClick={reset}>Reset</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total rows" value={summary.total} />
        <StatCard label="Duplicates" value={summary.duplicates} />
        <StatCard label="Needs review" value={summary.needsReview} />
        <StatCard label="Batches" value={applied.batchIds.length || (batches?.length ?? 0)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BreakdownCard title="By Network" rows={summary.byNetwork} />
        <BreakdownCard title="By Branch" rows={summary.byBranch} />
        <BreakdownCard title="By Status" rows={summary.byStatus} />
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="w-4 h-4" /> Preview {isFetching && <span className="text-xs text-muted-foreground">Loading…</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[500px] print:max-h-none print:overflow-visible">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left p-2 font-medium">Customer</th>
                  <th className="text-left p-2 font-medium">Phone</th>
                  <th className="text-left p-2 font-medium">Order #</th>
                  <th className="text-left p-2 font-medium">Network</th>
                  <th className="text-left p-2 font-medium">Branch</th>
                  <th className="text-left p-2 font-medium">Status</th>
                  <th className="text-left p-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).slice(0, 200).map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{r.customer_name}</td>
                    <td className="p-2">{r.phone_number}</td>
                    <td className="p-2">{r.order_number}</td>
                    <td className="p-2">{r.current_network}</td>
                    <td className="p-2">{r.branch_name}</td>
                    <td className="p-2">{r.order_status}</td>
                    <td className="p-2 text-muted-foreground">{format(new Date(r.created_at), "MMM d, HH:mm")}</td>
                  </tr>
                ))}
                {(rows?.length ?? 0) === 0 && !isFetching && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No rows match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {(rows?.length ?? 0) > 200 && (
            <div className="p-2 text-xs text-muted-foreground border-t text-center">
              Showing first 200 of {rows!.length}. Export to see all rows.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
            <DialogDescription>Give this filter set a name so you can re-apply it later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="view-name">Name</Label>
            <Input
              id="view-name"
              autoFocus
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmSaveView(); }}
              placeholder="e.g. Last 30 days — Jazz"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button onClick={confirmSaveView} disabled={!viewName.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete?.kind === "view"} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete saved view?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.label ? `"${confirmDelete.label}" will be removed.` : "This view will be removed."} This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmDelete?.kind === "view") await performDeleteView(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </PlanGate>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="rounded-2xl"><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
    </CardContent></Card>
  );
}

const NETWORK_BRAND_COLORS: Record<string, string> = {
  jazz: "#D9232E",
  onic: "#A020F0",
  ufone: "#F58220",
  zong: "#00A651",
  telenor: "#00ADEF",
  scom: "#1F3A93",
  warid: "#E7008A",
  mobilink: "#F5A623",
};
function BreakdownCard({ title, rows }: { title: string; rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map(([, v]) => v));
  const isNetwork = title.toLowerCase().includes("network");
  const colorFor = (k: string) =>
    isNetwork ? NETWORK_BRAND_COLORS[k.trim().toLowerCase()] : undefined;
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1.5">
        {rows.length === 0 && <div className="text-xs text-muted-foreground">No data.</div>}
        {rows.slice(0, 8).map(([k, v]) => {
          const c = colorFor(k);
          return (
            <div key={k} className="text-xs">
              <div className="flex justify-between mb-0.5">
                <span className="truncate inline-flex items-center gap-1.5">
                  {c && <span className="inline-block h-2 w-2 rounded-2xl" style={{ background: c }} />}
                  {k}
                </span>
                <span className="text-muted-foreground">{v}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-2xl">
                <div
                  className={`h-full rounded-2xl ${c ? "" : "bg-primary"}`}
                  style={{ width: `${(v / max) * 100}%`, background: c }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ScheduledReportsSection({ views }: { views: Array<{ id: string; name: string }> }) {
  const qc = useQueryClient();
  const [viewId, setViewId] = useState<string>("");
  const [cadence, setCadence] = useState<"hourly" | "daily" | "weekly">("daily");
  const [name, setName] = useState("");
  const [recipients, setRecipients] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: schedules } = useQuery({
    queryKey: ["scheduled-reports"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("scheduled_reports")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Array<{
        id: string; name: string; view_id: string; cadence: string;
        enabled: boolean; next_run_at: string; last_run_at: string | null;
        recipients: string[];
      }>;
    },
  });

  const { data: generated } = useQuery({
    queryKey: ["generated-reports"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("generated_reports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Array<{ id: string; name: string; storage_path: string; row_count: number; created_at: string }>;
    },
  });

  async function createSchedule() {
    if (!viewId) { toast.error("Pick a saved view"); return; }
    if (!name.trim()) { toast.error("Name required"); return; }
    const emails = recipients
      .split(/[,\s;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const invalid = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (invalid.length > 0) { toast.error(`Invalid email: ${invalid[0]}`); return; }
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { error } = await (supabase.from as any)("scheduled_reports").insert({
      user_id: userData.user.id,
      view_id: viewId,
      name: name.trim(),
      cadence,
      recipients: emails,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Schedule created");
    setName("");
    setRecipients("");
    qc.invalidateQueries({ queryKey: ["scheduled-reports"] });
  }

  async function toggleSchedule(id: string, enabled: boolean) {
    const { error } = await (supabase.from as any)("scheduled_reports").update({ enabled: !enabled }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["scheduled-reports"] });
  }

  async function performDeleteSchedule(id: string) {
    const { error } = await (supabase.from as any)("scheduled_reports").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["scheduled-reports"] });
  }

  async function downloadGenerated(path: string) {
    const { data, error } = await supabase.storage.from("reports").createSignedUrl(path, 60);
    if (error || !data) { toast.error(error?.message || "Download failed"); return; }
    window.open(data.signedUrl, "_blank");
  }

  return (
    <PlanGate feature="scheduled_reports">
    <Card className="print:hidden rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSpreadsheet className="w-4 h-4" /> Scheduled exports
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly branch report" />
          </div>
          <div>
            <Label className="text-xs">Saved view</Label>
            <Select value={viewId} onValueChange={setViewId}>
              <SelectTrigger><SelectValue placeholder="Choose view" /></SelectTrigger>
              <SelectContent>
                {views.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Cadence</Label>
            <Select value={cadence} onValueChange={(v) => setCadence(v as "hourly" | "daily" | "weekly")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={createSchedule} disabled={views.length === 0}>
              <Save className="w-4 h-4 mr-2" /> Schedule
            </Button>
          </div>
        </div>
        <div>
          <Label className="text-xs">Email recipients (optional, comma-separated)</Label>
          <Input
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="ops@company.com, manager@company.com"
          />
          <div className="text-[11px] text-muted-foreground mt-1">
            Leave blank to only generate the file — no email will be sent.
          </div>
        </div>
        {views.length === 0 && (
          <div className="text-xs text-muted-foreground">Save a view first to schedule it.</div>
        )}

        {(schedules?.length ?? 0) > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Active schedules</div>
            <div className="space-y-2">
              {schedules!.map((s) => (
                <div key={s.id} className="flex items-center gap-3 border rounded-2xl p-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.cadence} · next {format(new Date(s.next_run_at), "MMM d, HH:mm")}
                      {s.last_run_at && ` · last ${format(new Date(s.last_run_at), "MMM d, HH:mm")}`}
                      {s.recipients && s.recipients.length > 0 && ` · → ${s.recipients.join(", ")}`}
                    </div>
                  </div>
                  <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-2xl ${s.enabled ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                    {s.enabled ? "Active" : "Paused"}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => toggleSchedule(s.id, s.enabled)}>
                    {s.enabled ? "Pause" : "Resume"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleteId(s.id)} aria-label="Delete schedule">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {(generated?.length ?? 0) > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Recently generated</div>
            <div className="space-y-1">
              {generated!.map((g) => (
                <div key={g.id} className="flex items-center gap-3 border rounded-2xl p-2 text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{g.name}</div>
                    <div className="text-muted-foreground">
                      {g.row_count.toLocaleString()} rows · {format(new Date(g.created_at), "MMM d, yyyy HH:mm")}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => downloadGenerated(g.storage_path)}>
                    <Download className="w-3.5 h-3.5 mr-1" /> Download
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this schedule?</AlertDialogTitle>
          <AlertDialogDescription>The schedule will stop running. Previously generated reports are kept.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              if (deleteId) await performDeleteSchedule(deleteId);
              setDeleteId(null);
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </PlanGate>
  );
}
