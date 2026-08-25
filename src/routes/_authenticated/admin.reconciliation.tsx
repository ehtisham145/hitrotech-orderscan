import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Scale, Lock, Unlock, RefreshCw, Trash2, Banknote } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { requireWorkspaceRole } from "@/lib/route-guards";
import { PlanGate } from "@/components/PlanGate";
import {
  getPaymentLedger,
  recordPayoutPayment,
  deletePayoutPayment,
  recordBrandReceipt,
  deleteBrandReceipt,
  listReceiptBrands,
  type LedgerRow,
} from "@/lib/reconcile.functions";
import { getMonthClose, closeMonthNow, reopenMonth, listMonthCloses } from "@/lib/month-close.functions";

export const Route = createFileRoute("/_authenticated/admin/reconciliation")({
  head: () => ({
    meta: [
      { title: "Reconciliation & Month Close — HitroTech OrderScan" },
      { name: "description", content: "Track what you owe partners, what you paid, what the brand owes you, and close the month." },
      { property: "og:title", content: "Reconciliation & Month Close" },
      { property: "og:description", content: "Partner payments, brand receipts and automated monthly close." },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "accountant"] as const);
  },
  component: () => <PlanGate feature="reconciliation"><ReconciliationPage /></PlanGate>,
});

const pkr = (n: number) => "PKR " + Math.round(n || 0).toLocaleString("en-PK");

const STATUS_STYLE: Record<string, string> = {
  unpaid: "bg-destructive/10 text-destructive border-destructive/20",
  partial: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  settled: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  overpaid: "bg-sky-500/10 text-sky-600 border-sky-500/20",
};

function ReconciliationPage() {
  const qc = useQueryClient();
  const fetchLedger = useServerFn(getPaymentLedger);
  const fetchBrands = useServerFn(listReceiptBrands);
  const fetchClose = useServerFn(getMonthClose);
  const fetchCloses = useServerFn(listMonthCloses);
  const runPay = useServerFn(recordPayoutPayment);
  const runDeletePay = useServerFn(deletePayoutPayment);
  const runReceipt = useServerFn(recordBrandReceipt);
  const runDeleteReceipt = useServerFn(deleteBrandReceipt);
  const runClose = useServerFn(closeMonthNow);
  const runReopen = useServerFn(reopenMonth);

  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const monthDate = month + "-01";

  const [payRow, setPayRow] = useState<LedgerRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payRef, setPayRef] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptRef, setReceiptRef] = useState("");
  const [confirm, setConfirm] = useState<null | "close" | "reopen">(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["ledger", monthDate],
    queryFn: () => fetchLedger({ data: { month: monthDate } }),
  });
  const { data: brands } = useQuery({ queryKey: ["receipt-brands"], queryFn: () => fetchBrands({}) });
  const { data: closeData } = useQuery({
    queryKey: ["month-close", monthDate],
    queryFn: () => fetchClose({ data: { month: monthDate } }),
  });
  const { data: closeHistory } = useQuery({ queryKey: ["month-closes"], queryFn: () => fetchCloses({}) });

  const rows = (data?.rows ?? []) as LedgerRow[];
  const totals = data?.totals ?? { owed: 0, paid: 0, outstanding: 0, activations: 0, settled: 0 };
  const brand = data?.brand;
  const payments = data?.payments ?? [];
  const activeBrandId = brand?.brand_id ?? brands?.find((b) => b.active)?.id ?? brands?.[0]?.id ?? null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ledger", monthDate] });
    qc.invalidateQueries({ queryKey: ["month-close", monthDate] });
    qc.invalidateQueries({ queryKey: ["month-closes"] });
  };

  async function submitPayment() {
    if (!payRow) return;
    const amount = Number(payAmount);
    if (!(amount > 0)) return toast.error("Enter an amount greater than zero");
    setBusy(true);
    const res = await runPay({
      data: {
        partner_id: payRow.partner_id,
        month: monthDate,
        amount_pkr: amount,
        reference: payRef || null,
        notes: payNotes || null,
      },
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Could not record payment");
    toast.success(`Recorded ${pkr(amount)} to ${payRow.name}`);
    setPayRow(null);
    setPayAmount("");
    setPayRef("");
    setPayNotes("");
    refresh();
  }

  async function submitReceipt() {
    if (!activeBrandId) return toast.error("Add a brand first on the My Brand page");
    const amount = Number(receiptAmount);
    if (!(amount > 0)) return toast.error("Enter an amount greater than zero");
    setBusy(true);
    const res = await runReceipt({
      data: { brand_id: activeBrandId, month: monthDate, amount_pkr: amount, reference: receiptRef || null },
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Could not record receipt");
    toast.success(`Recorded ${pkr(amount)} received`);
    setReceiptOpen(false);
    setReceiptAmount("");
    setReceiptRef("");
    refresh();
  }

  async function doClose() {
    setBusy(true);
    try {
      const res = await runClose({ data: { month: monthDate, lock: true } });
      toast.success(`Closed ${month} — ${res.activations} activations, margin ${pkr(res.margin)}`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
    setConfirm(null);
  }

  async function doReopen() {
    setBusy(true);
    try {
      await runReopen({ data: { month: monthDate } });
      toast.success(`Reopened ${month}`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
    setConfirm(null);
  }

  const closed = closeData?.close?.status === "closed";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" /> Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground">
            What you owe partners vs what you actually paid, and what the brand owes you vs what landed in the bank.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Month</div>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-[160px]" />
          </div>
          <Button variant="outline" size="sm" className="h-9" onClick={refresh}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Owed to partners", value: pkr(totals.owed), sub: `${totals.activations} activations` },
          { label: "Paid to partners", value: pkr(totals.paid), sub: `${totals.settled} settled` },
          { label: "Outstanding to partners", value: pkr(totals.outstanding), sub: rows.filter((r) => r.status !== "settled").length + " open" },
          { label: "Brand receivable open", value: pkr(brand?.outstanding ?? 0), sub: `${pkr(brand?.received ?? 0)} received` },
        ].map((t) => (
          <Card key={t.label}>
            <CardContent className="pt-5">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t.label}</div>
              <div className="text-2xl font-display font-semibold mt-1">{t.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{t.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Month close */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {closed ? <Lock className="h-4 w-4 text-emerald-600" /> : <Unlock className="h-4 w-4 text-muted-foreground" />}
            Month close — {month}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Closing snapshots every partner payout, prices the month with your brand slabs into a receivable, and locks the month.
            This runs automatically at 00:20 on the 1st for the previous month.
          </p>
          {closeData?.close && (
            <div className="grid gap-3 sm:grid-cols-4 text-sm">
              <div><span className="text-muted-foreground">Activations</span><div className="font-medium">{closeData.close.activations_count}</div></div>
              <div><span className="text-muted-foreground">Partner cost</span><div className="font-medium">{pkr(closeData.close.partner_cost_pkr)}</div></div>
              <div><span className="text-muted-foreground">Brand revenue</span><div className="font-medium">{pkr(closeData.close.brand_revenue_pkr)}</div></div>
              <div><span className="text-muted-foreground">Margin</span><div className="font-medium text-emerald-600">{pkr(closeData.close.margin_pkr)}</div></div>
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => setConfirm("close")}>
              <Lock className="h-4 w-4 mr-1.5" /> {closed ? "Re-run close" : "Close month"}
            </Button>
            {closed && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm("reopen")}>
                <Unlock className="h-4 w-4 mr-1.5" /> Reopen
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Partner ledger */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Partner payment ledger</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <EmptyState title="Nothing to reconcile" description="No partner activations or payments recorded for this month yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b">
                    <th className="py-2 pr-3">Partner</th>
                    <th className="py-2 pr-3 text-right">Activations</th>
                    <th className="py-2 pr-3 text-right">Owed</th>
                    <th className="py-2 pr-3 text-right">Paid</th>
                    <th className="py-2 pr-3 text-right">Outstanding</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.partner_id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{r.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.count}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pkr(r.owed)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pkr(r.paid)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-medium">{pkr(r.outstanding)}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className={STATUS_STYLE[r.status]}>{r.status}</Badge>
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setPayRow(r);
                            setPayAmount(String(Math.max(0, Math.round(r.outstanding))));
                          }}
                        >
                          <Banknote className="h-4 w-4 mr-1.5" /> Record payment
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Brand receipts */}
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Brand receipts</CardTitle>
          <Button size="sm" onClick={() => setReceiptOpen(true)} disabled={!activeBrandId}>
            <Banknote className="h-4 w-4 mr-1.5" /> Record receipt
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div><span className="text-muted-foreground">Invoiced</span><div className="font-medium">{pkr(brand?.invoiced ?? 0)}</div></div>
            <div><span className="text-muted-foreground">Received</span><div className="font-medium">{pkr(brand?.received ?? 0)}</div></div>
            <div><span className="text-muted-foreground">Outstanding</span><div className="font-medium">{pkr(brand?.outstanding ?? 0)}</div></div>
          </div>
          {(brand?.receipts ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No receipts recorded for this month.</p>
          ) : (
            <ul className="divide-y text-sm">
              {(brand?.receipts ?? []).map((r: any) => (
                <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                  <span>
                    <span className="font-medium">{pkr(Number(r.amount_pkr))}</span>{" "}
                    <span className="text-muted-foreground">on {r.received_on}{r.reference ? ` · ${r.reference}` : ""}</span>
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      await runDeleteReceipt({ data: { id: r.id } });
                      refresh();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Payments log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payments this month</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No partner payments recorded yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {payments.map((p: any) => (
                <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                  <span>
                    <span className="font-medium">{pkr(Number(p.amount_pkr))}</span>{" "}
                    <span className="text-muted-foreground">
                      to {rows.find((r) => r.partner_id === p.partner_id)?.name ?? "partner"} on {p.paid_on}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </span>
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      await runDeletePay({ data: { id: p.id } });
                      refresh();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Close history */}
      {(closeHistory ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Close history</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {(closeHistory ?? []).map((c) => (
                <li key={c.id} className="py-2 flex items-center justify-between gap-3">
                  <span className="font-medium">{c.month.slice(0, 7)}</span>
                  <span className="text-muted-foreground">
                    {c.activations_count} activations · margin {pkr(c.margin_pkr)} ·{" "}
                    {c.closed_automatically ? "auto" : "manual"} · {c.status}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Record payment dialog */}
      <Dialog open={!!payRow} onOpenChange={(o) => !o && setPayRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment — {payRow?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Amount (PKR)</div>
              <Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Reference</div>
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Bank transfer id" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Notes</div>
              <Textarea value={payNotes} onChange={(e) => setPayNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayRow(null)}>Cancel</Button>
            <Button onClick={submitPayment} disabled={busy}>Save payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record receipt dialog */}
      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record brand receipt</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Amount (PKR)</div>
              <Input type="number" value={receiptAmount} onChange={(e) => setReceiptAmount(e.target.value)} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Reference</div>
              <Input value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiptOpen(false)}>Cancel</Button>
            <Button onClick={submitReceipt} disabled={busy}>Save receipt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "close" ? `Close ${month}?` : `Reopen ${month}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "close"
                ? "Payout snapshots and the brand receivable will be regenerated and the month will be locked. Already-paid payouts are left untouched."
                : "The month will be unlocked so figures can change again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm === "close" ? doClose : doReopen}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
