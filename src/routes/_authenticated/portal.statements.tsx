import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMyPartner } from "@/lib/portal.functions";
import { getPartnerStatement } from "@/lib/statements.functions";
import { Printer } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/statements")({
  head: () => ({ meta: [{ title: "My Statements — HitroTech" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: PortalStatements,
});

function fmtPKR(n: number) {
  return new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n || 0);
}

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function PortalStatements() {
  const fetchMe = useServerFn(getMyPartner);
  const fetchStmt = useServerFn(getPartnerStatement);
  const me = useQuery({ queryKey: ["portal", "me"], queryFn: () => fetchMe({}) });
  const [month, setMonth] = useState(currentMonthStr());
  const monthDate = `${month}-01`;
  const stmt = useQuery({
    queryKey: ["portal", "stmt", me.data?.id, monthDate],
    queryFn: () => fetchStmt({ data: { partner_id: me.data!.id, month: monthDate } }),
    enabled: !!me.data,
  });

  if (me.isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!me.data) return <div className="p-8"><Link to="/portal" className="text-primary underline">Back to portal</Link><div className="mt-4 text-sm">No partner profile linked to your account.</div></div>;

  const s = stmt.data;

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6 print:p-0">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Statements</h1>
          <p className="text-sm text-muted-foreground">Your monthly commission breakdown.</p>
        </div>
        <div className="ml-auto flex items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Month</label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" />Print / PDF</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-lg">{me.data.name}</CardTitle>
              <div className="text-xs text-muted-foreground">{me.data.role.replace(/_/g, " ")} · Store {me.data.store_id ?? "—"}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Statement for</div>
              <div className="font-medium">{new Date(monthDate).toLocaleString("default", { month: "long", year: "numeric" })}</div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {stmt.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : !s ? null : (
            <>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Activations</div><div className="text-2xl font-semibold">{s.totals.count}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Rate / activation</div><div className="text-2xl font-semibold">{fmtPKR(s.totals.rate)}</div></div>
                <div className="border rounded-lg p-3 bg-primary/5"><div className="text-xs text-muted-foreground">Total commission</div><div className="text-2xl font-semibold text-primary">{fmtPKR(s.totals.amount)}</div></div>
              </div>

              <div className="text-sm font-medium mb-2">Activations ({s.activations.length})</div>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-left px-3 py-2">Order #</th>
                      <th className="text-left px-3 py-2">Phone</th>
                      <th className="text-left px-3 py-2">Customer</th>
                      <th className="text-left px-3 py-2">Store</th>
                      <th className="text-right px-3 py-2">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.activations.map((a) => (
                      <tr key={a.id} className="border-t">
                        <td className="px-3 py-2">{a.activation_date_parsed ?? a.activation_date ?? "—"}</td>
                        <td className="px-3 py-2">{a.order_number ?? "—"}</td>
                        <td className="px-3 py-2">{a.phone_number ?? "—"}</td>
                        <td className="px-3 py-2">{a.customer_name ?? "—"}</td>
                        <td className="px-3 py-2">{a.store_id ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{fmtPKR(s.totals.rate)}</td>
                      </tr>
                    ))}
                    {s.activations.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No activations in this month.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {s.payout && (
                <div className="mt-4 text-xs text-muted-foreground">
                  Payout status: <b className="text-foreground">{s.payout.status}</b>
                  {s.payout.paid_at ? ` · paid on ${new Date(s.payout.paid_at).toLocaleDateString()}` : ""}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
