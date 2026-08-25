import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { getPartner, createPartner, updatePartner, type PartnerRole } from "@/lib/partners.functions";
import { listStores } from "@/lib/stores.functions";
import { PartnerSlabsEditor } from "@/components/PartnerSlabsEditor";
import { requireWorkspaceRole } from "@/lib/route-guards";

// Format PK phone as 0XXX-XXXXXXX (11 digits)
function formatPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 4) return d;
  return `${d.slice(0, 4)}-${d.slice(4)}`;
}

// Format PK CNIC as XXXXX-XXXXXXX-X (13 digits)
function formatCnic(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

export const Route = createFileRoute("/_authenticated/admin/partners/$id")({
  head: () => ({
    meta: [
      { title: "Partner — HitroTech OrderScan" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: typeof s.returnTo === "string" ? s.returnTo : undefined,
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "manager", "accountant"] as const);
  },
  component: PartnerEdit,
});

type FormState = {
  name: string;
  phone: string;
  cnic: string;
  address: string;
  city: string;
  store_id: string;
  role: PartnerRole;
  match_keys_text: string;
  active: boolean;
  join_date: string;
  notes: string;
  invited_email: string;
};

const empty: FormState = {
  name: "",
  phone: "",
  cnic: "",
  address: "",
  city: "",
  store_id: "",
  role: "" as PartnerRole,
  match_keys_text: "",
  active: true,
  join_date: new Date().toISOString().slice(0, 10),
  notes: "",
  invited_email: "",
};

function PartnerEdit() {
  const { id } = Route.useParams();
  const { returnTo } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === "new";
  const fetchOne = useServerFn(getPartner);
  const doCreate = useServerFn(createPartner);
  const doUpdate = useServerFn(updatePartner);
  const fetchStores = useServerFn(listStores);
  const { data: stores } = useQuery({ queryKey: ["stores"], queryFn: () => fetchStores() });

  const [form, setForm] = useState<FormState>(empty);

  const { data, isLoading } = useQuery({
    queryKey: ["partner", id],
    queryFn: () => fetchOne({ data: { id } }),
    enabled: !isNew,
  });

  useEffect(() => {
    if (!isNew && data) {
      setForm({
        name: data.name ?? "",
        phone: formatPhone(data.phone ?? ""),
        cnic: formatCnic(data.cnic ?? ""),
        address: data.address ?? "",
        city: data.city ?? "",
        store_id: data.store_id ?? "",
        role: data.role as PartnerRole,
        match_keys_text: ((data.match_keys as string[] | null) ?? []).join(", "),
        active: data.active ?? true,
        join_date: data.join_date ?? new Date().toISOString().slice(0, 10),
        notes: data.notes ?? "",
        invited_email: (data as { invited_email?: string | null }).invited_email ?? "",
      });
    }
  }, [isNew, data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      if (!form.phone.trim()) throw new Error("Phone is required");
      if (!form.cnic.trim()) throw new Error("CNIC is required");
      if (!form.role) throw new Error("Role is required");
      if (!form.store_id) throw new Error("Store ID is required");
      if (form.join_date && form.join_date > new Date().toISOString().slice(0, 10)) {
        throw new Error("Join date cannot be in the future");
      }
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        cnic: form.cnic.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        store_id: form.store_id || null,
        role: form.role,
        match_keys: form.match_keys_text.split(",").map((s) => s.trim()).filter(Boolean),
        active: form.active,
        join_date: form.join_date || null,
        notes: form.notes.trim() || null,
        invited_email: form.invited_email.trim() ? form.invited_email.trim().toLowerCase() : null,
      };
      const res = isNew ? await doCreate({ data: payload }) : await doUpdate({ data: { id, ...payload } });
      if (!res.ok) throw new Error(res.error);
      return res.row;

    },
    onSuccess: () => {
      toast.success(isNew ? "Partner added" : "Partner updated");
      qc.invalidateQueries({ queryKey: ["partners"] });
      qc.invalidateQueries({ queryKey: ["partner", id] });
      if (returnTo) navigate({ to: returnTo }); else navigate({ to: "/admin/partners" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isNew && isLoading) {
    return <div className="p-6 md:p-8 max-w-3xl mx-auto text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/admin/partners" })}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{isNew ? "Add partner" : "Edit partner"}</h1>
          <p className="text-sm text-muted-foreground">Match keys let activations auto-link to this partner.</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="name">Name *</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="phone">Phone *</Label>
              <Input id="phone" inputMode="numeric" placeholder="03393333032" value={form.phone} onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })} />
            </div>
            <div>
              <Label htmlFor="cnic">CNIC *</Label>
              <Input id="cnic" inputMode="numeric" placeholder="33333-33333333" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: formatCnic(e.target.value) })} />
            </div>
            <div>
              <Label htmlFor="city">City / Location</Label>
              <Input id="city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div>
              <Label>Store ID</Label>
              {(stores?.length ?? 0) === 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start font-normal text-muted-foreground"
                  onClick={() => {
                    toast.info("Add a Store ID first, then come back to assign it.");
                    navigate({
                      to: "/admin/stores",
                      search: { returnTo: `/admin/partners/${id}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}` },
                    });
                  }}
                >
                  No stores — click to add one
                </Button>
              ) : (
                <Select value={form.store_id || undefined} onValueChange={(v) => setForm({ ...form, store_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
                  <SelectContent>
                    {(stores ?? []).map((s) => <SelectItem key={s.id} value={s.code}>{s.code}{s.label ? ` — ${s.label}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label>Role</Label>
              <Select value={form.role || undefined} onValueChange={(v) => setForm({ ...form, role: v as PartnerRole })}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="franchise_owner">Franchise Owner</SelectItem>
                  <SelectItem value="retailer">Retailer</SelectItem>
                  <SelectItem value="franchise_as_retailer">Franchise-as-Retailer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="join_date">Join date</Label>
              <Input id="join_date" type="date" max={new Date().toISOString().slice(0, 10)} value={form.join_date} onChange={(e) => setForm({ ...form, join_date: e.target.value })} />
            </div>
            <div className="flex items-end gap-3 pb-2">
              <Switch id="active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <Label htmlFor="active">Active</Label>
            </div>
          </div>

          <div>
            <Label htmlFor="match_keys">Match keys (comma-separated)</Label>
            <Input
              id="match_keys"
              value={form.match_keys_text}
              onChange={(e) => setForm({ ...form, match_keys_text: e.target.value })}
              placeholder="e.g. Ali, Ali Khan, REF-4471"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Names or references the AI extracts. Any match on employee name, reference, or branch auto-links the activation here.
            </p>
          </div>

          <div>
            <Label htmlFor="invited_email">Portal login email</Label>
            <Input
              id="invited_email"
              type="email"
              value={form.invited_email}
              onChange={(e) => setForm({ ...form, invited_email: e.target.value })}
              placeholder="partner@example.com"
            />
            <p className="text-xs text-muted-foreground mt-1">
              When the partner signs up on the login page using this exact email, they will be automatically linked and given the Partner role (read-only self-service portal).
            </p>
          </div>

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => (returnTo ? navigate({ to: returnTo }) : navigate({ to: "/admin/partners" }))}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : isNew ? "Add partner" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!isNew && form.role ? (
        <PartnerSlabsEditor partnerId={id} role={form.role} />
      ) : null}
    </div>
  );
}

