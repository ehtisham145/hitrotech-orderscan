import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listPartners, type PartnerRole } from "@/lib/partners.functions";
import { PartnerSlabsEditor } from "@/components/PartnerSlabsEditor";
import { requireWorkspaceRole } from "@/lib/route-guards";
import { PlanGate } from "@/components/PlanGate";

const ROLE_LABEL: Record<string, string> = {
  franchise_owner: "Franchise Owner",
  retailer: "Retailer",
  franchise_as_retailer: "Franchise-as-Retailer",
};

export const Route = createFileRoute("/_authenticated/admin/commissions")({
  head: () => ({
    meta: [
      { title: "Commission Slabs — HitroTech OrderScan" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "accountant"] as const);
  },
  component: () => <PlanGate feature="commissions"><CommissionsPage /></PlanGate>,
});

function CommissionsPage() {
  const fetchPartners = useServerFn(listPartners);
  const { data: partners } = useQuery({ queryKey: ["partners"], queryFn: () => fetchPartners() });
  const [partnerId, setPartnerId] = useState<string>("");
  const selectedPartner = (partners ?? []).find((p) => p.id === partnerId);

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Commission Slabs</h1>
        <p className="text-sm text-muted-foreground">
          Select a partner, then add slabs (activation ranges) and the PKR rate per activation.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Partner</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={partnerId || undefined} onValueChange={setPartnerId}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder="Select a partner…" />
            </SelectTrigger>
            <SelectContent>
              {(partners ?? []).filter((p) => p.active).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} · {ROLE_LABEL[p.role] ?? p.role} · {p.store_id ?? "—"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedPartner ? (
        <PartnerSlabsEditor partnerId={selectedPartner.id} role={selectedPartner.role as PartnerRole} />
      ) : (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Choose a partner above to configure their commission slabs.
        </div>
      )}
    </div>
  );
}
