import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Loader2, Filter, X, Download, FileText, Trash2, Save, BookmarkPlus, CheckCheck, Keyboard, EyeOff, FileImage, SlidersHorizontal } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { FIELD_LABELS } from "@/lib/format";
import { toast } from "sonner";
import { InlineEditCell } from "@/components/InlineEditCell";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "All Orders — HitroTech OrderScan" },
      { name: "description", content: "View all extracted telecom orders across every batch in one place." },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { store?: string } => ({
    store: typeof s.store === "string" ? s.store : undefined,
  }),
  component: AllOrdersPage,
});


const PAGE_SIZE = 100;

const COLUMNS = [
  "customer_name",
  "phone_number",
  "alternative_contact",
  "email",
  "cnic",
  "order_number",
  "current_network",
  "sim_type",
  "number_type",
  "package_name",
  "plan_price",
  "activation_date",
  "activation_time",
  "store_id",
  "branch_name",
  "employee_name",

] as const;

const BASE_SELECT =
  "id, batch_id, customer_name, phone_number, email, cnic, order_number, current_network, sim_type, number_type, package_name, plan_price, activation_date, activation_time, store_id, branch_name, employee_name, order_status, status, is_duplicate, needs_review, created_at";

export type OrderRow = {
  id: string;
  batch_id: string;
  status: string | null;
  is_duplicate: boolean | null;
  needs_review: boolean | null;
  created_at: string | null;
  alternative_contact?: string | null;
} & Partial<Record<(typeof COLUMNS)[number] | "order_status", string | null>>;

/** alternative_contact is added by a migration; older databases may not have it yet. */
let altContactSupported = true;
function isMissingAltContact(message: string | undefined) {
  return !!message && /alternative_contact/i.test(message);
}
function searchColumns() {
  const cols = ["customer_name", "phone_number", "cnic", "order_number", "email", "reference", "branch_name", "employee_name"];
  if (altContactSupported) cols.push("alternative_contact");
  return cols;
}



function AllOrdersPage() {
  const qc = useQueryClient();
  const { store: storeFilter } = Route.useSearch();
  const navigate = Route.useNavigate();

  const [search, setSearch] = useState("");
  const [batchId, setBatchId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [network, setNetwork] = useState<string>("all");
  const [branch, setBranch] = useState<string>("all");
  const [activationFrom, setActivationFrom] = useState<string>("");
  const [activationTo, setActivationTo] = useState<string>("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");

  type OrdersPreset = { id: string; name: string; filters: Record<string, unknown> };
  const { data: presets } = useQuery({
    queryKey: ["orders-presets"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as any)("report_views")
        .select("id, name, filters")
        .eq("scope", "orders")
        .order("created_at", { ascending: false });
      if (error) return [] as OrdersPreset[];
      return ((data ?? []) as OrdersPreset[]);
    },
  });

  const { data: batches } = useQuery({
    queryKey: ["orders-batches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches")
        .select("id, name, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const { data: storeOptions } = useQuery({
    queryKey: ["orders-store-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("stores").select("code").order("sort_order", { ascending: true }).order("code", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((s) => s.code as string);
    },
  });

  const { data: branchOptions } = useQuery({
    queryKey: ["orders-branch-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("extractions")
        .select("branch_name")
        .not("branch_name", "is", null)
        .neq("branch_name", "")
        .limit(2000);
      if (error) throw error;
      const s = new Set<string>();
      (data ?? []).forEach((r) => r.branch_name && s.add(r.branch_name as string));
      return Array.from(s).sort();
    },
  });

  const { data, isFetching } = useQuery({
    queryKey: ["all-orders", search, batchId, status, network, branch, activationFrom, activationTo, storeFilter, page],

    queryFn: async () => {
      const run = async () => {
        let q = supabase
          .from("extractions")
          .select(
            altContactSupported ? `${BASE_SELECT}, alternative_contact` : BASE_SELECT,
            { count: "exact" },
          )
          .order("activation_date_parsed", { ascending: false, nullsFirst: false })
          .order("activation_time", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .eq("is_duplicate", false)
          .in("status", ["success", "completed"])
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

        if (batchId !== "all") q = q.eq("batch_id", batchId);
        if (status === "review") q = q.eq("needs_review", true);
        else if (status === "success") q = q.eq("needs_review", false).in("status", ["success", "completed"]);
        else if (status !== "all") q = q.eq("status", status);
        if (network !== "all") q = q.eq("current_network", network);
        if (branch !== "all") q = q.eq("branch_name", branch);
        if (activationFrom) q = q.gte("activation_date_parsed", activationFrom);
        if (activationTo) q = q.lte("activation_date_parsed", activationTo);
        if (storeFilter) q = q.ilike("store_id", storeFilter);

        const term = search.trim();
        if (term.length >= 2) {
          const safe = term.replace(/[%,]/g, " ");
          q = q.or(searchColumns().map((c) => `${c}.ilike.%${safe}%`).join(","));
        }
        return await q;
      };

      let { data, count, error } = await run();
      if (error && altContactSupported && isMissingAltContact(error.message)) {
        altContactSupported = false;
        ({ data, count, error } = await run());
      }
      if (error) throw error;
      return { rows: (data ?? []) as unknown as OrderRow[], count: count ?? 0 };
    },

  });

  const rows = data?.rows ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const networks = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.current_network && s.add(r.current_network));
    return Array.from(s).sort();
  }, [rows]);

  const hasFilters = search || batchId !== "all" || status !== "all" || network !== "all" || branch !== "all" || activationFrom || activationTo || storeFilter;

  function resetFilters() {
    setSearch("");
    setBatchId("all");
    setStatus("all");
    setNetwork("all");
    setBranch("all");
    setActivationFrom("");
    setActivationTo("");
    setPage(0);
    if (storeFilter) navigate({ search: { store: undefined } });
  }




  function currentFilters() {
    return { search, batchId, status, network, activationFrom, activationTo };
  }
  function applyPreset(p: OrdersPreset) {
    const f = p.filters as Partial<ReturnType<typeof currentFilters>>;
    setSearch(typeof f.search === "string" ? f.search : "");
    setBatchId(typeof f.batchId === "string" ? f.batchId : "all");
    setStatus(typeof f.status === "string" ? f.status : "all");
    setNetwork(typeof f.network === "string" ? f.network : "all");
    setActivationFrom(typeof f.activationFrom === "string" ? f.activationFrom : "");
    setActivationTo(typeof f.activationTo === "string" ? f.activationTo : "");
    setPage(0);
    toast.success(`Loaded "${p.name}"`);
  }
  async function savePreset() {
    const trimmed = presetName.trim();
    if (!trimmed) { toast.error("Give the view a name"); return; }
    setSavingPreset(true);
    try {
      const { data: sess } = await supabase.auth.getUser();
      const uid = sess.user?.id;
      if (!uid) throw new Error("Not signed in");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from as any)("report_views").insert({
        user_id: uid,
        name: trimmed,
        scope: "orders",
        filters: currentFilters(),
      });
      if (error) throw error;
      setPresetName("");
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["orders-presets"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingPreset(false);
    }
  }
  async function deletePreset(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("report_views").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Preset deleted");
    qc.invalidateQueries({ queryKey: ["orders-presets"] });
  }

  const pageIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function performDelete() {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const ids = Array.from(selected);
      const { error } = await supabase.from("extractions").delete().in("id", ids);
      if (error) throw error;
      toast.success(`Permanently deleted ${ids.length} order${ids.length > 1 ? "s" : ""}`);
      setSelected(new Set());
      setConfirmDeleteOpen(false);
      qc.invalidateQueries({ queryKey: ["all-orders"] });
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  const [downloading, setDownloading] = useState(false);
  const [markingReview, setMarkingReview] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  async function bulkMarkReview(reviewed: boolean) {
    if (selected.size === 0) return;
    setMarkingReview(true);
    try {
      const ids = Array.from(selected);
      const { error } = await supabase.from("extractions").update({ needs_review: reviewed }).in("id", ids);
      if (error) throw error;
      toast.success(`${reviewed ? "Flagged" : "Cleared review on"} ${ids.length} order${ids.length > 1 ? "s" : ""}`);
      qc.invalidateQueries({ queryKey: ["all-orders"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setMarkingReview(false);
    }
  }

  async function updateRowField(id: string, field: string, value: string) {
    const patch = { [field]: value === "" ? null : value } as never;
    const { error } = await supabase.from("extractions").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["all-orders"] });
  }






  async function fetchAllExportRows(): Promise<Array<Record<string, unknown>>> {
    const all: Record<string, unknown>[] = [];
    const CHUNK = 1000;
    for (let offset = 0; ; offset += CHUNK) {
      let q = supabase
        .from("extractions")
        .select("*")
        .order("activation_date_parsed", { ascending: false, nullsFirst: false })
        .order("activation_time", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .eq("is_duplicate", false)
        .in("status", ["success", "completed"])
        .range(offset, offset + CHUNK - 1);

      if (batchId !== "all") q = q.eq("batch_id", batchId);
      if (status === "review") q = q.eq("needs_review", true);
      else if (status === "success") q = q.eq("needs_review", false).in("status", ["success", "completed"]);
      else if (status !== "all") q = q.eq("status", status);
      if (network !== "all") q = q.eq("current_network", network);
      if (branch !== "all") q = q.eq("branch_name", branch);
      if (storeFilter) q = q.ilike("store_id", storeFilter);
      if (activationFrom) q = q.gte("activation_date_parsed", activationFrom);
      if (activationTo) q = q.lte("activation_date_parsed", activationTo);

      const term = search.trim();
      if (term.length >= 2) {
        const safe = term.replace(/[%,]/g, " ");
        q = q.or(searchColumns().map((c) => `${c}.ilike.%${safe}%`).join(","));
      }

      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...(data as Record<string, unknown>[]));
      if (data.length < CHUNK) break;
    }
    return all;
  }

  function mapExportRows(all: Array<Record<string, unknown>>) {
    const batchMap = new Map((batches ?? []).map((b) => [b.id, b.name]));
    return all.map((r, i) => ({
      "#": i + 1,
      "Batch": batchMap.get(r.batch_id as string) ?? "",
      "Date": r.activation_date ?? (r.created_at ? new Date(r.created_at as string).toISOString().slice(0, 10) : ""),
      "Order No": r.order_number ?? "",
      "Sim Type": r.sim_type ?? "",
      "Number Type": r.number_type ?? "",
      "Current/Onic Number": r.phone_number ?? "",
      "Alternative Contact": r.alternative_contact ?? "",
      "Current Network": r.current_network ?? "",
      "Name": r.customer_name ?? "",
      "Cnic": r.cnic ?? "",
      "Package": r.package_name ?? r.plan_price ?? "",
      "Num Charges": r.number_charges ?? "",
      "Paid Via": r.paid_via ?? "",
      "Discount": r.discount ?? "",
      "Email": r.email ?? "",
      "Store ID": r.store_id ?? "",
      "Reference": r.reference ?? "",
      "Deposit": r.deposit ?? "",
      "Remaining Deposit": r.remaining_deposit ?? "",
      "Remarks": r.remarks ?? "",
      "Plan Price": r.plan_price ?? "",
      "Activation Time": r.activation_time ?? "",
      "Employee Name": r.employee_name ?? "",
      "Branch Name": r.branch_name ?? "",
      "Status": r.order_status ?? "",
      "Duplicate": r.is_duplicate ? "YES" : "",
      "Needs Review": r.needs_review ? "YES" : "",
      "Extraction Status": r.status ?? "",
    }));
  }

  async function downloadXlsx() {
    setDownloading(true);
    try {
      const all = await fetchAllExportRows();
      if (all.length === 0) { toast.info("No orders to download"); return; }
      const exportRows = mapExportRows(all);
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(exportRows);
      const cols = Object.keys(exportRows[0]).map((k) => ({
        wch: Math.min(40, Math.max(k.length + 2, ...exportRows.map((r) => String((r as Record<string, unknown>)[k] ?? "").length))),
      }));
      ws["!cols"] = cols;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Orders");
      XLSX.writeFile(wb, `all-orders-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`Downloaded ${all.length} orders`);
    } catch (err) {
      console.error(err);
      toast.error("Download failed");
    } finally {
      setDownloading(false);
    }
  }

  async function downloadCsv() {
    setDownloading(true);
    try {
      const all = await fetchAllExportRows();
      if (all.length === 0) { toast.info("No orders to download"); return; }
      const exportRows = mapExportRows(all);
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(exportRows);
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `all-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${all.length} orders`);
    } catch (err) {
      console.error(err);
      toast.error("Download failed");
    } finally {
      setDownloading(false);
    }
  }

  useKeyboardShortcuts({
    "j": () => setCursor((c) => Math.min(rows.length - 1, c + 1)),
    "k": () => setCursor((c) => Math.max(0, c - 1)),
    "x": () => { const r = rows[cursor]; if (r) toggleOne(r.id); },
    "r": () => {
      const r = rows[cursor];
      if (!r) return;
      const ids = selected.size > 0 ? Array.from(selected) : [r.id];
      void supabase.from("extractions").update({ needs_review: !r.needs_review }).in("id", ids).then(({ error }) => {
        if (error) toast.error(error.message);
        else { toast.success(`${!r.needs_review ? "Flagged" : "Cleared"} ${ids.length} order${ids.length > 1 ? "s" : ""}`); qc.invalidateQueries({ queryKey: ["all-orders"] }); }
      });
    },
    "shift+/": () => setShortcutsOpen(true),
    "escape": () => { setSelected(new Set()); setShortcutsOpen(false); },
  });

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">All Orders</h1>
          <p className="text-sm text-slate-500/80 mt-1">Unified view of every extracted order across all batches</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500/80">
            {isFetching ? (
              <span className="inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin text-primary" /> Loading…</span>
            ) : (
              <>{total.toLocaleString()} orders{selected.size > 0 && ` · ${selected.size} selected`}</>
            )}
          </div>
          {selected.size > 0 && (
            <>
              <Button size="sm" variant="outline" className="rounded-2xl" onClick={() => void bulkMarkReview(true)} disabled={markingReview}>
                <CheckCheck className="w-4 h-4 mr-2" /> Flag for review
              </Button>
              <Button size="sm" variant="outline" className="rounded-2xl" onClick={() => void bulkMarkReview(false)} disabled={markingReview}>
                <EyeOff className="w-4 h-4 mr-2" /> Clear review
              </Button>
              <Button size="sm" variant="destructive" className="rounded-2xl" onClick={() => setConfirmDeleteOpen(true)}>
                <Trash2 className="w-4 h-4 mr-2" /> Delete {selected.size}
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" className="rounded-2xl" onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
            <Keyboard className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" className="rounded-2xl" onClick={downloadCsv} disabled={downloading || total === 0}>
            {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
            Download CSV
          </Button>
          <Button size="sm" className="gradient-brand font-bold rounded-2xl px-5 shadow-sm" onClick={downloadXlsx} disabled={downloading || total === 0}>
            {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Download Excel
          </Button>
        </div>
      </div>



      <Card className="rounded-2xl border-slate-200/60 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-slate-500/80 flex items-center gap-2">
            <Filter className="w-4 h-4" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Input
            placeholder="Search name, phone, CNIC…"
            className="rounded-2xl"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          <Select value={batchId} onValueChange={(v) => { setBatchId(v); setPage(0); }}>
            <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Batch" /></SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value="all">All batches</SelectItem>
              {batches?.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="success">Success (unique)</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="review">Needs review</SelectItem>
              
            </SelectContent>
          </Select>
          <Select value={network} onValueChange={(v) => { setNetwork(v); setPage(0); }}>
            <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Network" /></SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value="all">All networks</SelectItem>
              {networks.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select
            value={storeFilter ?? "all"}
            onValueChange={(v) => { navigate({ search: { store: v === "all" ? undefined : v } }); setPage(0); }}
          >
            <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Store ID" /></SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value="all">All store IDs</SelectItem>
              {(storeOptions ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={branch} onValueChange={(v) => { setBranch(v); setPage(0); }}>
            <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Branch" /></SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value="all">All branches</SelectItem>
              {(branchOptions ?? []).map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            type="date"
            aria-label="Activation from"
            placeholder="Activation from"
            className="rounded-2xl"
            value={activationFrom}
            onChange={(e) => { setActivationFrom(e.target.value); setPage(0); }}
          />
          <div className="flex gap-2">
            <Input
              type="date"
              aria-label="Activation to"
              placeholder="Activation to"
              className="flex-1 rounded-2xl"
              value={activationTo}
              onChange={(e) => { setActivationTo(e.target.value); setPage(0); }}
            />
            {hasFilters && (
              <Button variant="ghost" size="icon" onClick={resetFilters} title="Clear filters" aria-label="Clear filters">
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>

          {storeFilter && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Store:</span>
              <span className="font-semibold text-primary">{storeFilter}</span>
              <button
                type="button"
                className="ml-1 rounded p-0.5 text-muted-foreground hover:text-destructive"
                onClick={() => navigate({ search: { store: undefined } })}
                aria-label="Clear store filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </CardContent>

        <CardContent className="border-t pt-3 flex flex-wrap items-center gap-2">
          <BookmarkPlus className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-[10px] font-bold text-slate-500/80 uppercase tracking-wider">Saved views</span>
          {(presets ?? []).length === 0 && (
            <span className="text-xs text-muted-foreground">— none yet</span>
          )}
          {(presets ?? []).map((p) => (
            <div key={p.id} className="inline-flex items-center gap-0.5 rounded-2xl border bg-muted/40 pl-2">
              <button
                type="button"
                onClick={() => applyPreset(p)}
                className="text-xs px-1.5 py-1 hover:text-primary"
                title={`Load "${p.name}"`}
              >
                {p.name}
              </button>
              <button
                type="button"
                onClick={() => deletePreset(p.id)}
                className="p-1 text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${p.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Input
              placeholder="Preset name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              className="h-8 w-40 text-xs rounded-2xl"
              onKeyDown={(e) => { if (e.key === "Enter") void savePreset(); }}
            />
            <Button size="sm" variant="outline" className="rounded-2xl" onClick={savePreset} disabled={savingPreset || !presetName.trim()}>
              {savingPreset ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
              Save view
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200/60 shadow-sm overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          {rows.length === 0 && isFetching && !data ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            hasFilters ? (
              <EmptyState
                icon={SlidersHorizontal}
                title="No orders match these filters"
                description="Try clearing filters or widening your date range."
              />
            ) : (
              <EmptyState
                icon={FileImage}
                title="No orders yet"
                description="Import a batch of screenshots to see extracted orders here."
                action={{ label: "Create a batch", to: "/batches/new" }}
              />
            )
          ) : (
            <table className="w-full text-[11px] min-w-[1400px] border-collapse">
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500/80 font-bold border-b border-slate-200/60">
                <tr>
                  <th className="p-3 w-8">
                    <Checkbox
                      checked={allChecked}
                      onCheckedChange={toggleAll}
                      aria-label="Select all on this page"
                    />
                  </th>
                  <th className="text-left p-3">Batch</th>
                  {COLUMNS.map((c) => (
                    <th key={c} className="text-left p-3 whitespace-nowrap">{FIELD_LABELS[c]}</th>
                  ))}
                  <th className="text-left p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, rowIdx) => {
                  const batch = batches?.find((b) => b.id === r.batch_id);
                  const isSelected = selected.has(r.id);
                  const isCursor = rowIdx === cursor;
                  return (
                    <tr
                      key={r.id}
                      data-cursor={isCursor ? "true" : undefined}
                      className={`border-t border-slate-100 hover:bg-slate-50/30 transition-colors ${isSelected ? "bg-primary/5" : ""} ${isCursor ? "bg-slate-50 outline outline-2 outline-primary/20 -outline-offset-2" : ""}`}
                    >
                      <td className="p-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(r.id)}
                          aria-label={`Select order ${r.order_number ?? r.id}`}
                        />
                      </td>
                      <td className="p-3">
                        <Link to="/batches/$id" params={{ id: r.batch_id }} className="text-primary hover:underline font-bold text-[10px] uppercase">
                          {batch?.name ?? "—"}
                        </Link>
                      </td>

                      {COLUMNS.map((c) => {
                        let val = (r as Record<string, unknown>)[c] as string | null | undefined;
                        // Business rule: "new number" is always issued on ONIC.
                        if (c === "current_network" && typeof r.number_type === "string" && r.number_type.trim().toLowerCase() === "new number") {
                          val = "ONIC";
                        }
                        const editable = c === "customer_name" || c === "phone_number" || c === "cnic" || c === "order_number";
                        return (
                          <td key={c} className="p-3 whitespace-nowrap">
                            {editable ? (
                              <InlineEditCell
                                value={val ?? null}
                                onSave={(v) => updateRowField(r.id, c, v)}
                                monospace={c !== "customer_name"}
                                placeholder={FIELD_LABELS[c]}
                              />
                            ) : (
                              val || <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-3">
                        <span className={`uppercase text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-2xl border ${
                          r.is_duplicate ? "bg-red-50 text-red-600 border-red-100" :
                          r.needs_review ? "bg-amber-50 text-amber-600 border-amber-100" :
                          r.status === "completed" || r.status === "success" ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                          "bg-muted border-none"
                        }`}>
                          {r.is_duplicate ? "DUP" : r.needs_review ? "REVIEW" : r.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500/80">
            Page {page + 1} of {totalPages} · {rows.length} of {total.toLocaleString()} rows
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="rounded-2xl" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" className="rounded-2xl" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle></DialogHeader>
          <div className="text-sm space-y-2">
            {[
              ["J", "Next row"],
              ["K", "Previous row"],
              ["X", "Toggle select for current row"],
              ["R", "Toggle 'needs review' on selected (or current) row(s)"],
              ["Esc", "Clear selection"],
              ["Shift + /", "Show this help"],
            ].map(([k, d]) => (
              <div key={k} className="flex items-center justify-between border-b last:border-0 py-1.5">
                <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded-2xl border">{k}</kbd>
                <span className="text-muted-foreground">{d}</span>
              </div>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">Shortcuts are disabled while typing in inputs.</div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={(open) => !deleting && setConfirmDeleteOpen(open)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete {selected.size} order{selected.size > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {selected.size === 1 ? "this order" : "these orders"} from the database <strong>permanently</strong>.
              This action cannot be undone — there is no way to recover the deleted data. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="rounded-2xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void performDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-2xl"
            >
              {deleting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deleting…</> : `Yes, delete permanently`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


