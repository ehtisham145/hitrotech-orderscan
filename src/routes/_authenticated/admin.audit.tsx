import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/SettingsSubNav";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { History, User, Wallet, Handshake, Settings2, Users, Building2, Mail } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { EmptyState } from "@/components/EmptyState";
import { listAuditLogs } from "@/lib/reliability.functions";
import { PlanGate } from "@/components/PlanGate";

const ENTITY_META: Record<string, { label: string; icon: typeof History }> = {
  partner: { label: "Partners", icon: Handshake },
  payout: { label: "Payouts", icon: Wallet },
  commission_slab: { label: "Slabs", icon: Settings2 },
  extraction: { label: "Activations", icon: History },
  workspace: { label: "Workspace", icon: Building2 },
  workspace_member: { label: "Members", icon: Users },
  workspace_invite: { label: "Invites", icon: Mail },
};

export const Route = createFileRoute("/_authenticated/admin/audit")({
  head: () => ({
    meta: [
      { title: "Activity — HitroTech OrderScan" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
    const rs = (roles ?? []).map((r) => r.role);
    if (rs.includes("admin") || rs.includes("manager") || rs.includes("super_admin")) return;
    // Also allow workspace owner/admin/manager on their active workspace
    const { data: prof } = await supabase.from("profiles").select("active_workspace_id").eq("id", data.user.id).maybeSingle();
    const wsId = prof?.active_workspace_id;
    if (wsId) {
      const { data: mem } = await supabase.from("workspace_members").select("role").eq("workspace_id", wsId).eq("user_id", data.user.id).maybeSingle();
      if (mem && ["owner", "admin", "manager"].includes(mem.role as string)) return;
    }
    throw redirect({ to: "/dashboard" });
  },
  component: () => <PlanGate feature="audit_log"><AuditPage /></PlanGate>,
});

function AuditPage() {
  const fetchList = useServerFn(listAuditLogs);
  const [filter, setFilter] = useState<string>("all");
  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", filter],
    queryFn: () => fetchList({ data: { entity_type: filter === "all" ? undefined : filter, limit: 200 } }),
  });

  const rows = data ?? [];

  return (
    <SettingsLayout>
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity log</h1>
        <p className="text-sm text-muted-foreground">Every create, edit, and delete across partners, slabs, payouts, and workspace administration.</p>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="pt-5 flex flex-wrap gap-2 items-center">
          <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All</Button>
          {Object.entries(ENTITY_META).map(([k, m]) => {
            const Icon = m.icon;
            return (
              <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>
                <Icon className="w-3.5 h-3.5 mr-1" /> {m.label}
              </Button>
            );
          })}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : rows.length === 0 ? (
            <EmptyState icon={History} title="No activity" description="Actions on partners, slabs, and payouts show up here." />
          ) : (
            <div className="divide-y">
              {rows.map((r) => <AuditRow key={r.id} row={r} />)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </SettingsLayout>
  );
}

type Row = {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any;
  created_at: string;
  actor_email?: string | null;
};

function AuditRow({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  const meta = ENTITY_META[row.entity_type] ?? { label: row.entity_type, icon: History };
  const Icon = meta.icon;
  const verb = row.action.split(".").slice(1).join(".") || row.action;
  const verbTone =
    verb.startsWith("create") || verb.startsWith("invite_sent") || verb.startsWith("invite_accepted") ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/30"
    : verb.startsWith("delete") || verb.startsWith("invite_revoked") || verb.startsWith("member_removed") ? "text-red-600 bg-red-500/10 border-red-500/30"
    : "text-blue-600 bg-blue-500/10 border-blue-500/30";

  const changes = buildDiff(row);

  return (
    <div className="py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 text-left hover:bg-muted/40 rounded-2xl px-2 py-1 -mx-2"
      >
        <div className="w-8 h-8 shrink-0 rounded-2xl bg-muted flex items-center justify-center">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={"text-[10px] uppercase rounded-2xl " + verbTone}>{verb}</Badge>
            <span className="text-sm font-medium">{meta.label}</span>
            <span className="text-xs text-muted-foreground">
              {describeTarget(row)}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 inline-flex items-center gap-2">
            <User className="w-3 h-3" />
            {row.actor_email ?? "system"} · {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })} · {format(new Date(row.created_at), "d MMM HH:mm")}
          </div>
        </div>
      </button>
      {open && changes.length > 0 && (
        <div className="mt-2 ml-11 border-l-2 border-muted pl-3 space-y-1 text-xs">
          {changes.map((c) => (
            <div key={c.field} className="flex gap-2">
              <span className="font-mono text-muted-foreground w-32 shrink-0">{c.field}</span>
              <span className="text-red-600 line-through">{c.from}</span>
              <span className="text-muted-foreground">→</span>
              <span className="text-emerald-700 font-medium">{c.to}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function describeTarget(row: Row): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = row.details as any;
  const b = d?.after ?? d?.before ?? d ?? {};
  if (row.entity_type === "partner") return b.name ?? row.entity_id ?? "";
  if (row.entity_type === "payout") return `${b.month ?? ""} · PKR ${b.amount_pkr ?? 0}`;
  if (row.entity_type === "commission_slab") return `${b.role ?? ""} ${b.min_count ?? "?"}–${b.max_count ?? "∞"}`;
  if (row.entity_type === "workspace") {
    if (row.action === "workspace.rename") return `${d?.from ?? "?"} → ${d?.to ?? "?"}`;
    return d?.name ?? row.entity_id ?? "";
  }
  if (row.entity_type === "workspace_invite") {
    return `${d?.email ?? ""}${d?.role ? ` · ${d.role}` : ""}`;
  }
  if (row.entity_type === "workspace_member") {
    if (row.action === "workspace.member_role_updated") return `${d?.from ?? "?"} → ${d?.to ?? "?"}`;
    return d?.role ?? row.entity_id ?? "";
  }
  return row.entity_id ?? "";
}

function buildDiff(row: Row): Array<{ field: string; from: string; to: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = row.details as any;
  if (!d) return [];
  const before = d.before ?? {};
  const after = d.after ?? {};
  const skip = new Set(["id", "created_at", "updated_at", "created_by"]);
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const out: Array<{ field: string; from: string; to: string }> = [];
  for (const k of keys) {
    if (skip.has(k)) continue;
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out.push({
      field: k,
      from: a == null ? "—" : typeof a === "object" ? JSON.stringify(a) : String(a),
      to: b == null ? "—" : typeof b === "object" ? JSON.stringify(b) : String(b),
    });
  }
  return out;
}
