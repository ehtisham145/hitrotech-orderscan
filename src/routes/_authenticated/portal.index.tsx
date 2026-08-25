import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getMyPartner, listMyPayouts } from "@/lib/portal.functions";
import { getPartnerStatement } from "@/lib/statements.functions";
import { FileText, TrendingUp, Wallet, CheckCircle2, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/")({
  head: () => ({ meta: [{ title: "My Dashboard — HitroTech" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: PortalHome,
});

function fmtPKR(n: number) {
  return new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n || 0);
}

function PortalHome() {
  const fetchMe = useServerFn(getMyPartner);
  const fetchPayouts = useServerFn(listMyPayouts);
  const fetchStmt = useServerFn(getPartnerStatement);

  const me = useQuery({ queryKey: ["portal", "me"], queryFn: () => fetchMe({}) });
  const payouts = useQuery({ queryKey: ["portal", "payouts"], queryFn: () => fetchPayouts({}) });

  const partnerId = me.data?.id;
  const stmt = useQuery({
    queryKey: ["portal", "stmt-current", partnerId],
    queryFn: () => fetchStmt({ data: { partner_id: partnerId! } }),
    enabled: !!partnerId,
  });

  if (me.isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  if (!me.data) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Card>
          <CardHeader><CardTitle>No partner profile linked</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Your account is not linked to a partner profile yet. Ask your manager to invite you using your account email address.
          </CardContent>
        </Card>
      </div>
    );
  }

  const totals = stmt.data?.totals;
  const slab = stmt.data?.slab;

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Hi, {me.data.name}</h1>
        <p className="text-sm text-muted-foreground">Your commission this month at a glance.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">Activations MTD</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-semibold">{totals?.count ?? 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">Current rate</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-semibold">{fmtPKR(totals?.rate ?? 0)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">Estimated commission</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-semibold text-primary">{fmtPKR(totals?.amount ?? 0)}</div></CardContent>
        </Card>
      </div>

      {slab?.to_go != null && slab.to_go > 0 && slab.next_rate ? (
        <Card>
          <CardContent className="p-4 text-sm">
            🎯 <b>{slab.to_go}</b> more activations to unlock the next slab at <b>{fmtPKR(slab.next_rate)}</b> per activation.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Link to="/portal/statements" className="block">
          <Card className="hover:shadow-md transition"><CardContent className="p-5 flex items-center gap-3">
            <FileText className="w-5 h-5 text-primary" />
            <div><div className="font-medium">Monthly statements</div><div className="text-xs text-muted-foreground">Download or share your commission breakdown</div></div>
          </CardContent></Card>
        </Link>
        <Link to="/portal/performance" className="block">
          <Card className="hover:shadow-md transition"><CardContent className="p-5 flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-primary" />
            <div><div className="font-medium">Performance history</div><div className="text-xs text-muted-foreground">Your last 6 months of activations & payouts</div></div>
          </CardContent></Card>
        </Link>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Wallet className="w-4 h-4" /> Recent payouts</CardTitle></CardHeader>
        <CardContent className="p-0">
          {payouts.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : (payouts.data ?? []).length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No payouts yet.</div>
          ) : (
            <div className="divide-y">
              {(payouts.data ?? []).slice(0, 6).map((p) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium">{new Date(p.month).toLocaleString("default", { month: "long", year: "numeric" })}</div>
                    <div className="text-xs text-muted-foreground">{p.activations_count} activations · {fmtPKR(p.rate_pkr)}/act</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="font-semibold">{fmtPKR(p.amount_pkr)}</div>
                    <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${p.status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {p.status === "paid" ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                      {p.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <Button variant="outline" asChild><Link to="/portal/statements">View all statements</Link></Button>
      </div>
    </div>
  );
}
