import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Wallet, Download, Printer, RefreshCw, CheckCircle2, Clock, Lock, Unlock, FileArchive, AlertTriangle, FileText, MessageCircle } from "lucide-react";
import { format } from "date-fns";
import { EmptyState } from "@/components/EmptyState";
import {
  getPayoutSummary,
  generatePayoutsForMonth,
  markPayoutStatus,
  upsertPayout,
  bulkMarkPayoutsPaid,
} from "@/lib/payouts.functions";
import {
  isMonthLocked,
  lockMonth,
  unlockMonth,
  exportMonthlyBackup,
  getReconciliation,
  listMonthLockHistory,
} from "@/lib/reliability.functions";
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
import { Search } from "lucide-react";
import { requireWorkspaceRole } from "@/lib/route-guards";
import { PlanGate } from "@/components/PlanGate";

const ROLE_LABEL: Record<string, string> = {
  franchise_owner: "Franchise Owner",
  retailer: "Retailer",
  franchise_as_retailer: "Franchise-as-Retailer",
  field_worker: "Field Worker",
  asm: "ASM",
};

export const Route = createFileRoute("/_authenticated/admin/payouts")({
  head: () => ({
    meta: [
      { title: "Payouts — HitroTech OrderScan" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "manager", "accountant"] as const);
  },
  component: () => <PlanGate feature="payouts"><PayoutsPage /></PlanGate>,
});

type Row = {
  partner_id: string;
  name: string;
  role: string;
  store_id: string | null;
  phone: string | null;
  cnic: string | null;
  active: boolean;
  count: number;
  rate: number;
  amount: number;
  payout_id: string | null;
  status: string;
  paid_at: string | null;
  payment_reference: string | null;
  notes: string | null;
};

function PayoutsPage() {
  const qc = useQueryClient();
  const fetchSummary = useServerFn(getPayoutSummary);
  const runGenerate = useServerFn(generatePayoutsForMonth);
  const runMark = useServerFn(markPayoutStatus);
  const runUpsert = useServerFn(upsertPayout);
  const runBulkPay = useServerFn(bulkMarkPayoutsPaid);
  const fetchLock = useServerFn(isMonthLocked);
  const runLock = useServerFn(lockMonth);
  const runUnlock = useServerFn(unlockMonth);
  const runBackup = useServerFn(exportMonthlyBackup);
  const fetchRecon = useServerFn(getReconciliation);
  const fetchLockHistory = useServerFn(listMonthLockHistory);

  const [month, setMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [filter, setFilter] = useState<"all" | "pending" | "paid">("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [payingRow, setPayingRow] = useState<Row | null>(null);
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [busy, setBusy] = useState<null | "lock" | "unlock" | "backup" | "bulk">(null);
  const [lockDialog, setLockDialog] = useState<null | "lock" | "unlock">(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRef, setBulkRef] = useState("");

  const monthDate = month + "-01";
  const { data, isLoading } = useQuery({
    queryKey: ["payouts", monthDate],
    queryFn: () => fetchSummary({ data: { month: monthDate } }),
  });
  const { data: lockData } = useQuery({
    queryKey: ["month-lock", monthDate],
    queryFn: () => fetchLock({ data: { month: monthDate } }),
  });
  const { data: reconData } = useQuery({
    queryKey: ["recon", monthDate],
    queryFn: () => fetchRecon({ data: { month: monthDate } }),
  });
  const { data: lockHistory } = useQuery({
    queryKey: ["month-lock-history", monthDate],
    queryFn: () => fetchLockHistory({ data: { month: monthDate, limit: 10 } }),
  });
  const locked = lockData?.locked ?? false;
  const lockRow = lockData?.row as any;
  const reconRows = reconData?.rows ?? [];

  const rows: Row[] = (data?.rows ?? []) as Row[];
  const availableRoles = Array.from(new Set(rows.map((r) => r.role)));
  const filtered = rows.filter((r) => {
    if (filter === "paid" && r.status !== "paid") return false;
    if (filter === "pending" && r.status === "paid") return false;
    if (roleFilter !== "all" && r.role !== roleFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = [r.name, r.store_id ?? "", r.phone ?? "", r.cnic ?? ""].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const pendingInFiltered = filtered.filter((r) => r.status !== "paid");
  const totals = data?.totals ?? { partners: 0, activations: 0, total: 0, paid: 0, pending: 0 };
  const fmt = (n: number) => "PKR " + n.toLocaleString();

  async function onGenerate() {
    try {
      const res = await runGenerate({ data: { month: monthDate } });
      toast.success(`Payouts synced: ${res.created} new, ${res.updated} updated, ${res.skipped} kept paid.`);
      qc.invalidateQueries({ queryKey: ["payouts", monthDate] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate payouts.");
    }
  }

  async function onToggle(row: Row) {
    if (!row.payout_id) {
      // create record then mark
      try {
        await runUpsert({
          data: {
            partner_id: row.partner_id,
            month: monthDate,
            activations_count: row.count,
            rate_pkr: row.rate,
            amount_pkr: row.amount,
            status: "paid",
          },
        });
        toast.success("Marked as paid.");
        qc.invalidateQueries({ queryKey: ["payouts", monthDate] });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed.");
      }
      return;
    }
    const next = row.status === "paid" ? "pending" : "paid";
    try {
      await runMark({ data: { payout_id: row.payout_id, status: next } });
      toast.success(next === "paid" ? "Marked as paid." : "Reverted to pending.");
      qc.invalidateQueries({ queryKey: ["payouts", monthDate] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    }
  }

  async function onConfirmPay() {
    if (!payingRow) return;
    try {
      await runUpsert({
        data: {
          partner_id: payingRow.partner_id,
          month: monthDate,
          activations_count: payingRow.count,
          rate_pkr: payingRow.rate,
          amount_pkr: payingRow.amount,
          status: "paid",
          payment_reference: paymentRef || null,
          notes: paymentNotes || null,
        },
      });
      toast.success("Payment recorded.");
      setPayingRow(null);
      setPaymentRef("");
      setPaymentNotes("");
      qc.invalidateQueries({ queryKey: ["payouts", monthDate] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    }
  }

  function exportCsv() {
    const header = ["Partner", "Role", "Store", "Phone", "CNIC", "Activations", "Rate (PKR)", "Amount (PKR)", "Status", "Paid At", "Reference"];
    const lines = [header.join(",")];
    for (const r of filtered) {
      const cells = [
        r.name,
        ROLE_LABEL[r.role] ?? r.role,
        r.store_id ?? "",
        r.phone ?? "",
        r.cnic ?? "",
        r.count.toString(),
        r.rate.toString(),
        r.amount.toString(),
        r.status,
        r.paid_at ? new Date(r.paid_at).toISOString().slice(0, 10) : "",
        r.payment_reference ?? "",
      ].map((v) => {
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      });
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payouts-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function performLockToggle() {
    const action = locked ? "unlock" : "lock";
    setBusy(action);
    try {
      if (locked) {
        await runUnlock({ data: { month: monthDate } });
        toast.success(`${format(new Date(monthDate), "MMMM yyyy")} unlocked.`);
      } else {
        await runLock({ data: { month: monthDate } });
        toast.success(`${format(new Date(monthDate), "MMMM yyyy")} locked.`);
      }
      qc.invalidateQueries({ queryKey: ["month-lock", monthDate] });
      qc.invalidateQueries({ queryKey: ["month-lock-history", monthDate] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to ${action}.`);
    } finally {
      setBusy(null);
      setLockDialog(null);
    }
  }

  async function onBulkPay() {
    setBusy("bulk");
    try {
      const res = await runBulkPay({
        data: {
          month: monthDate,
          partner_ids: pendingInFiltered.map((r) => r.partner_id),
          payment_reference: bulkRef.trim() || null,
        },
      });
      toast.success(`${res.paid} payout${res.paid === 1 ? "" : "s"} marked as paid.`);
      setBulkOpen(false);
      setBulkRef("");
      qc.invalidateQueries({ queryKey: ["payouts", monthDate] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk mark failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onBackup() {
    setBusy("backup");
    try {
      const res = await runBackup({ data: { month: monthDate } });
      toast.success(`Backup ready: ${res.counts.extractions} activations · ${res.counts.payouts} payouts.`);
      window.open(res.url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to build backup.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Payouts</h1>
            {locked && (
              <Badge className="bg-slate-500/15 text-muted-foreground border-slate-500/30 hover:bg-slate-500/15">
                <Lock className="w-3 h-3 mr-1" /> Month locked
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Monthly commission payouts for {format(new Date(monthDate), "MMMM yyyy")}.
            {locked && lockRow && (
              <span className="ml-1">
                Locked by <span className="font-medium">{lockRow.locked_by_name ?? "someone"}</span> · {format(new Date(lockRow.locked_at), "d MMM yyyy")}.
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 px-3 rounded-md border border-input bg-background text-sm"
          />
          <Button variant="outline" size="sm" onClick={onGenerate} disabled={busy !== null}>
            <RefreshCw className="w-4 h-4 mr-1" /> Sync from activations
          </Button>
          <Button variant="outline" size="sm" onClick={onBackup} disabled={busy !== null}>
            <FileArchive className="w-4 h-4 mr-1" /> {busy === "backup" ? "Building…" : "Backup .xlsx"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLockDialog(locked ? "unlock" : "lock")} disabled={busy !== null}>
            {locked ? <><Unlock className="w-4 h-4 mr-1" /> Unlock month</> : <><Lock className="w-4 h-4 mr-1" /> Lock month</>}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} disabled={filtered.length === 0}>
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Partners" value={totals.partners.toString()} sub="with activity" />
        <SummaryCard label="Total" value={fmt(totals.total)} sub={`${totals.activations} activations`} />
        <SummaryCard label="Paid" value={fmt(totals.paid)} sub="disbursed" tone="paid" />
        <SummaryCard label="Pending" value={fmt(totals.pending)} sub="to disburse" tone="pending" />
      </div>

      {reconRows.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-amber-700">
              <AlertTriangle className="w-4 h-4" />
              Reconciliation — {reconRows.length} partner{reconRows.length === 1 ? "" : "s"} drifted since payouts were generated
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Activations were added, removed, or reassigned after the payout snapshot. Click <span className="font-medium">Sync from activations</span> to update pending rows (paid rows are preserved).
            </p>
            <div className="space-y-1 text-sm">
              {reconRows.slice(0, 8).map((r) => (
                <div key={r.partner_id} className="flex items-center gap-3">
                  <span className="font-medium flex-1 truncate">{r.name}</span>
                  <span className="text-xs text-muted-foreground">
                    snapshot {r.snapshot_count} · live {r.live_count}
                  </span>
                  <span className={"text-xs font-medium " + (r.delta_amount > 0 ? "text-emerald-600" : "text-red-600")}>
                    {r.delta_amount > 0 ? "+" : ""}{fmt(r.delta_amount)}
                  </span>
                </div>
              ))}
              {reconRows.length > 8 && (
                <div className="text-xs text-muted-foreground pt-1">…and {reconRows.length - 8} more.</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}


      <Card className="print:shadow-none print:border-0">
        <CardHeader className="flex flex-col gap-3 print:hidden">
          <div className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">Payout list</CardTitle>
            <div className="flex gap-2 flex-wrap">
              {(["all", "pending", "paid"] as const).map((k) => (
                <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>
                  {k === "all" ? "All" : k === "paid" ? "Paid" : "Pending"}
                </Button>
              ))}
              <Button
                size="sm"
                onClick={() => { setBulkRef(""); setBulkOpen(true); }}
                disabled={pendingInFiltered.length === 0 || busy !== null}
                title={pendingInFiltered.length === 0 ? "Nothing to mark" : `Mark ${pendingInFiltered.length} pending as paid`}
              >
                <CheckCircle2 className="w-4 h-4 mr-1" /> Mark all pending paid
                {pendingInFiltered.length > 0 && <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">{pendingInFiltered.length}</Badge>}
              </Button>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search name, store, phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 text-sm"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="all">All roles</option>
              {availableRoles.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>
              ))}
            </select>
            {(search || roleFilter !== "all" || filter !== "all") && (
              <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setRoleFilter("all"); setFilter("all"); }}>
                Clear filters
              </Button>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {filtered.length} of {rows.length} rows
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="hidden print:block mb-4">
            <h2 className="text-xl font-semibold">Payout Report — {format(new Date(monthDate), "MMMM yyyy")}</h2>
            <p className="text-sm text-muted-foreground">
              {totals.partners} partners · {totals.activations} activations · Total {fmt(totals.total)}
            </p>
          </div>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={Wallet} title="No payouts" description="No commission activity for this month yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
                    <th className="py-2 pr-3">Partner</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 pr-3">Store</th>
                    <th className="py-2 pr-3 text-right">Activations</th>
                    <th className="py-2 pr-3 text-right">Rate</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 print:hidden"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((r) => (
                    <tr key={r.partner_id}>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.phone ?? "—"}
                          {r.cnic ? ` · ${r.cnic}` : ""}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="secondary" className="text-xs">{ROLE_LABEL[r.role] ?? r.role}</Badge>
                      </td>
                      <td className="py-2 pr-3">{r.store_id ?? "—"}</td>
                      <td className="py-2 pr-3 text-right">{r.count}</td>
                      <td className="py-2 pr-3 text-right">{fmt(r.rate)}</td>
                      <td className="py-2 pr-3 text-right font-semibold">{fmt(r.amount)}</td>
                      <td className="py-2 pr-3">
                        {r.status === "paid" ? (
                          <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/15">
                            <CheckCircle2 className="w-3 h-3 mr-1" />Paid
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            <Clock className="w-3 h-3 mr-1" />Pending
                          </Badge>
                        )}
                        {r.paid_at && (
                          <div className="text-[11px] text-muted-foreground mt-1">
                            {format(new Date(r.paid_at), "d MMM yyyy")}
                            {r.payment_reference ? ` · ${r.payment_reference}` : ""}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 print:hidden text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" asChild title="Statement">
                            <Link to="/admin/statements/$partnerId" params={{ partnerId: r.partner_id }}>
                              <FileText className="w-4 h-4" />
                            </Link>
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-emerald-600"
                            title="WhatsApp"
                            disabled={!r.phone}
                            onClick={() => {
                              const phone = (r.phone ?? "").replace(/\D/g, "");
                              if (!phone) return;
                              const wa = phone.startsWith("0") ? "92" + phone.slice(1) : phone;
                              const label = format(new Date(monthDate), "MMMM yyyy");
                              const st = r.status === "paid" ? "PAID" : "PENDING";
                              const ref = r.payment_reference ? `\nReference: ${r.payment_reference}` : "";
                              const msg = `Assalam-o-Alaikum ${r.name},\n\nHitroTech Commission — ${label}\nActivations: ${r.count}\nRate: PKR ${r.rate.toLocaleString()}\nTotal: PKR ${r.amount.toLocaleString()}\nStatus: ${st}${ref}\n\nShukriya!`;
                              window.open(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
                            }}
                          >
                            <MessageCircle className="w-4 h-4" />
                          </Button>
                          {r.status === "paid" ? (
                            <Button size="sm" variant="outline" onClick={() => onToggle(r)}>Undo</Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => {
                                setPayingRow(r);
                                setPaymentRef("");
                                setPaymentNotes("");
                              }}
                            >
                              Mark paid
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!payingRow} onOpenChange={(o) => !o && setPayingRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
          </DialogHeader>
          {payingRow && (
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground">Partner: </span>
                <span className="font-medium">{payingRow.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Amount: </span>
                <span className="font-semibold">{fmt(payingRow.amount)}</span>
                <span className="text-muted-foreground text-xs"> ({payingRow.count} × {fmt(payingRow.rate)})</span>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Payment reference (optional)</label>
                <Input placeholder="Bank txn ID, JazzCash, EasyPaisa reference…" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Notes (optional)</label>
                <Textarea rows={2} value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayingRow(null)}>Cancel</Button>
            <Button onClick={onConfirmPay}>Confirm payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark all pending as paid</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="text-muted-foreground">
              This will mark <span className="font-semibold text-foreground">{pendingInFiltered.length}</span> pending payout{pendingInFiltered.length === 1 ? "" : "s"} for {format(new Date(monthDate), "MMMM yyyy")} as paid.
              Total: <span className="font-semibold text-foreground">{fmt(pendingInFiltered.reduce((s, r) => s + r.amount, 0))}</span>.
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Payment reference (optional, applied to all)</label>
              <Input placeholder="e.g. Batch transfer 2026-01" value={bulkRef} onChange={(e) => setBulkRef(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={busy === "bulk"}>Cancel</Button>
            <Button onClick={onBulkPay} disabled={busy === "bulk" || pendingInFiltered.length === 0}>
              {busy === "bulk" ? "Marking…" : `Mark ${pendingInFiltered.length} paid`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!lockDialog} onOpenChange={(v) => !v && setLockDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lockDialog === "lock" ? `Lock ${format(new Date(monthDate), "MMMM yyyy")}?` : `Unlock ${format(new Date(monthDate), "MMMM yyyy")}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {lockDialog === "lock" ? (
                  <p>
                    Activations for this month can no longer be created, edited, or deleted while locked.
                    Payouts and payment status remain editable.
                  </p>
                ) : (
                  <p>
                    Unlocking allows activations for this month to be created and edited again. All changes are recorded in the activity log.
                  </p>
                )}
                {locked && lockRow && (
                  <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs space-y-1">
                    <div><span className="text-muted-foreground">Locked by:</span> <span className="font-medium">{lockRow.locked_by_name ?? "Unknown"}</span></div>
                    <div><span className="text-muted-foreground">When:</span> {format(new Date(lockRow.locked_at), "PPpp")}</div>
                    {lockRow.notes && <div><span className="text-muted-foreground">Notes:</span> {lockRow.notes}</div>}
                  </div>
                )}
                {lockHistory && lockHistory.length > 0 && (
                  <div className="rounded-md border border-border/60 p-3 text-xs space-y-1.5 max-h-40 overflow-y-auto">
                    <div className="text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Recent history for this month</div>
                    {lockHistory.map((h) => (
                      <div key={h.id} className="flex items-center gap-2">
                        {h.action === "month.locked" ? <Lock className="w-3 h-3 text-muted-foreground" /> : <Unlock className="w-3 h-3 text-emerald-600" />}
                        <span className="font-medium">{h.action === "month.locked" ? "Locked" : "Unlocked"}</span>
                        <span className="text-muted-foreground">by {h.actor_name ?? "someone"}</span>
                        <span className="text-muted-foreground ml-auto">{format(new Date(h.created_at), "d MMM, HH:mm")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "lock" || busy === "unlock"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); performLockToggle(); }}
              disabled={busy === "lock" || busy === "unlock"}
              className={lockDialog === "unlock" ? "" : "bg-slate-800 hover:bg-slate-900"}
            >
              {busy === "lock" ? "Locking…" : busy === "unlock" ? "Unlocking…" : lockDialog === "lock" ? "Lock month" : "Unlock month"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "paid" | "pending" }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={
            "text-2xl font-semibold mt-1 " +
            (tone === "paid" ? "text-emerald-600" : tone === "pending" ? "text-amber-600" : "")
          }
        >
          {value}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}
