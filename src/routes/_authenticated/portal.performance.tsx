import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyPartner, listMyPayouts } from "@/lib/portal.functions";
import { getPartnerHistory } from "@/lib/statements.functions";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export const Route = createFileRoute("/_authenticated/portal/performance")({
  head: () => ({ meta: [{ title: "My Performance — HitroTech" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: PortalPerformance,
});

function fmtPKR(n: number) {
  return new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n || 0);
}

function PortalPerformance() {
  const fetchMe = useServerFn(getMyPartner);
  const fetchHist = useServerFn(getPartnerHistory);
  const fetchPayouts = useServerFn(listMyPayouts);
  const me = useQuery({ queryKey: ["portal", "me"], queryFn: () => fetchMe({}) });
  const hist = useQuery({
    queryKey: ["portal", "history", me.data?.id],
    queryFn: () => fetchHist({ data: { partner_id: me.data!.id, months: 6 } }),
    enabled: !!me.data,
  });
  const payouts = useQuery({ queryKey: ["portal", "payouts"], queryFn: () => fetchPayouts({}) });

  if (me.isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!me.data) return <div className="p-8"><Link to="/portal" className="text-primary underline">Back to portal</Link></div>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((hist.data as any)?.series ?? []) as Array<{ month: string; label: string; count: number; commission: number }>;
  const chartData = rows.map((r) => ({ ...r, amount: r.commission }));
  const totalAct = rows.reduce((s, r) => s + r.count, 0);
  const totalAmt = rows.reduce((s, r) => s + r.commission, 0);
  const avgAct = rows.length ? Math.round(totalAct / rows.length) : 0;

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My performance</h1>
        <p className="text-sm text-muted-foreground">Last 6 months</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="pb-1"><CardTitle className="text-xs uppercase text-muted-foreground">Total activations</CardTitle></CardHeader><CardContent><div className="text-3xl font-semibold">{totalAct}</div></CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-xs uppercase text-muted-foreground">Total commission</CardTitle></CardHeader><CardContent><div className="text-3xl font-semibold text-primary">{fmtPKR(totalAmt)}</div></CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-xs uppercase text-muted-foreground">Avg activations / month</CardTitle></CardHeader><CardContent><div className="text-3xl font-semibold">{avgAct}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Activations per month</CardTitle></CardHeader>
        <CardContent style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.3 }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }} labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }} itemStyle={{ color: "var(--popover-foreground)" }} />
              <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Commission trend</CardTitle></CardHeader>
        <CardContent style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v: number) => fmtPKR(v)} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }} labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }} itemStyle={{ color: "var(--popover-foreground)" }} />
              <Line type="monotone" dataKey="amount" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Payout history</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase">
              <tr><th className="px-4 py-2 text-left">Month</th><th className="text-right px-4 py-2">Activations</th><th className="text-right px-4 py-2">Amount</th><th className="text-left px-4 py-2">Status</th></tr>
            </thead>
            <tbody>
              {(payouts.data ?? []).map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-2">{new Date(p.month).toLocaleString("default", { month: "long", year: "numeric" })}</td>
                  <td className="px-4 py-2 text-right">{p.activations_count}</td>
                  <td className="px-4 py-2 text-right font-semibold">{fmtPKR(p.amount_pkr)}</td>
                  <td className="px-4 py-2 capitalize">{p.status}</td>
                </tr>
              ))}
              {(payouts.data ?? []).length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No payouts yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
