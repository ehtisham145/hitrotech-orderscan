import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { UserCheck2 } from "lucide-react";
import { format } from "date-fns";
import { listPartners } from "@/lib/partners.functions";
import { listUnassigned, assignExtractionToPartner } from "@/lib/commission.functions";
import { EmptyState } from "@/components/EmptyState";
import { requireWorkspaceRole } from "@/lib/route-guards";

export const Route = createFileRoute("/_authenticated/admin/unassigned")({
  head: () => ({
    meta: [
      { title: "Unassigned Activations — HitroTech OrderScan" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "manager"] as const);
  },
  component: UnassignedPage,
});

function UnassignedPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listUnassigned);
  const fetchPartners = useServerFn(listPartners);
  const doAssign = useServerFn(assignExtractionToPartner);

  const { data: rows, isLoading } = useQuery({ queryKey: ["unassigned"], queryFn: () => fetchList() });
  const { data: partners } = useQuery({ queryKey: ["partners"], queryFn: () => fetchPartners() });

  const [selection, setSelection] = useState<Record<string, string>>({});
  const [learnKey, setLearnKey] = useState<Record<string, boolean>>({});

  const assign = useMutation({
    mutationFn: async (row: { id: string; matchText: string | null }) => {
      const pid = selection[row.id];
      if (!pid) throw new Error("Pick a partner");
      const learn = learnKey[row.id] ?? true;
      return doAssign({
        data: {
          extraction_id: row.id,
          partner_id: pid,
          add_match_key: learn ? row.matchText : null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Linked to partner");
      qc.invalidateQueries({ queryKey: ["unassigned"] });
      qc.invalidateQueries({ queryKey: ["partners"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activePartners = (partners ?? []).filter((p) => p.active);

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Unassigned activations</h1>
        <p className="text-sm text-muted-foreground">
          Successful orders that couldn't be auto-matched to a partner. Pick a partner and we'll remember the reference for next time.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{rows?.length ?? 0} row{(rows?.length ?? 0) === 1 ? "" : "s"}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : (rows?.length ?? 0) === 0 ? (
            <EmptyState
              icon={UserCheck2}
              title="All caught up"
              description="Every successful activation is linked to a partner."
            />
          ) : (
            <div className="divide-y">
              {(rows ?? []).map((r) => {
                const matchText = r.employee_name || r.reference || r.branch_name || "";
                return (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">
                        {r.customer_name || "—"} <span className="text-muted-foreground">· {r.phone_number || "no phone"}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        Employee: <span className="text-foreground">{r.employee_name || "—"}</span> ·
                        Ref: <span className="text-foreground">{r.reference || "—"}</span> ·
                        Branch: <span className="text-foreground">{r.branch_name || "—"}</span> ·
                        {r.store_id || "—"} · {r.activation_date || format(new Date(r.created_at), "d MMM")}
                      </div>
                    </div>
                    <Select value={selection[r.id] ?? ""} onValueChange={(v) => setSelection((s) => ({ ...s, [r.id]: v }))}>
                      <SelectTrigger className="w-56"><SelectValue placeholder="Assign to…" /></SelectTrigger>
                      <SelectContent>
                        {activePartners.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} · {p.store_id ?? "—"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground select-none">
                      <input
                        type="checkbox"
                        checked={learnKey[r.id] ?? true}
                        onChange={(e) => setLearnKey((s) => ({ ...s, [r.id]: e.target.checked }))}
                      />
                      Learn "{matchText.slice(0, 20) || "—"}"
                    </label>
                    <Button
                      size="sm"
                      onClick={() => assign.mutate({ id: r.id, matchText: matchText || null })}
                      disabled={assign.isPending || !selection[r.id]}
                    >
                      Link
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
