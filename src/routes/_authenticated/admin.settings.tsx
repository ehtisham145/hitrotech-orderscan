import { createFileRoute, redirect } from "@tanstack/react-router";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getNotificationPrefs, updateNotificationPrefs, type NotificationPrefs } from "@/lib/notifications.functions";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, KeyRound, Download, User as UserIcon, Info, BarChart3, Bell, ShieldAlert, LogOut, Palette, Lock, Activity, Building2, Users, Sun, Moon, Monitor, ShieldCheck, Upload, ExternalLink, Mail, Trash2, LifeBuoy, RefreshCw, Sparkles } from "lucide-react";
import { RecoveryCodesDialog } from "@/components/RecoveryCodesDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { requireWorkspaceRole } from "@/lib/route-guards";
import { SettingsLayout } from "@/components/SettingsSubNav";
import { useWorkspace } from "@/components/WorkspaceContext";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  head: () => ({
    meta: [
      { title: "Settings — HitroTech OrderScan" },
      { name: "description", content: "Manage your profile, password, and export data." },
      { property: "og:title", content: "Settings — HitroTech OrderScan" },
      { property: "og:description", content: "Manage your profile, password, and export data." },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "manager"] as const);
  },
  component: AdminSettings,
});

async function callOtpHandler(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("otp-handler", { body: payload });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = await ctx.json();
        if (body?.error) throw new Error(body.error);
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
      }
    }
    throw new Error(error.message || "Request failed");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function getPasswordIssue(password: string) {
  if (password.length < 12) return "Password must be at least 12 characters";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return "Use uppercase, lowercase, a number, and a symbol";
  }
  return null;
}

function AdminSettings() {
  return (
    <SettingsLayout>
      <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your personal account, security, and preferences.
        </p>
      </div>

      <ProfileCard />
      <AppearanceCard />
      <WorkspaceBrandingCard />
      <TeamRolesCard />
      <ExportCard />
      <StatsCard />
      <TwoFactorCard />
      <RecoveryCodesCard />
      <NotificationsCard />
      <PasswordCard />
      <SessionCard />
      <ActivityCard />


      
    </div>
    </SettingsLayout>
  );
}

/* ---------------- Profile ---------------- */

function ProfileCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings", "me"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in");
      const { data: p } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .eq("id", uid)
        .maybeSingle();
      return { id: uid, email: u.user?.email ?? "", full_name: p?.full_name ?? "" };
    },
  });

  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = name ?? data?.full_name ?? "";

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: value.trim() || null })
        .eq("id", data.id);
      if (error) throw error;
      toast.success("Profile updated");
      qc.invalidateQueries({ queryKey: ["settings", "me"] });
      setName(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserIcon className="w-4 h-4" /> Profile
        </CardTitle>
        <p className="text-xs text-muted-foreground">Your account details.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={data?.email ?? ""} disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fullname">Full name</Label>
              <Input
                id="fullname"
                placeholder="Your name"
                value={value}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex justify-end">
              <Button
                onClick={save}
                disabled={saving || name === null || value.trim() === (data?.full_name ?? "")}
              >
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Password ---------------- */

function PasswordCard() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"idle" | "verify">("idle");
  const [busy, setBusy] = useState(false);

  function updateCode(value: string) {
    setCode(value.replace(/\D/g, "").slice(0, 6));
  }

  async function submit() {
    const issue = getPasswordIssue(pw);
    if (issue) return toast.error(issue);
    if (pw !== pw2) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("Not signed in");
      if (step === "idle") {
        await callOtpHandler({ action: "send-password-change", email: user.email });
        toast.success("We sent a password change code to your email");
        setStep("verify");
        return;
      }
      await callOtpHandler({ action: "verify-password-change", email: user.email, code: code.trim(), newPassword: pw });
      toast.success("Password updated");
      setPw("");
      setPw2("");
      setCode("");
      setStep("idle");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="w-4 h-4" /> Password
        </CardTitle>
        <p className="text-xs text-muted-foreground">Change the password for your account.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pw">New password</Label>
          <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 12 characters" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw2">Confirm new password</Label>
          <Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        {step === "verify" ? (
          <div className="space-y-1.5">
            <Label htmlFor="pw-code">Email code</Label>
            <Input id="pw-code" value={code} onChange={(e) => updateCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="123456" />
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          {step === "verify" ? (
            <Button variant="ghost" onClick={() => { setStep("idle"); setCode(""); }} disabled={busy}>
              Cancel
            </Button>
          ) : null}
          <Button onClick={submit} disabled={busy || !pw || !pw2 || (step === "verify" && code.length !== 6)}>
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
            {step === "verify" ? "Confirm password" : "Update password"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Data export ---------------- */

export function ExportCard() {
  const [busy, setBusy] = useState(false);

  async function exportCsv() {
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("extractions")
        .select("order_number, customer_name, phone_number, current_network, store_id, branch_name, employee_name, activation_date, order_status, plan_price, commission_amount, is_duplicate, status, created_at")
        .order("created_at", { ascending: false })
        .limit(50000);
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === 0) {
        toast.info("No data to export");
        return;
      }
      const headers = Object.keys(rows[0]);
      const escape = (v: unknown) => {
        if (v === null || v === undefined) return "";
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [
        headers.join(","),
        ...rows.map((r) => headers.map((h) => escape((r as Record<string, unknown>)[h])).join(",")),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `orderscan-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${rows.length} rows`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Download className="w-4 h-4" /> Data export
        </CardTitle>
        <p className="text-xs text-muted-foreground">Download all activations as a CSV file (up to 50,000 rows).</p>
      </CardHeader>
      <CardContent>
        <Button onClick={exportCsv} disabled={busy} variant="outline">
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
          Export activations (CSV)
        </Button>
      </CardContent>
    </Card>
  );
}


/* ---------------- Stats ---------------- */

export function StatsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["settings", "stats"],
    queryFn: async () => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthIso = monthStart.toISOString();

      const [ext, extMonth, batches, users, partners, dupes] = await Promise.all([
        supabase.from("extractions").select("*", { count: "exact", head: true }),
        supabase.from("extractions").select("*", { count: "exact", head: true }).gte("created_at", monthIso),
        supabase.from("batches").select("*", { count: "exact", head: true }),
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("partners").select("*", { count: "exact", head: true }).eq("active", true),
        supabase.from("extractions").select("*", { count: "exact", head: true }).eq("is_duplicate", true),
      ]);
      return {
        total: ext.count ?? 0,
        month: extMonth.count ?? 0,
        batches: batches.count ?? 0,
        users: users.count ?? 0,
        partners: partners.count ?? 0,
        duplicates: dupes.count ?? 0,
      };
    },
  });

  const items = [
    { label: "Total activations", value: data?.total },
    { label: "This month", value: data?.month },
    { label: "Batches", value: data?.batches },
    { label: "Users", value: data?.users },
    { label: "Active partners", value: data?.partners },
    { label: "Duplicates", value: data?.duplicates },
  ];

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="w-4 h-4" /> System overview
        </CardTitle>
        <p className="text-xs text-muted-foreground">Live counts across your workspace.</p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {items.map((it) => (
            <div key={it.label} className="rounded-2xl border p-3">
              <div className="text-xs text-muted-foreground">{it.label}</div>
              <div className="text-xl font-semibold tabular-nums mt-0.5">
                {isLoading ? <Skeleton className="h-6 w-16" /> : (it.value ?? 0).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Notification preferences ---------------- */

function NotificationsCard() {
  const qc = useQueryClient();
  const getPrefs = useServerFn(getNotificationPrefs);
  const setPrefs = useServerFn(updateNotificationPrefs);

  const { data, isLoading } = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: () => getPrefs(),
    staleTime: 60_000,
  });

  const updateM = useMutation({
    mutationFn: (patch: Partial<NotificationPrefs>) => setPrefs({ data: patch }),
    onSuccess: (next) => {
      qc.setQueryData(["notification-prefs"], next);
      toast.success("Preference saved");
    },
    onError: (e: Error) => toast.error(e.message ?? "Could not save preference"),
  });

  const prefs: NotificationPrefs = data ?? { emailDigest: false, anomalyAlerts: true, batchComplete: true };

  const rows: { key: keyof NotificationPrefs; title: string; desc: string; comingSoon?: boolean }[] = [
    { key: "emailDigest", title: "Weekly email digest", desc: "Get a summary of activations every Monday.", comingSoon: true },
    { key: "anomalyAlerts", title: "Anomaly alerts", desc: "Notify when new anomalies are detected in imports." },
    { key: "batchComplete", title: "Batch completion", desc: "Notify when a batch finishes processing." },
  ];

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="w-4 h-4" /> Notifications
        </CardTitle>
        <p className="text-xs text-muted-foreground">Control which alerts you receive.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          rows.map((r, i) => (
            <div key={r.key}>
              {i > 0 && <Separator className="mb-4" />}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2">
                    {r.title}
                    {r.comingSoon && (
                      <Badge variant="secondary" className="text-[9px] uppercase tracking-wider">Coming soon</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.desc}</div>
                </div>
                <Switch
                  checked={prefs[r.key]}
                  disabled={updateM.isPending || r.comingSoon}
                  onCheckedChange={(v) => updateM.mutate({ [r.key]: v } as Partial<NotificationPrefs>)}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}


/* ---------------- Session ---------------- */

function SessionCard() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function signOutEverywhere() {
    if (!(await confirmDialog({ title: "Sign out everywhere?", description: "This will sign out of this account on all devices.", confirmLabel: "Sign out", destructive: true }))) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) throw error;
      toast.success("Signed out on all devices");
      navigate({ to: "/auth" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sign out");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" /> Session & security
        </CardTitle>
        <p className="text-xs text-muted-foreground">Sign out everywhere if you suspect your account is compromised.</p>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium">Active session</span>
            <Badge variant="secondary" className="text-[10px]">This device</Badge>
          </div>
          <div className="text-xs text-muted-foreground">Signing out globally revokes all other sessions.</div>
        </div>
        <Button onClick={signOutEverywhere} disabled={busy} variant="destructive">
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LogOut className="w-4 h-4 mr-2" />}
          Sign out all
        </Button>
      </CardContent>
    </Card>
  );
}


/* ---------------- Locked months ---------------- */

export function LockedMonthsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["settings", "month-locks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("month_locks")
        .select("month, locked_at")
        .order("month", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Lock className="w-4 h-4" /> Locked months
        </CardTitle>
        <p className="text-xs text-muted-foreground">Commission months that are read-only. Manage locks from Commissions.</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : (data?.length ?? 0) === 0 ? (
          <div className="text-xs text-muted-foreground">No months are locked.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data!.map((m) => {
              const dt = new Date(m.month as string);
              const label = dt.toLocaleDateString(undefined, { month: "short", year: "numeric" });
              return (
                <Badge key={String(m.month)} variant="secondary" className="gap-1">
                  <Lock className="w-3 h-3" /> {label}
                </Badge>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Recent activity ---------------- */

function ActivityCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["settings", "activity"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action, entity_type, created_at")
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data ?? [];
    },
  });

  function timeAgo(iso: string) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="w-4 h-4" /> Recent activity
        </CardTitle>
        <p className="text-xs text-muted-foreground">The last few changes across the workspace.</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : (data?.length ?? 0) === 0 ? (
          <div className="text-xs text-muted-foreground">No activity yet.</div>
        ) : (
          <div className="divide-y border rounded-2xl">
            {data!.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-mono text-xs">{a.action}</div>
                  <div className="text-xs text-muted-foreground">{a.entity_type}</div>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(a.created_at as string)}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Workspace branding ---------------- */

const TIMEZONES = ["Asia/Karachi", "Asia/Dubai", "Asia/Kolkata", "Europe/London", "America/New_York", "UTC"];
const LOCALES = [
  { v: "en-PK", label: "English (Pakistan)" },
  { v: "en-US", label: "English (US)" },
  { v: "en-GB", label: "English (UK)" },
  { v: "ur-PK", label: "Urdu (Pakistan)" },
];

export function WorkspaceBrandingCard() {
  const qc = useQueryClient();
  const { workspace: activeWs } = useWorkspace();
  const { data, isLoading } = useQuery({
    queryKey: ["settings", "workspace-branding", activeWs?.id],
    queryFn: async () => {
      const wsId = activeWs?.id;
      if (!wsId) return null;
      const { data: ws } = await supabase
        .from("workspaces")
        .select("id, name, logo_url, timezone, locale")
        .eq("id", wsId)
        .maybeSingle();
      
      const { data: { user } } = await supabase.auth.getUser();
      const { data: member } = await supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", wsId)
        .eq("user_id", user?.id || "")
        .maybeSingle();
      return { ws: ws as { id: string; name: string; logo_url: string | null; timezone: string; locale: string } | null, role: (member as { role?: string } | null)?.role ?? null };
    },
    enabled: !!activeWs?.id,
  });

  const canEdit = data?.role === "owner" || data?.role === "admin";
  const [name, setName] = useState<string | null>(null);
  const [tz, setTz] = useState<string | null>(null);
  const [locale, setLocale] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [logoSignedUrl, setLogoSignedUrl] = useState<string | null>(null);

  const ws = data?.ws;
  const currentName = name ?? ws?.name ?? "";
  const currentTz = tz ?? ws?.timezone ?? "Asia/Karachi";
  const currentLocale = locale ?? ws?.locale ?? "en-PK";

  useEffect(() => {
    (async () => {
      if (!ws?.logo_url) { setLogoSignedUrl(null); return; }
      const { data: signed } = await supabase.storage.from("workspace-logos").createSignedUrl(ws.logo_url, 3600);
      setLogoSignedUrl(signed?.signedUrl ?? null);
    })();
  }, [ws?.logo_url]);

  async function save() {
    if (!ws) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("workspaces")
        .update({ name: currentName.trim(), timezone: currentTz, locale: currentLocale })
        .eq("id", ws.id);
      if (error) throw error;
      toast.success("Workspace updated");
      qc.invalidateQueries({ queryKey: ["settings", "workspace-branding"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!ws) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("Logo must be under 2 MB"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${ws.id}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("workspace-logos").upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase.from("workspaces").update({ logo_url: path }).eq("id", ws.id);
      if (dbErr) throw dbErr;
      toast.success("Logo uploaded");
      qc.invalidateQueries({ queryKey: ["settings", "workspace-branding"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (isLoading) {
    return <Card className="rounded-2xl"><CardContent className="p-6"><Skeleton className="h-32 w-full" /></CardContent></Card>;
  }
  if (!ws) return null;

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="w-4 h-4" /> Workspace branding
        </CardTitle>
        <p className="text-xs text-muted-foreground">Logo, display name, timezone and locale used across exports and emails.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl border bg-muted overflow-hidden flex items-center justify-center">
            {logoSignedUrl ? (
              <img src={logoSignedUrl} alt="Workspace logo" className="w-full h-full object-cover" />
            ) : (
              <Building2 className="w-6 h-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1">
            <Label className="text-xs">Logo</Label>
            <div className="flex items-center gap-2 mt-1">
              <label className={`inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-2xl border cursor-pointer hover:bg-accent ${!canEdit || uploading ? "opacity-50 pointer-events-none" : ""}`}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Upload
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={!canEdit || uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadLogo(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <span className="text-xs text-muted-foreground">PNG/JPG, up to 2 MB</span>
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-1.5">
          <Label>Display name</Label>
          <Input value={currentName} onChange={(e) => setName(e.target.value)} disabled={!canEdit} maxLength={80} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Timezone</Label>
            <select
              value={currentTz}
              onChange={(e) => setTz(e.target.value)}
              disabled={!canEdit}
              className="w-full h-9 rounded-2xl border bg-background px-3 text-sm"
            >
              {TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Default locale</Label>
            <select
              value={currentLocale}
              onChange={(e) => setLocale(e.target.value)}
              disabled={!canEdit}
              className="w-full h-9 rounded-2xl border bg-background px-3 text-sm"
            >
              {LOCALES.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
            </select>
          </div>
        </div>

        {canEdit ? (
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save changes
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Only workspace owners and admins can edit branding.</p>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Team & roles summary ---------------- */

export function TeamRolesCard() {
  const { isSuperAdmin, isImpersonating, workspace: activeWs } = useWorkspace();
  const { data, isLoading } = useQuery({
    queryKey: ["settings", "team-summary", activeWs?.id],
    queryFn: async () => {
      const wsId = activeWs?.id;
      if (!wsId) return null;
      const [members, invites, ws] = await Promise.all([
        supabase.from("workspace_members").select("role").eq("workspace_id", wsId),
        supabase.from("workspace_invites").select("*", { count: "exact", head: true }).eq("workspace_id", wsId).is("accepted_at", null).gt("expires_at", new Date().toISOString()),
        supabase.from("workspaces").select("seat_limit, plan_tier").eq("id", wsId).maybeSingle(),
      ]);
      const roles = (members.data ?? []) as { role: string }[];
      const counts: Record<string, number> = {};
      for (const r of roles) counts[r.role] = (counts[r.role] ?? 0) + 1;
      return {
        total: roles.length,
        pending: invites.count ?? 0,
        seatLimit: (ws.data as { seat_limit?: number; plan_tier?: string } | null)?.seat_limit ?? 0,
        planTier: (ws.data as { plan_tier?: string } | null)?.plan_tier ?? "free",
        counts,
      };
    },
    enabled: !!activeWs?.id,
  });

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-4 h-4" /> Billing & Plan
        </CardTitle>
        <p className="text-xs text-muted-foreground">Active subscription and usage for this workspace.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !data ? (
          <div className="text-xs text-muted-foreground">No workspace found.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-2xl border p-3 flex flex-col justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Current Plan</div>
                  <div className="text-xl font-bold uppercase mt-1 flex items-center gap-2">
                    {data.planTier === "enterprise" && isSuperAdmin ? "Enterprise" : data.planTier}
                    {isSuperAdmin && !isImpersonating && (
                      <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 text-[9px] h-4 rounded-2xl">
                        Super Admin View
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Seat Usage</div>
                <div className="text-xl font-bold tabular-nums mt-1">
                  {data.total} / {data.seatLimit || "∞"}
                </div>
              </div>
              <div className="rounded-2xl border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Pending Invites</div>
                <div className="text-xl font-bold tabular-nums mt-1">{data.pending}</div>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-1.5 pt-1">
              {Object.entries(data.counts).map(([role, n]) => (
                <Badge key={role} variant="secondary" className="text-[10px] font-medium rounded-2xl px-2">
                  {role.toUpperCase()}: {n}
                </Badge>
              ))}
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-2">
              <Button asChild className="gradient-brand text-white border-none rounded-2xl text-xs h-9 px-4">
                <Link to="/onboarding/plan">
                  <Sparkles className="w-3.5 h-3.5 mr-2" />
                  Manage plans & billing
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="rounded-2xl text-xs h-9">
                <Link to="/admin/workspace">
                  <Users className="w-3.5 h-3.5 mr-2" />
                  Manage members
                </Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Appearance ---------------- */

type Theme = "light" | "dark" | "system";
type Density = "comfortable" | "compact";
const THEME_KEY = "orderscan.theme";
const DENSITY_KEY = "orderscan.density";

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  root.classList.toggle("dark", resolved === "dark");
}

function applyDensity(density: Density) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-density", density);
}

function AppearanceCard() {
  const [theme, setTheme] = useState<Theme>("system");
  const [density, setDensity] = useState<Density>("comfortable");

  useEffect(() => {
    try {
      const t = (localStorage.getItem(THEME_KEY) as Theme | null) || "system";
      const d = (localStorage.getItem(DENSITY_KEY) as Density | null) || "comfortable";
      setTheme(t);
      setDensity(d);
      applyTheme(t);
      applyDensity(d);
    } catch { /* ignore */ }
  }, []);

  function saveTheme(t: Theme) {
    setTheme(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
    applyTheme(t);
    toast.success("Theme updated");
  }

  function saveDensity(d: Density) {
    setDensity(d);
    try { localStorage.setItem(DENSITY_KEY, d); } catch { /* ignore */ }
    applyDensity(d);
    toast.success("Density updated");
  }

  const themes: { v: Theme; icon: typeof Sun; label: string }[] = [
    { v: "light", icon: Sun, label: "Light" },
    { v: "dark", icon: Moon, label: "Dark" },
    { v: "system", icon: Monitor, label: "System" },
  ];

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Palette className="w-4 h-4" /> Appearance
        </CardTitle>
        <p className="text-xs text-muted-foreground">Theme and interface density (saved on this device).</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Theme</Label>
          <div className="flex flex-wrap gap-2">
            {themes.map(({ v, icon: Icon, label }) => (
              <Button key={v} size="sm" variant={theme === v ? "default" : "outline"} onClick={() => saveTheme(v)}>
                <Icon className="w-4 h-4 mr-1.5" /> {label}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Two-factor authentication ---------------- */

type ActiveMethod = "totp" | "email" | null;

function LockedPanel({ activeLabel }: { activeLabel: string }) {
  return (
    <div className="rounded-2xl border border-dashed p-4 text-sm">
      <div className="font-medium">Unavailable while {activeLabel} is enabled</div>
      <div className="text-xs text-muted-foreground mt-1">
        You can only use one second factor at a time. Disable {activeLabel} first to switch methods.
      </div>
    </div>
  );
}

function activeLabelFor(m: ActiveMethod): string {
  if (m === "totp") return "Authenticator";
  if (m === "email") return "Email code";
  return "";
}

function TwoFactorCard() {
  const { data: mfa } = useQuery({
    queryKey: ["settings", "mfa-factors"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data;
    },
  });
  const { data: profile } = useQuery({
    queryKey: ["settings", "email-2fa"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase.from("profiles").select("email, email_2fa_enabled").eq("id", user.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const hasTotp = !!mfa?.totp?.[0];
  const hasEmail = !!profile?.email_2fa_enabled;
  const active: ActiveMethod = hasTotp ? "totp" : hasEmail ? "email" : null;

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> Two-factor authentication
        </CardTitle>
        <p className="text-xs text-muted-foreground">Choose one second factor. Enabling one locks the other until it's disabled.</p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={active ?? "totp"} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="totp" className="text-xs gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Authenticator</TabsTrigger>
            <TabsTrigger value="email" className="text-xs gap-1"><Mail className="w-3.5 h-3.5" /> Email code</TabsTrigger>
          </TabsList>
          <TabsContent value="totp" className="pt-4">
            {active && active !== "totp" ? <LockedPanel activeLabel={activeLabelFor(active)} /> : <TotpPanel />}
          </TabsContent>
          <TabsContent value="email" className="pt-4">
            {active && active !== "email" ? <LockedPanel activeLabel={activeLabelFor(active)} /> : <EmailOtpPanel />}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/* --- TOTP (Authenticator app) --- */

function TotpPanel() {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["settings", "mfa-factors"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data;
    },
  });

  const verifiedTotp = data?.totp?.[0] ?? null;
  const unverifiedTotp = (data?.all ?? []).find((f) => f.factor_type === "totp" && f.status !== "verified") ?? null;

  const [enrolling, setEnrolling] = useState(false);
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function startEnroll() {
    setEnrolling(true);
    try {
      if (unverifiedTotp) await supabase.auth.mfa.unenroll({ factorId: unverifiedTotp.id });
      const { data: e, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      setEnrollment({ id: e.id, qr: e.totp.qr_code, secret: e.totp.secret });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start enrollment");
    } finally {
      setEnrolling(false);
    }
  }

  async function verify() {
    if (!enrollment) return;
    setVerifying(true);
    try {
      const { data: c, error: cErr } = await supabase.auth.mfa.challenge({ factorId: enrollment.id });
      if (cErr) throw cErr;
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId: enrollment.id, challengeId: c.id, code: code.trim() });
      if (vErr) throw vErr;
      toast.success("Authenticator enabled");
      setEnrollment(null); setCode("");
      qc.invalidateQueries({ queryKey: ["settings", "mfa-factors"] });
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setVerifying(false);
    }
  }

  async function disable() {
    if (!verifiedTotp) return;
    if (!(await confirmDialog({ title: "Disable authenticator 2FA?", description: "You'll no longer need a code from your authenticator app to sign in.", confirmLabel: "Disable", destructive: true }))) return;
    setRemoving(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: verifiedTotp.id });
      if (error) throw error;
      toast.success("Authenticator disabled");
      qc.invalidateQueries({ queryKey: ["settings", "mfa-factors"] });
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not disable");
    } finally {
      setRemoving(false);
    }
  }

  if (isLoading) return <Skeleton className="h-10 w-full" />;

  if (verifiedTotp) {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm">
          <div className="flex items-center gap-2"><span className="font-medium">Enabled</span><Badge className="text-[10px]" variant="secondary">TOTP</Badge></div>
          <div className="text-xs text-muted-foreground">Enrolled {verifiedTotp.created_at ? new Date(verifiedTotp.created_at).toLocaleDateString() : ""}</div>
        </div>
        <Button variant="destructive" size="sm" onClick={disable} disabled={removing}>
          {removing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Disable
        </Button>
      </div>
    );
  }

  if (enrollment) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Scan with Google Authenticator, 1Password, or Authy, then enter the 6-digit code.</p>
        <div className="flex items-start gap-4 flex-wrap">
          <img src={enrollment.qr} alt="TOTP QR code" className="w-40 h-40 border rounded-2xl bg-white p-2" />
          <div className="flex-1 min-w-[200px] space-y-2">
            <div>
              <Label className="text-xs">Manual secret</Label>
              <div className="font-mono text-xs bg-muted rounded-2xl px-2 py-1 mt-1 break-all">{enrollment.secret}</div>
            </div>
            <div>
              <Label className="text-xs">6-digit code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" inputMode="numeric" maxLength={6} className="mt-1" />
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={verify} disabled={verifying || code.length !== 6}>
            {verifying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}Verify & enable
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setEnrollment(null); setCode(""); }}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm">
        <div className="font-medium">Not enabled</div>
        <div className="text-xs text-muted-foreground">Use an authenticator app for offline 6-digit codes. Most secure free option.</div>
      </div>
      <Button size="sm" onClick={startEnroll} disabled={enrolling}>
        {enrolling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}Enable
      </Button>
    </div>
  );
}

/* --- Email OTP --- */

function EmailOtpPanel() {
  const qc = useQueryClient();
  const { data: profile, isLoading } = useQuery({
    queryKey: ["settings", "email-2fa"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase.from("profiles").select("email, email_2fa_enabled").eq("id", user.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [sending, setSending] = useState(false);
  const [step, setStep] = useState<"idle" | "verify">("idle");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  function updateCode(value: string) {
    setCode(value.replace(/\D/g, "").slice(0, 6));
  }

  async function sendCode() {
    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("Not signed in");
      const { data, error } = await supabase.functions.invoke("otp-handler", {
        body: { action: "send-enroll-email-2fa", email: user.email },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Verification code sent to your email");
      setStep("verify");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send code");
    } finally {
      setSending(false);
    }
  }

  async function verifyAndEnable() {
    setVerifying(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("Not signed in");
      const { data, error } = await supabase.functions.invoke("otp-handler", {
        body: { action: "verify-enroll-email-2fa", email: user.email, code: code.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Email 2FA enabled");
      setStep("idle"); setCode("");
      qc.invalidateQueries({ queryKey: ["settings", "email-2fa"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setVerifying(false);
    }
  }

  async function disable() {
    if (!(await confirmDialog({ title: "Disable email 2FA?", description: "You'll no longer receive a login code by email.", confirmLabel: "Disable", destructive: true }))) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ email_2fa_enabled: false }).eq("id", user.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Email 2FA disabled");
    qc.invalidateQueries({ queryKey: ["settings", "email-2fa"] });
  }

  if (isLoading) return <Skeleton className="h-10 w-full" />;

  if (profile?.email_2fa_enabled) {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm">
          <div className="flex items-center gap-2"><span className="font-medium">Enabled</span><Badge className="text-[10px]" variant="secondary">Email</Badge></div>
          <div className="text-xs text-muted-foreground">Codes are sent to {profile.email}</div>
        </div>
        <Button variant="destructive" size="sm" onClick={disable}>Disable</Button>
      </div>
    );
  }

  if (step === "verify") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Enter the 6-digit code we emailed to {profile?.email}.</p>
        <div>
          <Label className="text-xs">Verification code</Label>
          <Input value={code} onChange={(e) => updateCode(e.target.value)} placeholder="123456" inputMode="numeric" maxLength={6} className="mt-1 max-w-[200px]" />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={verifyAndEnable} disabled={verifying || code.length < 6}>
            {verifying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}Verify & enable
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setStep("idle"); setCode(""); }}>Cancel</Button>
          <Button size="sm" variant="outline" onClick={sendCode} disabled={sending}>Resend</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm">
        <div className="font-medium">Not enabled</div>
        <div className="text-xs text-muted-foreground">Receive an 8-digit code by email on sign-in. Free — uses your existing email delivery.</div>
      </div>
      <Button size="sm" onClick={sendCode} disabled={sending}>
        {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}Enable
      </Button>
    </div>
  );
}


/* ---------------- Recovery codes ---------------- */

function RecoveryCodesCard() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [loading, setLoading] = useState(false);

  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ["settings", "recovery-codes-status"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { total: 0, remaining: 0 };
      const { data } = await supabase
        .from("user_recovery_codes")
        .select("used_at")
        .eq("user_id", user.id);
      return {
        total: data?.length ?? 0,
        remaining: (data ?? []).filter((r) => !r.used_at).length,
      };
    },
  });

  const { data: mfa } = useQuery({
    queryKey: ["settings", "mfa-factors"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data;
    },
  });
  const { data: profile } = useQuery({
    queryKey: ["settings", "email-2fa"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase.from("profiles").select("email, email_2fa_enabled").eq("id", user.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const twoFactorEnabled = !!mfa?.totp?.[0] || !!profile?.email_2fa_enabled;

  async function generate() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("otp-handler", {
        body: { action: "regenerate-recovery-codes", email: (await supabase.auth.getUser()).data.user?.email ?? "" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setCodes(data.codes as string[]);
      setDialogOpen(true);
      setConfirmRegen(false);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate codes");
    } finally {
      setLoading(false);
    }
  }

  const hasCodes = (status?.total ?? 0) > 0;

  return (
    <>
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <LifeBuoy className="w-4 h-4" /> Recovery codes
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            One-time backup codes for when you lose access to your authenticator or email. Using a code signs you in and disables all 2FA so you can re-enroll.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : !twoFactorEnabled ? (
            <div className="rounded-2xl border border-dashed p-4 text-sm">
              <div className="font-medium">Enable 2FA first</div>
              <div className="text-xs text-muted-foreground mt-1">
                Recovery codes only make sense once you have a second factor. Turn on Authenticator or Email code above, then come back here to generate your backup codes.
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="text-sm">
                {hasCodes ? (
                  <>
                    <div className="font-medium">{status!.remaining} of {status!.total} codes remaining</div>
                    <div className="text-xs text-muted-foreground">Generate new codes if you're running low or think they may be compromised. Generating new codes invalidates the old set.</div>
                  </>
                ) : (
                  <>
                    <div className="font-medium">No recovery codes yet</div>
                    <div className="text-xs text-muted-foreground">Highly recommended — without these, an admin has to reset your account if you lose 2FA.</div>
                  </>
                )}
              </div>
              <Button
                size="sm"
                onClick={() => (hasCodes ? setConfirmRegen(true) : generate())}
                disabled={loading}
              >
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : hasCodes ? <RefreshCw className="w-4 h-4 mr-2" /> : <LifeBuoy className="w-4 h-4 mr-2" />}
                {hasCodes ? "Regenerate" : "Generate codes"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>


      <RecoveryCodesDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        codes={codes}
      />

      <Dialog open={confirmRegen} onOpenChange={setConfirmRegen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate recovery codes?</DialogTitle>
            <DialogDescription>
              Your existing {status?.total ?? 0} codes will stop working immediately, and 10 new codes will be shown once. Make sure you can capture the new codes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRegen(false)}>Cancel</Button>
            <Button onClick={generate} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}





