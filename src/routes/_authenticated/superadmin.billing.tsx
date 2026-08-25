import { createFileRoute, redirect } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/ext-client";
import {
  getBillingSettings,
  updateBillingSettings,
  listAllBillingRequests,
  approveBillingRequest,
  rejectBillingRequest,
  listAllRefundRequests,
  decideRefundRequest,
} from "@/lib/billing.functions";
import { formatPkr } from "@/lib/plans";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format } from "date-fns";
import { Building2, Save, Receipt, Pencil, Mail, MessageCircle, Landmark, CreditCard, MapPin, CheckCircle2, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/superadmin/billing")({
  head: () => ({
    meta: [
      { title: "Billing admin — HitroTech OrderScan" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.user.id)
      .eq("role", "super_admin");
    if (!roles || roles.length === 0) throw redirect({ to: "/dashboard" });
  },
  component: SuperBillingPage,
});

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-red-500/10 text-red-700 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

function SuperBillingPage() {
  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing administration</h1>
        <p className="text-sm text-muted-foreground">Review payment requests and manage your bank details.</p>
      </div>
      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">Payment requests</TabsTrigger>
          <TabsTrigger value="refunds">Refunds</TabsTrigger>
          <TabsTrigger value="settings">Bank details</TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="mt-4"><RequestsTab /></TabsContent>
        <TabsContent value="refunds" className="mt-4"><RefundsTab /></TabsContent>
        <TabsContent value="settings" className="mt-4"><SettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function RequestsTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAllBillingRequests);
  const approveFn = useServerFn(approveBillingRequest);
  const rejectFn = useServerFn(rejectBillingRequest);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["all-billing-requests"],
    queryFn: () => listFn(),
  });

  const [notes, setNotes] = useState<Record<string, string>>({});

  const approveM = useMutation({
    mutationFn: (id: string) => approveFn({ data: { requestId: id, adminNote: notes[id] || null } }),
    onSuccess: () => {
      toast.success("Plan activated");
      qc.invalidateQueries({ queryKey: ["all-billing-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rejectM = useMutation({
    mutationFn: (id: string) => rejectFn({ data: { requestId: id, adminNote: notes[id] || null } }),
    onSuccess: () => {
      toast.success("Request rejected");
      qc.invalidateQueries({ queryKey: ["all-billing-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!rows || rows.length === 0) {
    return <Card className="p-8 text-center text-sm text-muted-foreground">No requests yet.</Card>;
  }

  return (
    <div className="space-y-3">
      {rows.map((r: any) => (
        <Card key={r.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{r.workspaces?.name ?? "Workspace"}</span>
                <Badge className={cn(STATUS_STYLE[r.status], "rounded-2xl")} variant="secondary">{r.status}</Badge>
                <Badge variant="outline" className="capitalize rounded-2xl">{r.plan_tier}</Badge>
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {formatPkr(r.amount_pkr)} · {r.months} mo · Requested by{" "}
                {r.profiles?.email ?? r.requested_by} ·{" "}
                {format(new Date(r.created_at), "MMM d, yyyy h:mm a")}
              </div>
              {r.payment_reference && (
                <div className="text-sm mt-1"><b>Ref:</b> <span className="font-mono">{r.payment_reference}</span></div>
              )}
              {r.payer_note && (
                <div className="text-sm text-muted-foreground mt-1">Note: {r.payer_note}</div>
              )}
              {r.receipt_path && <ReceiptLink path={r.receipt_path} />}
              {r.admin_note && (
                <div className="text-sm text-muted-foreground mt-1 italic">Admin: {r.admin_note}</div>
              )}
            </div>
          </div>
          {r.status === "pending" && (
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <Input
                placeholder="Admin note (optional)"
                value={notes[r.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
              />
              <Button size="sm" className="rounded-2xl" onClick={() => approveM.mutate(r.id)} disabled={approveM.isPending}>
                Approve & activate
              </Button>
              <Button size="sm" variant="outline" className="rounded-2xl" onClick={() => rejectM.mutate(r.id)} disabled={rejectM.isPending}>
                Reject
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function RefundsTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAllRefundRequests);
  const decideFn = useServerFn(decideRefundRequest);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const { data: rows, isLoading } = useQuery({
    queryKey: ["all-refund-requests"],
    queryFn: () => listFn(),
  });

  const decideM = useMutation({
    mutationFn: (v: { id: string; status: "approved" | "rejected" | "paid" }) =>
      decideFn({ data: { requestId: v.id, status: v.status, adminNote: notes[v.id] || null } }),
    onSuccess: () => {
      toast.success("Refund updated");
      qc.invalidateQueries({ queryKey: ["all-refund-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!rows || rows.length === 0) {
    return <Card className="p-8 text-center text-sm text-muted-foreground">No refund requests.</Card>;
  }

  return (
    <div className="space-y-3">
      {rows.map((r: any) => (
        <Card key={r.id} className="p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{r.workspaces?.name ?? "Workspace"}</span>
            <Badge className={cn(STATUS_STYLE[r.status], "rounded-2xl")} variant="secondary">{r.status}</Badge>
            {r.plan_tier && <Badge variant="outline" className="capitalize rounded-2xl">{r.plan_tier}</Badge>}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {formatPkr(r.amount_pkr)} · {r.unused_days} unused day(s) ·{" "}
            {format(new Date(r.created_at), "MMM d, yyyy h:mm a")}
          </div>
          {r.bank_details && (
            <div className="text-sm mt-1 whitespace-pre-wrap"><b>Send to:</b> {r.bank_details}</div>
          )}
          {r.reason && <div className="text-sm text-muted-foreground mt-1">Reason: {r.reason}</div>}
          {r.admin_note && (
            <div className="text-sm text-muted-foreground mt-1 italic">Admin: {r.admin_note}</div>
          )}
          {r.status === "pending" && (
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
              <Input
                placeholder="Admin note (optional)"
                value={notes[r.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
              />
              <Button size="sm" onClick={() => decideM.mutate({ id: r.id, status: "approved" })} disabled={decideM.isPending}>
                Approve
              </Button>
              <Button size="sm" variant="secondary" onClick={() => decideM.mutate({ id: r.id, status: "paid" })} disabled={decideM.isPending}>
                Mark paid
              </Button>
              <Button size="sm" variant="outline" onClick={() => decideM.mutate({ id: r.id, status: "rejected" })} disabled={decideM.isPending}>
                Reject
              </Button>
            </div>
          )}
          {r.status === "approved" && (
            <div className="mt-3">
              <Button size="sm" onClick={() => decideM.mutate({ id: r.id, status: "paid" })} disabled={decideM.isPending}>
                Mark paid
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function SettingsTab() {
  const qc = useQueryClient();
  const getFn = useServerFn(getBillingSettings);
  const updateFn = useServerFn(updateBillingSettings);
  const { data, isLoading } = useQuery({ queryKey: ["billing-settings"], queryFn: () => getFn() });
  const [isEditing, setIsEditing] = useState(false);

  const [form, setForm] = useState({
    bank_name: "Meezan Bank",
    account_title: "",
    account_number: "",
    iban: "",
    branch: "",
    branch_code: "",
    instructions: "",
    contact_email: "",
    contact_whatsapp: "",
  });

  useEffect(() => {
    if (data) {
      setForm({
        bank_name: data.bank_name ?? "Meezan Bank",
        account_title: data.account_title ?? "",
        account_number: data.account_number ?? "",
        iban: data.iban ?? "",
        branch: data.branch ?? "",
        branch_code: data.branch_code ?? "",
        instructions: data.instructions ?? "",
        contact_email: data.contact_email ?? "",
        contact_whatsapp: data.contact_whatsapp ?? "",
      });
    }
  }, [data]);

  const saveM = useMutation({
    mutationFn: () => updateFn({ data: form }),
    onSuccess: (saved) => {
      qc.setQueryData(["billing-settings"], saved);
      setIsEditing(false);
      toast.success("Bank details saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bind = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value })),
  });

  const resetForm = () => {
    if (data) {
      setForm({
        bank_name: data.bank_name ?? "Meezan Bank",
        account_title: data.account_title ?? "",
        account_number: data.account_number ?? "",
        iban: data.iban ?? "",
        branch: data.branch ?? "",
        branch_code: data.branch_code ?? "",
        instructions: data.instructions ?? "",
        contact_email: data.contact_email ?? "",
        contact_whatsapp: data.contact_whatsapp ?? "",
      });
    }
    setIsEditing(false);
  };

  if (isLoading) {
    return <Card className="p-8 text-sm text-muted-foreground">Loading bank details…</Card>;
  }

  const hasSavedDetails = Boolean(data?.account_title || data?.account_number || data?.iban);

  if (data && hasSavedDetails && !isEditing) {
    return (
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Building2 className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Customer payment account</h2>
                <Badge variant="secondary" className="gap-1 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" /> Active
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">These details are shown to customers during payment.</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => setIsEditing(true)}>
            <Pencil className="mr-1.5 size-4" /> Edit details
          </Button>
        </div>

        <div className="grid gap-x-10 gap-y-7 p-6 md:grid-cols-2">
          <Detail icon={Landmark} label="Bank" value={data.bank_name} />
          <Detail icon={Building2} label="Account title" value={data.account_title} />
          <Detail icon={CreditCard} label="Account number" value={data.account_number} mono />
          <Detail icon={CreditCard} label="IBAN" value={data.iban} mono />
          <Detail icon={MapPin} label="Branch" value={[data.branch, data.branch_code].filter(Boolean).join(" · ")} />
          <Detail icon={Mail} label="Contact email" value={data.contact_email} />
          <Detail icon={MessageCircle} label="WhatsApp" value={data.contact_whatsapp} />
        </div>

        {data.instructions && (
          <div className="border-t border-border bg-muted/30 px-6 py-5">
            <p className="text-xs font-medium uppercase text-muted-foreground">Payment instructions</p>
            <p className="mt-2 text-sm leading-6">{data.instructions}</p>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          <div>
            <h2 className="font-semibold">{hasSavedDetails ? "Edit bank details" : "Add bank details"}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Enter the payment information customers should use.</p>
          </div>
        </div>
        {hasSavedDetails && (
          <Button variant="ghost" size="icon" onClick={resetForm} aria-label="Cancel editing">
            <X className="size-4" />
          </Button>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Bank name"><Input {...bind("bank_name")} /></Field>
        <Field label="Account title"><Input {...bind("account_title")} placeholder="HitroTech Telecom" /></Field>
        <Field label="Account number"><Input {...bind("account_number")} /></Field>
        <Field label="IBAN"><Input {...bind("iban")} placeholder="PK00 MEZN 0000 0000 0000 0000" /></Field>
        <Field label="Branch"><Input {...bind("branch")} /></Field>
        <Field label="Branch code"><Input {...bind("branch_code")} /></Field>
        <Field label="Contact email"><Input {...bind("contact_email")} type="email" /></Field>
        <Field label="WhatsApp number"><Input {...bind("contact_whatsapp")} placeholder="+92 300 1234567" /></Field>
      </div>
      <Field label="Instructions shown after transfer">
        <Textarea rows={3} {...bind("instructions")} />
      </Field>
      <div className="flex justify-end">
        {hasSavedDetails && (
          <Button variant="ghost" className="mr-2" onClick={resetForm} disabled={saveM.isPending}>Cancel</Button>
        )}
        <Button onClick={() => saveM.mutate()} disabled={saveM.isPending}>
          <Save className="w-4 h-4 mr-1.5" />
          {saveM.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </Card>
  );
}

function Detail({ icon: Icon, label, value, mono = false }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 break-words text-sm font-medium ${mono ? "font-mono" : ""}`}>{value || "Not provided"}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}


function ReceiptLink({ path }: { path: string }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    const { data, error } = await supabase.storage
      .from("payment-proofs")
      .createSignedUrl(path, 300);
    setBusy(false);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Could not open receipt");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  return (
    <button
      onClick={open}
      disabled={busy}
      className="mt-1 inline-flex items-center gap-1.5 text-sm text-primary hover:underline disabled:opacity-60"
    >
      <Receipt className="w-3.5 h-3.5" />
      {busy ? "Opening…" : "View payment receipt"}
    </button>
  );
}
