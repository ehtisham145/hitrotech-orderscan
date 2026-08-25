import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/ext-client";
import {
  LayoutDashboard,
  Handshake,
  Wallet,
  Trophy,
  Store,
  UserCheck2,
  AlertTriangle,
  History,
  FileBarChart,
  Upload,
  Users,
  Settings,
  Phone,
  Hash,
  FileText,
  TrendingUp,
  Search as SearchIcon,
  Package,
} from "lucide-react";

type Suggestion =
  | { kind: "partner"; id: string; name: string; role: string; store_id: string | null }
  | { kind: "store"; id: string; code: string; label: string | null }
  | { kind: "batch"; id: string; name: string; created_at: string }
  | {
      kind: "activation";
      id: string;
      phone: string | null;
      order: string | null;
      customer: string | null;
      cnic: string | null;
      store_id: string | null;
      batch_id: string;
    };

const NAV_ITEMS = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, keywords: "home overview" },
  { label: "Batches", to: "/batches", icon: FileBarChart, keywords: "imports uploads" },
  { label: "All Orders", to: "/orders", icon: FileText, keywords: "activations extractions" },
  { label: "New Import", to: "/batches/new", icon: Upload, keywords: "upload screenshots" },
  { label: "Reports", to: "/reports", icon: FileBarChart, keywords: "" },
  { label: "Partners", to: "/admin/partners", icon: Handshake, keywords: "retailers franchise" },
  { label: "Leaderboard", to: "/admin/leaderboard", icon: Trophy, keywords: "top performers" },
  { label: "Store Performance", to: "/admin/stores", icon: Store, keywords: "" },
  
  { label: "Anomalies", to: "/admin/anomalies", icon: AlertTriangle, keywords: "flags issues" },
  { label: "My Brand", to: "/admin/brand", icon: Wallet, keywords: "agency margin brand earnings operator" },
  { label: "Commissions", to: "/admin/commissions", icon: Wallet, keywords: "slabs rates" },
  { label: "Payouts", to: "/admin/payouts", icon: Wallet, keywords: "pay disburse" },
  { label: "Users", to: "/admin/users", icon: Users, keywords: "roles" },
  { label: "Settings", to: "/admin/settings", icon: Settings, keywords: "config" },
  { label: "Activity", to: "/admin/audit", icon: History, keywords: "audit log history" },
] as const;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const safe = term.replace(/[%,]/g, " ");
      const [partnerRes, actRes, storeRes, batchRes] = await Promise.all([
        supabase
          .from("partners")
          .select("id, name, role, store_id, phone, cnic")
          .or(
            [
              `name.ilike.%${safe}%`,
              `phone.ilike.%${safe}%`,
              `cnic.ilike.%${safe}%`,
              `city.ilike.%${safe}%`,
            ].join(","),
          )
          .limit(5),
        supabase
          .from("extractions")
          .select("id, phone_number, order_number, customer_name, reference, cnic, store_id, batch_id")
          .or(
            [
              `phone_number.ilike.%${safe}%`,
              `order_number.ilike.%${safe}%`,
              `customer_name.ilike.%${safe}%`,
              `reference.ilike.%${safe}%`,
              `cnic.ilike.%${safe}%`,
              `branch_name.ilike.%${safe}%`,
              `email.ilike.%${safe}%`,
            ].join(","),
          )
          .order("created_at", { ascending: false })
          .limit(6),
        supabase
          .from("stores")
          .select("id, code, label")
          .or([`code.ilike.%${safe}%`, `label.ilike.%${safe}%`].join(","))
          .limit(4),
        supabase
          .from("batches")
          .select("id, name, created_at")
          .ilike("name", `%${safe}%`)
          .order("created_at", { ascending: false })
          .limit(4),
      ]);
      if (cancelled) return;
      const list: Suggestion[] = [];
      for (const p of partnerRes.data ?? []) {
        list.push({
          kind: "partner",
          id: p.id as string,
          name: p.name as string,
          role: p.role as string,
          store_id: (p.store_id as string | null) ?? null,
        });
      }
      for (const st of storeRes.data ?? []) {
        list.push({
          kind: "store",
          id: st.id as string,
          code: st.code as string,
          label: (st.label as string | null) ?? null,
        });
      }
      for (const a of actRes.data ?? []) {
        list.push({
          kind: "activation",
          id: a.id as string,
          phone: (a.phone_number as string | null) ?? null,
          order: (a.order_number as string | null) ?? null,
          customer: (a.customer_name as string | null) ?? null,
          cnic: (a.cnic as string | null) ?? null,
          store_id: (a.store_id as string | null) ?? null,
          batch_id: a.batch_id as string,
        });
      }
      for (const b of batchRes.data ?? []) {
        list.push({
          kind: "batch",
          id: b.id as string,
          name: (b.name as string) ?? "Untitled batch",
          created_at: b.created_at as string,
        });
      }
      setSuggestions(list);
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, open]);

  function go(to: string) {
    setOpen(false);
    setQ("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    navigate({ to } as any);
  }

  const partners = suggestions.filter((s) => s.kind === "partner");
  const stores = suggestions.filter((s) => s.kind === "store");
  const activations = suggestions.filter((s) => s.kind === "activation");
  const batches = suggestions.filter((s) => s.kind === "batch");
  const term = q.trim();

  function seeAll() {
    setOpen(false);
    navigate({ to: "/search", search: { q: term } });
    setQ("");
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search orders, CNIC, MSISDN, partners, stores…  or jump to a page"
        value={q}
        onValueChange={setQ}
      />
      <CommandList>
        <CommandEmpty>
          {q.trim().length < 2 ? "Type at least 2 characters." : "Nothing matched."}
        </CommandEmpty>

        {partners.length > 0 && (
          <>
            <CommandGroup heading="Partners">
              {partners.map((p) =>
                p.kind === "partner" ? (
                  <CommandItem
                    key={"p-" + p.id}
                    value={"partner-" + p.name + "-" + p.id}
                    onSelect={() => go(`/admin/performance/${p.id}`)}
                  >
                    <TrendingUp className="w-4 h-4 mr-2 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{p.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {p.role.replace(/_/g, " ")}
                        {p.store_id ? ` · ${p.store_id}` : ""}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground">Performance</span>
                  </CommandItem>
                ) : null,
              )}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {stores.length > 0 && (
          <>
            <CommandGroup heading="Stores">
              {stores.map((st) =>
                st.kind === "store" ? (
                  <CommandItem
                    key={"s-" + st.id}
                    value={"store-" + st.code + "-" + st.id}
                    onSelect={() => go("/admin/stores")}
                  >
                    <Store className="w-4 h-4 mr-2 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{st.code}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{st.label ?? "Store"}</div>
                    </div>
                    <span className="text-[10px] text-muted-foreground">Store performance</span>
                  </CommandItem>
                ) : null,
              )}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {activations.length > 0 && (
          <>
            <CommandGroup heading="Activations">
              {activations.map((a) =>
                a.kind === "activation" ? (
                  <CommandItem
                    key={"a-" + a.id}
                    value={"activation-" + (a.phone ?? "") + "-" + (a.order ?? "") + "-" + a.id}
                    onSelect={() => go(`/batches/${a.batch_id}`)}
                  >
                    {a.phone ? <Phone className="w-4 h-4 mr-2 text-muted-foreground" /> : <Hash className="w-4 h-4 mr-2 text-muted-foreground" />}
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-mono text-xs">
                        {a.phone ?? a.order ?? "—"}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {a.customer ?? "—"}
                        {a.order && a.phone ? ` · ${a.order}` : ""}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground">Open batch</span>
                  </CommandItem>
                ) : null,
              )}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {batches.length > 0 && (
          <>
            <CommandGroup heading="Batches">
              {batches.map((b) =>
                b.kind === "batch" ? (
                  <CommandItem
                    key={"b-" + b.id}
                    value={"batch-" + b.name + "-" + b.id}
                    onSelect={() => go(`/batches/${b.id}`)}
                  >
                    <Package className="w-4 h-4 mr-2 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{b.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(b.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground">Open batch</span>
                  </CommandItem>
                ) : null,
              )}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {term.length >= 2 && (
          <>
            <CommandGroup heading="Everywhere">
              <CommandItem value={"see-all-results " + term} onSelect={seeAll}>
                <SearchIcon className="w-4 h-4 mr-2 text-muted-foreground" />
                <span>
                  Search all records for &ldquo;{term}&rdquo;
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">Enter</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Navigate">
          {NAV_ITEMS.map((n) => {
            const Icon = n.icon;
            return (
              <CommandItem
                key={n.to}
                value={n.label + " " + n.keywords}
                onSelect={() => go(n.to)}
              >
                <Icon className="w-4 h-4 mr-2 text-muted-foreground" />
                <span>{n.label}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{n.to}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
