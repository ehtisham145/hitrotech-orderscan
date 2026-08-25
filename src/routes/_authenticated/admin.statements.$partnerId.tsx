import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Printer, MessageCircle, Download } from "lucide-react";
import { format } from "date-fns";
import { getPartnerStatement } from "@/lib/statements.functions";
import logo from "@/assets/hitrotech-logo.png.asset.json";
import { requireWorkspaceRole } from "@/lib/route-guards";

const ROLE_LABEL: Record<string, string> = {
  franchise_owner: "Franchise Owner",
  retailer: "Retailer",
  franchise_as_retailer: "Franchise-as-Retailer",
  field_worker: "Field Worker",
  asm: "ASM",
};

export const Route = createFileRoute("/_authenticated/admin/statements/$partnerId")({
  head: () => ({
    meta: [
      { title: "Partner Statement — HitroTech OrderScan" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "manager", "accountant"] as const);
  },
  component: StatementPage,
});

function fmt(n: number) {
  return "PKR " + n.toLocaleString();
}

function StatementPage() {
  const { partnerId } = Route.useParams();
  const navigate = useNavigate();
  const fetchStatement = useServerFn(getPartnerStatement);
  const [month, setMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const monthDate = month + "-01";

  const { data, isLoading } = useQuery({
    queryKey: ["statement", partnerId, monthDate],
    queryFn: () => fetchStatement({ data: { partner_id: partnerId, month: monthDate } }),
  });

  function onWhatsApp() {
    if (!data) return;
    const phone = (data.partner.phone ?? "").replace(/\D/g, "");
    if (!phone) {
      alert("Partner has no phone number saved.");
      return;
    }
    // Normalize to E.164-ish (assume Pakistan 92 if starts with 0)
    const wa = phone.startsWith("0") ? "92" + phone.slice(1) : phone;
    const monthLabel = format(new Date(monthDate), "MMMM yyyy");
    const status = data.payout?.status === "paid" ? "PAID" : "PENDING";
    const ref = data.payout?.payment_reference ? `\nReference: ${data.payout.payment_reference}` : "";
    const lines = [
      `Assalam-o-Alaikum ${data.partner.name},`,
      "",
      `HitroTech Commission Statement — ${monthLabel}`,
      `Activations: ${data.totals.count}`,
      `Rate: ${fmt(data.totals.rate)} per activation`,
      `Total: ${fmt(data.totals.amount)}`,
      `Status: ${status}${ref}`,
      "",
      "Shukriya!",
    ];
    const url = `https://wa.me/${wa}?text=${encodeURIComponent(lines.join("\n"))}`;
    window.open(url, "_blank", "noopener");
  }

  function onCsv() {
    if (!data) return;
    const header = ["Date", "Phone", "Order #", "Customer", "Store", "Package", "Commission"];
    const lines = [header.join(",")];
    for (const a of data.activations) {
      const cells = [
        a.activation_date_parsed ?? a.activation_date ?? "",
        a.phone_number ?? "",
        a.order_number ?? "",
        a.customer_name ?? "",
        a.store_id ?? "",
        a.package_name ?? "",
        (a.commission_amount ?? 0).toString(),
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
    a.download = `statement-${data.partner.name.replace(/\s+/g, "_")}-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading || !data) {
    return (
      <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const p = data.partner;
  const monthLabel = format(new Date(monthDate), "MMMM yyyy");
  const status = data.payout?.status ?? (data.totals.count > 0 ? "pending" : "none");

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      {/* Toolbar (hidden on print) */}
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/admin/payouts" })}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Partner statement</h1>
            <p className="text-sm text-muted-foreground">{p.name} — {monthLabel}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 px-3 rounded-md border border-input bg-background text-sm"
          />
          <Button variant="outline" size="sm" onClick={onCsv}>
            <Download className="w-4 h-4 mr-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1" /> Print / PDF
          </Button>
          <Button size="sm" onClick={onWhatsApp} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <MessageCircle className="w-4 h-4 mr-1" /> WhatsApp
          </Button>
        </div>
      </div>

      {/* Printable statement */}
      <div className="bg-card border border-border rounded-xl p-8 print:border-0 print:p-0 print:shadow-none space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 rounded-xl bg-white border border-border/60 grid place-items-center overflow-hidden">
              <img src={logo.url} alt="HitroTech Telecom" className="h-11 w-11 object-contain" />
            </div>
            <div>
              <div className="font-display font-semibold text-lg leading-tight">HitroTech Telecom</div>
              <div className="text-xs text-muted-foreground">Commission statement</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold">{monthLabel}</div>
            <div className="text-xs text-muted-foreground">Generated {format(new Date(), "d MMM yyyy")}</div>
          </div>
        </div>

        {/* Partner details */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 text-sm">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Partner</div>
            <div className="font-semibold text-base">{p.name}</div>
            <div className="text-muted-foreground">{ROLE_LABEL[p.role] ?? p.role}</div>
            {p.phone && <div>{p.phone}</div>}
            {p.cnic && <div className="text-xs">CNIC: {p.cnic}</div>}
            {(p.city || p.address) && <div className="text-xs">{[p.city, p.address].filter(Boolean).join(", ")}</div>}
          </div>
          <div className="space-y-1 text-sm md:text-right">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Summary</div>
            <div className="text-3xl font-semibold">{fmt(data.totals.amount)}</div>
            <div className="text-xs text-muted-foreground">
              {data.totals.count} activations × {fmt(data.totals.rate)}
            </div>
            <div className="pt-1">
              {status === "paid" ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/15">Paid</Badge>
              ) : status === "pending" ? (
                <Badge variant="outline">Pending</Badge>
              ) : (
                <Badge variant="outline">No activity</Badge>
              )}
              {data.payout?.paid_at && (
                <div className="text-xs text-muted-foreground mt-1">
                  Paid on {format(new Date(data.payout.paid_at), "d MMM yyyy")}
                  {data.payout.payment_reference ? ` · Ref ${data.payout.payment_reference}` : ""}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Slab math */}
        <div className="rounded-lg bg-muted/40 p-4 grid gap-2 md:grid-cols-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Current slab</div>
            <div className="font-medium">
              {data.slab.current_min}
              {data.slab.current_max !== null ? `–${data.slab.current_max}` : "+"} activations
            </div>
            <div className="text-xs text-muted-foreground">{fmt(data.slab.current_rate)} per activation</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">This month</div>
            <div className="font-medium">{data.totals.count} activations</div>
            <div className="text-xs text-muted-foreground">Total {fmt(data.totals.amount)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Next slab</div>
            {data.slab.next_rate !== null ? (
              <>
                <div className="font-medium">{data.slab.to_go} to go</div>
                <div className="text-xs text-muted-foreground">unlocks {fmt(data.slab.next_rate)}/activation</div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">Top slab reached</div>
            )}
          </div>
        </div>

        {/* Activation list */}
        <div>
          <div className="text-sm font-semibold mb-2">Activations ({data.totals.count})</div>
          {data.activations.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">No activations linked to this partner for {monthLabel}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wider text-muted-foreground border-b">
                    <th className="py-1.5 pr-2 w-8">#</th>
                    <th className="py-1.5 pr-2">Date</th>
                    <th className="py-1.5 pr-2">Phone</th>
                    <th className="py-1.5 pr-2">Order #</th>
                    <th className="py-1.5 pr-2">Customer</th>
                    <th className="py-1.5 pr-2">Store</th>
                    <th className="py-1.5 pr-2">Package</th>
                    <th className="py-1.5 pr-2 text-right">Commission</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.activations.map((a, i) => (
                    <tr key={a.id}>
                      <td className="py-1.5 pr-2 text-muted-foreground">{i + 1}</td>
                      <td className="py-1.5 pr-2">
                        {a.activation_date_parsed
                          ? format(new Date(a.activation_date_parsed), "d MMM")
                          : a.activation_date ?? "—"}
                      </td>
                      <td className="py-1.5 pr-2 font-mono">{a.phone_number ?? "—"}</td>
                      <td className="py-1.5 pr-2 font-mono">{a.order_number ?? "—"}</td>
                      <td className="py-1.5 pr-2 truncate max-w-[160px]">{a.customer_name ?? "—"}</td>
                      <td className="py-1.5 pr-2">{a.store_id ?? "—"}</td>
                      <td className="py-1.5 pr-2 truncate max-w-[120px]">{a.package_name ?? "—"}</td>
                      <td className="py-1.5 pr-2 text-right">{fmt(a.commission_amount ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold">
                    <td colSpan={7} className="py-2 pr-2 text-right">Total</td>
                    <td className="py-2 pr-2 text-right">{fmt(data.totals.amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <div className="text-[10px] text-muted-foreground pt-4 border-t">
          Computer-generated statement. If you spot a discrepancy, contact HitroTech operations before the month is closed.
        </div>
      </div>

      <Card className="print:hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Quick actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate({ to: "/admin/performance/$partnerId", params: { partnerId } })}>
            View 6-month performance
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate({ to: "/admin/partners/$id", params: { id: partnerId } })}>
            Edit partner
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
