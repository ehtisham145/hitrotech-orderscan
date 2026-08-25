import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Building2, TrendingUp, Wallet, Coins, Users } from "lucide-react";
import { toast } from "sonner";
import { requireWorkspaceRole } from "@/lib/route-guards";
import { PlanGate } from "@/components/PlanGate";
import {
  listBrandSlabs,
  upsertBrand,
  upsertBrandSlab,
  deleteBrandSlab,
  getAgencyEarnings,
  saveBrandInvoice,
  markBrandInvoiceReceived,
} from "@/lib/brand.functions";

export const Route = createFileRoute("/_authenticated/admin/brand")({
  head: () => ({
    meta: [
      { title: "My Brand & Agency Earnings — HitroTech OrderScan" },
      { name: "description", content: "Set what the operator pays your agency and see your margin over every partner's activations." },
      { property: "og:title", content: "My Brand & Agency Earnings" },
      { property: "og:description", content: "Track brand revenue, partner payouts and agency margin in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "accountant"] as const);
  },
  component: () => <PlanGate feature="brand_earnings"><BrandPage /></PlanGate>,
});

const pkr = (n: number) => "PKR " + Math.round(n).toLocaleString();

function monthOptions() {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    out.push({ value, label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }) });
  }
  return out;
}

function BrandPage() {
  const qc = useQueryClient();
  const months = monthOptions();
  const [month, setMonth] = useState(months[0].value);

  const fetchEarnings = useServerFn(getAgencyEarnings);
  const { data, isLoading } = useQuery({
    queryKey: ["agency-earnings", month],
    queryFn: () => fetchEarnings({ data: { month } }),
  });

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Brand & Agency Earnings</h1>
          <p className="text-sm text-muted-foreground font-medium">
            Track brand revenue, partner payouts, and agency margin in one place.
</p>

        </div>
        <div className="w-56">
          <Label className="text-xs text-muted-foreground">Month</Label>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!data?.brand ? (
        <BrandSetup onDone={() => qc.invalidateQueries({ queryKey: ["agency-earnings"] })} />
      ) : (
        <>
          <SummaryTiles
            activations={data.total_activations}
            revenue={data.brand_revenue}
            partnerCost={data.partner_cost}
            employeeCost={data.employee_cost}
            totalExpenses={data.total_expenses}
            margin={data.margin}
          />


          <div className="grid gap-6 lg:grid-cols-2">
            <BrandSlabs brandId={data.brand.id} brandName={data.brand.name} />
            <RevenueBreakdown
              breakdown={data.breakdown}
              activations={data.total_activations}
              unassigned={data.unassigned_activations}
              effectiveRate={data.effective_rate}
              revenue={data.brand_revenue}
            />
          </div>

          <InvoiceCard brandId={data.brand.id} month={month} invoice={data.invoice} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Partner contribution to your brand</CardTitle>
              <CardDescription>
                Each partner's activations roll up into your agency total. Margin is what you keep after paying them.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Partner</th>
                      <th className="px-4 py-2 text-right font-medium">Activations</th>
                      <th className="px-4 py-2 text-right font-medium">Brand revenue</th>
                      <th className="px-4 py-2 text-right font-medium">Partner payout</th>
                      <th className="px-4 py-2 text-right font-medium">Your margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.contributions.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No activations this month.</td></tr>
                    ) : data.contributions.map((c) => (
                      <tr key={c.partner_id} className="border-b last:border-0">
                        <td className="px-4 py-2">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">{c.store_id ?? "—"}</div>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{c.count}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{pkr(c.brand_revenue)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{pkr(c.partner_cost)}</td>
                        <td className={`px-4 py-2 text-right tabular-nums font-medium ${c.margin < 0 ? "text-destructive" : ""}`}>
                          {pkr(c.margin)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryTiles({ 
  activations, 
  revenue, 
  partnerCost, 
  employeeCost, 
  totalExpenses, 
  margin 
}: { 
  activations: number; 
  revenue: number; 
  partnerCost: number; 
  employeeCost: number; 
  totalExpenses: number;
  margin: number 
}) {
  const tiles = [
    { label: "Agency activations", value: activations.toLocaleString(), icon: TrendingUp, hint: "All partners combined" },
    { label: "Brand revenue", value: pkr(revenue), icon: Coins, hint: "What the operator owes you" },
    { label: "Partner payouts", value: pkr(partnerCost), icon: Wallet, hint: "Commission to partners" },
    { label: "Employee costs", value: pkr(employeeCost), icon: Users, hint: "Monthly salaries" },
    { label: "Total expenses", value: pkr(totalExpenses), icon: Wallet, hint: "Partner + Employee costs" },
    { label: "Net margin", value: pkr(margin), icon: Building2, hint: "Revenue minus all costs", accent: true },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((t) => (
        <Card key={t.label} className={t.accent ? "border-primary/40" : undefined}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</span>
              <t.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className={`mt-2 text-2xl font-semibold tabular-nums ${t.accent && margin < 0 ? "text-destructive" : ""}`}>{t.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t.hint}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function BrandSetup({ onDone }: { onDone: () => void }) {
  const save = useServerFn(upsertBrand);
  const [name, setName] = useState("");
  const [operator, setOperator] = useState("");
  const m = useMutation({
    mutationFn: async () => save({ data: { name: name.trim(), operator: operator.trim() || null } }),
    onSuccess: (res) => {
      if (!res.ok) return toast.error(res.error);
      toast.success("Brand created");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add your brand</CardTitle>
        <CardDescription>
          This is your agency's own brand. Once added, every partner's activation is also credited to it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-md">
        <div className="space-y-1.5">
          <Label>Brand name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HitroTech Telecom" />
        </div>
        <div className="space-y-1.5">
          <Label>Operator (optional)</Label>
          <Input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="e.g. ONIC" />
        </div>
        <Button disabled={!name.trim() || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? "Saving…" : "Create brand"}
        </Button>
      </CardContent>
    </Card>
  );
}

function BrandSlabs({ brandId, brandName }: { brandId: string; brandName: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listBrandSlabs);
  const upsert = useServerFn(upsertBrandSlab);
  const remove = useServerFn(deleteBrandSlab);

  const { data: slabs } = useQuery({ queryKey: ["brand-slabs", brandId], queryFn: () => list({ data: { brand_id: brandId } }) });
  const [min, setMin] = useState("1");
  const [max, setMax] = useState("50");
  const [rate, setRate] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["brand-slabs", brandId] });
    qc.invalidateQueries({ queryKey: ["agency-earnings"] });
  };

  const addM = useMutation({
    mutationFn: async () =>
      upsert({
        data: {
          brand_id: brandId,
          min_count: Number(min),
          max_count: max.trim() === "" ? null : Number(max),
          rate_pkr: Number(rate),
          active: true,
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) return toast.error(res.error);
      toast.success("Slab added");
      setRate("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delM = useMutation({
    mutationFn: async (id: string) => remove({ data: { id } }),
    onSuccess: () => { toast.success("Slab removed"); refresh(); },
  });

  const valid = Number(min) >= 1 && (max.trim() === "" || Number(max) >= Number(min)) && Number(rate) > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{brandName} — rate from the operator</CardTitle>
        <CardDescription>What you receive per activation, based on your agency's total monthly volume.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {(slabs ?? []).length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No slabs yet. Add your first range below.
            </p>
          ) : (slabs ?? []).map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>{s.min_count}–{s.max_count ?? "∞"} activations</span>
              <div className="flex items-center gap-3">
                <span className="font-medium tabular-nums">{pkr(s.rate_pkr)}</span>
                <Button size="icon" variant="ghost" onClick={() => delM.mutate(s.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t pt-4">
          <div className="w-20 space-y-1"><Label className="text-xs">From</Label><Input value={min} onChange={(e) => setMin(e.target.value)} /></div>
          <div className="w-20 space-y-1"><Label className="text-xs">To</Label><Input value={max} onChange={(e) => setMax(e.target.value)} placeholder="∞" /></div>
          <div className="w-32 space-y-1"><Label className="text-xs">Rate (PKR)</Label><Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="650" /></div>
          <Button size="sm" disabled={!valid || addM.isPending} onClick={() => addM.mutate()}>
            <Plus className="mr-1 h-4 w-4" /> Add slab
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RevenueBreakdown({
  breakdown, activations, unassigned, effectiveRate, revenue,
}: {
  breakdown: { from: number; to: number | null; units: number; rate: number; amount: number }[];
  activations: number;
  unassigned: number;
  effectiveRate: number;
  revenue: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">How this month's revenue is calculated</CardTitle>
        <CardDescription>{activations.toLocaleString()} activations across all your partners.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {breakdown.length === 0 ? (
          <p className="text-muted-foreground">Add slabs to see your brand revenue for this month.</p>
        ) : (
          <>
            {breakdown.map((b, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-muted-foreground">{b.from}–{b.to ?? "∞"} · {b.units} × {pkr(b.rate)}</span>
                <span className="tabular-nums font-medium">{pkr(b.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t pt-3 font-semibold">
              <span>Total</span><span className="tabular-nums">{pkr(revenue)}</span>
            </div>
            <div className="text-xs text-muted-foreground">Effective rate {pkr(effectiveRate)} per activation.</div>
          </>
        )}
        {unassigned > 0 && (
          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            {unassigned} activation{unassigned === 1 ? "" : "s"} not yet assigned to a partner. They still count towards your brand revenue, but you have no payout cost for them yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InvoiceCard({ brandId, month, invoice }: { brandId: string; month: string; invoice: { id: string; status: string; amount_pkr: number; margin_pkr: number; payment_reference: string | null } | null }) {
  const qc = useQueryClient();
  const save = useServerFn(saveBrandInvoice);
  const mark = useServerFn(markBrandInvoiceReceived);
  const [ref, setRef] = useState(invoice?.payment_reference ?? "");

  const refresh = () => qc.invalidateQueries({ queryKey: ["agency-earnings"] });

  const saveM = useMutation({
    mutationFn: async () => save({ data: { brand_id: brandId, month } }),
    onSuccess: (res) => { if (!res.ok) return toast.error(res.error); toast.success("Receivable saved"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const markM = useMutation({
    mutationFn: async (received: boolean) => mark({ data: { id: invoice!.id, received, payment_reference: ref || null } }),
    onSuccess: (res) => { if (!res.ok) return toast.error(res.error); toast.success("Updated"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Brand receivable</CardTitle>
          <CardDescription>Lock in this month's numbers and track when the operator pays you.</CardDescription>
        </div>
        {invoice && (
          <Badge variant={invoice.status === "received" ? "default" : "secondary"}>
            {invoice.status === "received" ? "Received" : "Pending"}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        {invoice ? (
          <>
            <div className="text-sm">
              <div className="text-muted-foreground text-xs">Invoiced amount</div>
              <div className="text-lg font-semibold tabular-nums">{pkr(invoice.amount_pkr)}</div>
            </div>
            <div className="text-sm">
              <div className="text-muted-foreground text-xs">Locked margin</div>
              <div className="text-lg font-semibold tabular-nums">{pkr(invoice.margin_pkr)}</div>
            </div>
            <div className="w-56 space-y-1">
              <Label className="text-xs">Payment reference</Label>
              <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Bank ref / cheque no." />
            </div>
            <Button variant="outline" onClick={() => saveM.mutate()} disabled={saveM.isPending}>Recalculate</Button>
            <Button onClick={() => markM.mutate(invoice.status !== "received")} disabled={markM.isPending}>
              {invoice.status === "received" ? "Mark as pending" : "Mark as received"}
            </Button>
          </>
        ) : (
          <Button onClick={() => saveM.mutate()} disabled={saveM.isPending}>
            {saveM.isPending ? "Saving…" : "Create receivable for this month"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
