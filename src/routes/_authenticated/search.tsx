import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search as SearchIcon } from "lucide-react";

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/search")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Search — HitroTech OrderScan" },
      { name: "description", content: "Search extracted telecom orders across all batches by customer, phone, network, or status." },
      { property: "og:title", content: "Search — HitroTech OrderScan" },
      { property: "og:description", content: "Search extracted telecom orders across all batches by customer, phone, network, or status." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const navigate = useNavigate({ from: "/search" });
  const { q } = Route.useSearch();
  const [input, setInput] = useState(q);
  useEffect(() => setInput(q), [q]);

  const term = q.trim();

  const { data: results, isFetching } = useQuery({
    queryKey: ["search", term],
    enabled: term.length >= 2,
    queryFn: async () => {
      const safe = term.replace(/[%,]/g, " ");
      const cols = [
        "customer_name",
        "phone_number",
        "cnic",
        "order_number",
        "email",
        "reference",
        "branch_name",
        "employee_name",
      ];
      const or = cols.map((c) => `${c}.ilike.%${safe}%`).join(",");
      const { data, error } = await supabase
        .from("extractions")
        .select("id, batch_id, customer_name, phone_number, order_number, cnic, branch_name, current_network, status, is_duplicate, needs_review, created_at")
        .or(or)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const { data: entities } = useQuery({
    queryKey: ["search-entities", term],
    enabled: term.length >= 2,
    queryFn: async () => {
      const safe = term.replace(/[%,]/g, " ");
      const [partnerRes, storeRes] = await Promise.all([
        supabase
          .from("partners")
          .select("id, name, role, store_id, phone, cnic, city")
          .or(
            ["name", "phone", "cnic", "city", "store_id"]
              .map((c) => `${c}.ilike.%${safe}%`)
              .join(","),
          )
          .limit(20),
        supabase
          .from("stores")
          .select("id, code, label")
          .or([`code.ilike.%${safe}%`, `label.ilike.%${safe}%`].join(","))
          .limit(20),
      ]);
      return {
        partners: partnerRes.data ?? [],
        stores: storeRes.data ?? [],
      };
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    navigate({ search: { q: input } });
  }

  const partners = entities?.partners ?? [];
  const stores = entities?.stores ?? [];

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">
          Everything in one place — orders, CNIC, MSISDN, partners and stores. Press ⌘K anywhere for the quick palette.
        </p>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Order #, CNIC, MSISDN, customer, partner, store…"
            className="pl-9"
            autoFocus
          />
        </div>
        <Button type="submit">Search</Button>
      </form>

      {partners.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Partners ({partners.length})</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {partners.map((p) => (
              <Link
                key={p.id}
                to="/admin/performance/$partnerId"
                params={{ partnerId: p.id }}

                className="rounded-md border p-3 hover:bg-muted/40"
              >
                <div className="truncate font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {String(p.role).replace(/_/g, " ")}
                  {p.store_id ? ` · ${p.store_id}` : ""}
                  {p.city ? ` · ${p.city}` : ""}
                </div>
                <div className="text-xs text-muted-foreground truncate">{p.phone ?? p.cnic ?? ""}</div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {stores.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Stores ({stores.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {stores.map((s) => (
              <Link
                key={s.id}
                to="/admin/stores"
                className="rounded-md border px-3 py-2 text-sm hover:bg-muted/40"
              >
                <span className="font-medium">{s.code}</span>
                {s.label ? <span className="text-muted-foreground"> · {s.label}</span> : null}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}


      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {term.length < 2 ? "Type at least 2 characters" : isFetching ? "Searching…" : `${results?.length ?? 0} matches`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {(results?.length ?? 0) === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {term.length < 2 ? "Results will appear here." : "No extractions matched."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Customer</th>
                  <th className="text-left p-3">Phone</th>
                  <th className="text-left p-3">CNIC</th>
                  <th className="text-left p-3">Order #</th>
                  <th className="text-left p-3">Branch</th>
                  <th className="text-left p-3">Network</th>
                  <th className="text-left p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {results!.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="p-3">
                      <Link to="/batches/$id" params={{ id: r.batch_id }} className="hover:text-primary font-medium">
                        {r.customer_name || <span className="text-muted-foreground italic">—</span>}
                      </Link>
                    </td>
                    <td className="p-3">{r.phone_number || "—"}</td>
                    <td className="p-3">{r.cnic || "—"}</td>
                    <td className="p-3">{r.order_number || "—"}</td>
                    <td className="p-3">{r.branch_name || "—"}</td>
                    <td className="p-3">{r.current_network || "—"}</td>
                    <td className="p-3">
                      <span className="uppercase text-[10px] font-semibold px-2 py-0.5 rounded bg-muted">
                        {r.is_duplicate ? "DUP" : r.needs_review ? "REVIEW" : r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
