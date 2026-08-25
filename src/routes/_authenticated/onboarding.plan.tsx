import { createFileRoute, useNavigate, redirect, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/ext-client";
import { useWorkspace } from "@/components/WorkspaceContext";
import { PLANS, formatPkr, TERM_OPTIONS, computeTermPrice, computeProration, tierRank, type PlanTier } from "@/lib/plans";
import { getBillingSettings, createBillingRequest, getPlanChangeQuote, createRefundRequest } from "@/lib/billing.functions";
import { confirmDialog } from "@/components/ConfirmDialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Check, Copy, ArrowRight, Sparkles, Building2, Mail, MessageCircle, ShieldCheck, AlertTriangle, RefreshCw, Users, TicketPercent, Upload, X, ImageIcon, Wallet } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/onboarding/plan")({
  head: () => ({
    meta: [
      { title: "Choose your plan — HitroTech OrderScan" },
      { name: "description", content: "Pick a plan that fits your team." },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: PlanPage,
});

function PlanPage() {
  const navigate = useNavigate();
  const { workspace, loading } = useWorkspace();
  const [selected, setSelected] = useState<PlanTier | null>(null);
  const [months, setMonths] = useState(1);
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundBank, setRefundBank] = useState("");
  const payRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pricingRef = useRef(0);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/") && f.type !== "application/pdf") {
      toast.error("Please attach an image or PDF of your payment receipt.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("File is too large — max 10 MB.");
      return;
    }
    setFile(f);
  };

  useEffect(() => {
    if (selected) payRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);

  const getSettings = useServerFn(getBillingSettings);
  const createReq = useServerFn(createBillingRequest);
  const quoteFn = useServerFn(getPlanChangeQuote);
  const refundFn = useServerFn(createRefundRequest);

  const { data: bank } = useQuery({
    queryKey: ["billing-settings"],
    queryFn: () => getSettings(),
    staleTime: 60_000,
  });

  const submitM = useMutation({
    mutationFn: async () => {
      if (!workspace || !selected || (selected !== "free" && selected !== "starter" && selected !== "pro")) return;

      let receiptPath: string | null = null;
      if (file) {
        setUploading(true);
        try {
          const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
          const path = `${workspace.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("payment-proofs")
            .upload(path, file, { contentType: file.type, upsert: false });
          if (upErr) throw new Error(`Receipt upload failed: ${upErr.message}`);
          receiptPath = path;
        } finally {
          setUploading(false);
        }
      }

      const res = await createReq({
        data: {
          workspaceId: workspace.id,
          planTier: selected,
          paymentReference: ref || null,
          payerNote: note || null,
          months,
          receiptPath,
        },
      });

      // If the user chose to take the leftover credit back in cash, raise the
      // refund request as part of the same confirmation.
      if (refundOpen && pricingRef.current > 0 && refundBank.trim()) {
        await refundFn({
          data: {
            workspaceId: workspace.id,
            amountPkr: pricingRef.current,
            reason: refundReason || null,
            bankDetails: refundBank || null,
          },
        });
      }

      return res;
    },
    onSuccess: (res) => {
      if (res?.autoApplied) {
        toast.success(
          refundOpen
            ? "Plan changed — it's active now. We'll review your refund request."
            : "Plan changed — it's active now. Nothing was due.",
        );
      } else {
        toast.success(
          "Payment request submitted. We'll activate your plan after confirming the transfer.",
        );
      }
      navigate({ to: "/admin/billing", replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });





  const { data: serverQuote } = useQuery({
    queryKey: ["plan-quote", workspace?.id, selected, months],
    queryFn: () =>
      quoteFn({
        data: {
          workspaceId: workspace!.id,
          planTier: selected as "free" | "starter" | "pro",
          months: selected === "free" ? 1 : months,
        },
      }),
    enabled: !!workspace && (selected === "free" || selected === "starter" || selected === "pro"),
  });

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!workspace) return <div className="p-8 text-sm text-muted-foreground">No workspace.</div>;

  const isOwnerAdmin = workspace.role === "owner" || workspace.role === "admin";
  const selectedPlan = PLANS.find((p) => p.id === selected);
  const currentTier = workspace.plan_tier;
  const planActive =
    currentTier === "free" ||
    currentTier === "enterprise" ||
    (!!workspace.plan_expires_at && new Date(workspace.plan_expires_at) > new Date());

  // Server quote is authoritative; the local estimate keeps the UI responsive.
  const pricing =
    serverQuote ??
    computeProration({
      currentTier,
      currentExpiresAt: workspace.plan_expires_at,
      targetTier: selected ?? "starter",
      months: selected === "free" ? 1 : months,
    });

  pricingRef.current = pricing.refundable || pricing.unusedValue;
  const paymentDue = pricing.total > 0;
  const isPaidTarget = !!selectedPlan?.pricePkr;

  // Downgrading to Free is destructive (paid features switch off), so confirm
  // it first and show whatever unused balance is still on the current plan.
  const freeQuote = computeProration({
    currentTier,
    currentExpiresAt: workspace.plan_expires_at,
    targetTier: "free",
    months: 1,
  });

  const confirmDowngradeToFree = async () => {
    const lines = [
      `You'll move from ${PLANS.find((x) => x.id === currentTier)?.name ?? "your plan"} to Free straight away, and paid features will switch off.`,
    ];
    if (freeQuote.unusedValue > 0) {
      lines.push(
        `You still have ${formatPkr(freeQuote.unusedValue)} of unused time (${freeQuote.creditDays} day${freeQuote.creditDays === 1 ? "" : "s"} left). Nothing is charged — on the next screen you can keep it as credit or ask for a refund.`,
      );
    } else {
      lines.push("There's no unused balance on your current plan, so there's nothing to pay or refund.");
    }
    const ok = await confirmDialog({
      title: "Downgrade to Free?",
      description: lines.join("\n\n"),
      confirmLabel: "Yes, downgrade to Free",
      cancelLabel: "Keep my plan",
      destructive: true,
    });
    if (ok) {
      setMonths(1);
      setSelected("free");
    }
  };



  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8">
      <div className="text-center space-y-3">
        <div className="mx-auto h-12 w-12 rounded-2xl gradient-brand text-primary-foreground grid place-items-center">
          <Sparkles className="w-6 h-6" />
        </div>
        <h1 className="text-2xl md:text-3xl font-semibold">Choose a plan for {workspace.name}</h1>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto">
          Start free, upgrade whenever you need more. Paid plans are billed by bank transfer — pay for
          3, 6 or 12 months up front and save up to 20%.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((p) => {
          const isSelected = selected === p.id;
          const isCurrent = p.id === currentTier && planActive;
          const isDowngrade = !isCurrent && tierRank(p.id) < tierRank(currentTier);
          const direction = isDowngrade ? "Downgrade" : "Upgrade";
          return (
            <Card
              key={p.id}
              className={cn(
                "p-5 flex flex-col relative transition-all",
                p.highlight && "border-primary/50 shadow-md",
                isSelected && "ring-2 ring-primary",
                isCurrent && "ring-2 ring-emerald-500/60 border-emerald-500/40",
              )}
            >
              {isCurrent ? (
                <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-emerald-600 hover:bg-emerald-600 rounded-2xl">
                  Current plan
                </Badge>
              ) : p.highlight ? (
                <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-2xl">Most popular</Badge>
              ) : null}
              <div>
                <h3 className="font-semibold text-lg">{p.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5 min-h-[2rem]">{p.tagline}</p>
              </div>
              <div className="mt-4 mb-4">
                {p.pricePkr === null ? (
                  <div className="text-2xl font-semibold">Custom</div>
                ) : p.pricePkr === 0 ? (
                  <div className="text-2xl font-semibold">Free</div>
                ) : (
                  <div>
                    <span className="text-2xl font-semibold">{formatPkr(p.pricePkr)}</span>
                    <span className="text-xs text-muted-foreground ml-1">/ month</span>
                  </div>
                )}
              </div>
              <ul className="space-y-1.5 text-sm flex-1 mb-4">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <Button variant="outline" className="w-full" disabled>
                  <Check className="w-4 h-4 mr-1.5" /> Current plan
                </Button>
              ) : p.id === "free" ? (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={isDowngrade && !isOwnerAdmin}
                  onClick={() => {
                    if (!isDowngrade) {
                      navigate({ to: "/dashboard", replace: true });
                      return;
                    }
                    void confirmDowngradeToFree();
                  }}
                >
                  {isDowngrade ? "Downgrade to Free" : "Continue on Free"}
                </Button>
              ) : p.id === "enterprise" ? (
                <Button asChild variant="outline" className="w-full">
                  <a href={`mailto:${bank?.contact_email || "billing@hitrotech.com"}?subject=Enterprise plan enquiry — ${workspace.name}`}>
                    Contact us
                  </a>
                </Button>
              ) : (
                <Button
                  variant={isSelected ? "default" : isDowngrade ? "outline" : "default"}
                  className="w-full"
                  disabled={!isOwnerAdmin}
                  onClick={() => setSelected(p.id)}
                >
                  {isSelected ? "Selected" : `${direction} to ${p.name}`}
                </Button>
              )}
            </Card>
          );
        })}
      </div>

      {!isOwnerAdmin && (
        <Card className="p-4 text-sm text-muted-foreground text-center">
          Only workspace owners or admins can request a plan change.
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3 text-sm">
        {[
          { icon: ShieldCheck, title: "No card required", body: "Pay by bank transfer — we activate after confirming." },
          { icon: RefreshCw, title: "Change anytime", body: "Upgrade, downgrade or renew whenever you need." },
          { icon: Users, title: "Seats included", body: "Invite your team, no per-seat surprises." },
        ].map((it) => (
          <div key={it.title} className="rounded-lg border bg-muted/20 p-4">
            <it.icon className="w-4 h-4 text-primary" />
            <div className="font-medium mt-2">{it.title}</div>
            <p className="text-muted-foreground text-xs mt-0.5">{it.body}</p>
          </div>
        ))}
      </div>

      {selectedPlan && (selectedPlan.id === "free" || selectedPlan.id === "starter" || selectedPlan.id === "pro") && (
        <Card ref={payRef} className="p-6 space-y-5 scroll-mt-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-semibold text-lg">
                {paymentDue ? "Complete your payment" : "Confirm your plan change"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {paymentDue ? (
                  <>
                    Transfer <b>{formatPkr(pricing.total)}</b> to the account below, then submit the
                    details.
                  </>
                ) : (
                  <>Nothing to pay — your existing credit covers this change in full.</>
                )}
              </p>
            </div>
            <Badge variant="secondary" className="text-sm rounded-2xl">
              {isPaidTarget ? `${selectedPlan.name} — ${formatPkr(selectedPlan.pricePkr!)}/mo` : "Free — Rs 0/mo"}
            </Badge>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            {isPaidTarget && (
            <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm font-medium">Billing period</div>
              <div className="text-xs text-muted-foreground">Pay for longer, pay less per month.</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              {TERM_OPTIONS.map((t) => {
                const p = computeTermPrice(selectedPlan.pricePkr!, t.months);
                const active = months === t.months;
                return (
                  <button
                    key={t.months}
                    type="button"
                    onClick={() => setMonths(t.months)}
                    className={cn(
                      "relative rounded-2xl border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/10"
                        : "hover:border-foreground/30 hover:bg-muted/40",
                    )}
                  >
                    {t.discountPct > 0 && (
                      <span className="absolute -top-2 right-2 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                        Save {t.discountPct}%
                      </span>
                    )}
                    <div className={cn("text-sm font-medium", !active && "text-muted-foreground")}>
                      {t.label}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatPkr(p.effectiveMonthly)}/mo
                    </div>
                  </button>
                );
              })}
            </div>
            </>
            )}
            <div className="border-t pt-3 space-y-1.5 text-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Full breakdown — nothing hidden
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {isPaidTarget
                    ? `${formatPkr(selectedPlan.pricePkr!)} × ${months} ${months === 1 ? "month" : "months"}`
                    : "Free plan — no charge"}
                </span>
                <span className={cn(pricing.discount > 0 && "line-through text-muted-foreground")}>
                  {formatPkr(pricing.gross)}
                </span>
              </div>
              {pricing.discount > 0 && (
                <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                  <span className="inline-flex items-center gap-1.5">
                    <TicketPercent className="w-4 h-4" />
                    {pricing.discountPct}% long-term discount
                  </span>
                  <span>− {formatPkr(pricing.discount)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Subtotal for {selectedPlan.name}</span>
                <span>{formatPkr(pricing.subtotal)}</span>
              </div>

              {pricing.unusedValue > 0 && (
                <>
                  <div className="flex items-center justify-between border-t pt-2">
                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                      <RefreshCw className="w-4 h-4" />
                      Unused balance on {PLANS.find((x) => x.id === currentTier)?.name ?? "your plan"} (
                      {pricing.creditDays} day{pricing.creditDays === 1 ? "" : "s"} left)
                    </span>
                    <span>{formatPkr(pricing.unusedValue)}</span>
                  </div>
                  {pricing.credit > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground pl-5">Applied as credit to this invoice</span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        − {formatPkr(pricing.credit)}
                      </span>
                    </div>
                  )}
                  {pricing.carriedValue > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground pl-5">Kept as time on your current plan</span>
                      <span>{formatPkr(pricing.carriedValue)}</span>
                    </div>
                  )}
                  {pricing.refundable > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground pl-5">Left over — refundable on request</span>
                      <span>{formatPkr(pricing.refundable)}</span>
                    </div>
                  )}
                </>
              )}

              <div className="flex items-center justify-between border-t pt-2">
                <span className="font-medium">Total due now</span>
                <span className="text-lg font-semibold">{formatPkr(pricing.total)}</span>
              </div>
              {pricing.changeType !== "renewal" && pricing.credit > 0 && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  Your unused {PLANS.find((x) => x.id === currentTier)?.name} time is credited in full,
                  so you only pay the difference. {selectedPlan.name} starts as soon as we confirm the
                  change, and runs for {months} month{months === 1 ? "" : "s"} from that day.
                </p>
              )}
              {pricing.changeType === "renewal" && (
                <p className="text-xs text-muted-foreground">
                  {months} more month{months === 1 ? "" : "s"} is added on top of your current expiry —
                  no days are lost.
                </p>
              )}
              {isPaidTarget && pricing.discount > 0 && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  You save {formatPkr(pricing.discount)} — that's{" "}
                  {formatPkr(computeTermPrice(selectedPlan.pricePkr!, months).effectiveMonthly)} / month
                  instead of {formatPkr(selectedPlan.pricePkr!)}.
                </p>
              )}
              {isPaidTarget && months < 12 && (
                <p className="text-xs text-muted-foreground">
                  Switch to 12 months and save{" "}
                  {formatPkr(computeTermPrice(selectedPlan.pricePkr!, 12).discount)} overall.
                </p>
              )}

              {!paymentDue && pricing.refundable > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3 mt-2 space-y-3">
                  <div className="text-sm">
                    <div className="font-medium inline-flex items-center gap-1.5">
                      <Wallet className="w-4 h-4" /> We owe you {formatPkr(pricing.refundable)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Nothing to pay for this change. Choose what happens to the leftover — it's
                      handled together with the confirmation below.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setRefundOpen(false)}
                      className={`text-left rounded-md border p-2.5 text-sm transition-colors ${!refundOpen ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                    >
                      <div className="font-medium">Keep as credit</div>
                      <p className="text-xs text-muted-foreground">Applied to your next invoice.</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRefundOpen(true)}
                      className={`text-left rounded-md border p-2.5 text-sm transition-colors ${refundOpen ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                    >
                      <div className="font-medium">Refund to my bank</div>
                      <p className="text-xs text-muted-foreground">
                        Reviewed manually, transferred in a few working days.
                      </p>
                    </button>
                  </div>
                  {refundOpen && (
                    <div className="space-y-2 pt-1">
                      <Textarea
                        value={refundBank}
                        onChange={(e) => setRefundBank(e.target.value)}
                        placeholder="Account title, bank, IBAN / account number to send the refund to"
                        rows={2}
                      />
                      <Input
                        value={refundReason}
                        onChange={(e) => setRefundReason(e.target.value)}
                        placeholder="Reason (optional)"
                      />
                    </div>
                  )}
                </div>
              )}



            </div>

          </div>


          {paymentDue && (
          <>
          {!bank?.account_number && !bank?.iban && (
            <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <span>
                Bank account details aren't published yet. Contact us below and we'll share transfer
                instructions for your workspace.
              </span>
            </div>
          )}


          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Building2 className="w-4 h-4" /> {bank?.bank_name || "Meezan Bank"}
              </div>
              <BankRow label="Account title" value={bank?.account_title} />
              <BankRow label="Account #" value={bank?.account_number} />
              <BankRow label="IBAN" value={bank?.iban} mono />
              <BankRow label="Branch" value={bank?.branch} />
              <BankRow label="Branch code" value={bank?.branch_code} />
              <BankRow label="Reference (use this)" value={workspace.id.slice(0, 8).toUpperCase()} mono />
            </div>
            <div className="rounded-lg border p-4 space-y-3 text-sm">
              <div className="font-medium">After transfer</div>
              <p className="text-muted-foreground">
                {bank?.instructions || "Send proof of payment to us with your workspace reference."}
              </p>
              <div className="flex flex-col gap-1.5 pt-1">
                {bank?.contact_email && (
                  <a className="inline-flex items-center gap-2 hover:underline" href={`mailto:${bank.contact_email}`}>
                    <Mail className="w-4 h-4" /> {bank.contact_email}
                  </a>
                )}
                {bank?.contact_whatsapp && (
                  <a
                    className="inline-flex items-center gap-2 hover:underline"
                    href={`https://wa.me/${bank.contact_whatsapp.replace(/[^0-9]/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircle className="w-4 h-4" /> {bank.contact_whatsapp}
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ref">Bank transfer reference / TID</Label>
              <Input id="ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. TRX-123456" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">Note (optional)</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Any details we should know" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Payment screenshot / receipt</Label>
            {!file ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  pickFile(e.dataTransfer.files?.[0] ?? null);
                }}
                onClick={() => fileRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
                }}
                className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
              >
                <Upload className="w-5 h-5 text-muted-foreground" />
                <div className="text-sm font-medium">Attach your payment screenshot</div>
                <div className="text-xs text-muted-foreground">
                  PNG, JPG or PDF — up to 10 MB. Drag &amp; drop or click to browse.
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border p-3">
                {preview && file.type.startsWith("image/") ? (
                  <img
                    src={preview}
                    alt="Payment receipt preview"
                    className="h-16 w-16 rounded-md object-cover border"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-md border grid place-items-center bg-muted">
                    <ImageIcon className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{file.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(0)} KB
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setFile(null)}
                  aria-label="Remove attachment"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              Optional, but it gets your plan approved much faster.
            </p>
          </div>
          </>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-2">
            <Button variant="ghost" onClick={() => setSelected(null)}>Back</Button>
            <div className="flex flex-col items-stretch sm:items-end gap-1.5">
              <Button
                onClick={() => submitM.mutate()}
                disabled={
                  submitM.isPending ||
                  (paymentDue && !ref.trim()) ||
                  (!paymentDue && refundOpen && !refundBank.trim())
                }
              >
                {submitM.isPending
                  ? uploading
                    ? "Uploading receipt…"
                    : "Submitting…"
                  : paymentDue
                    ? `I've paid ${formatPkr(pricing.total)} — submit for review`
                    : refundOpen && pricing.refundable > 0
                      ? `Confirm ${pricing.changeType} & request ${formatPkr(pricing.refundable)} refund`
                      : `Confirm ${pricing.changeType} to ${selectedPlan.name} — nothing to pay`}
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
              {paymentDue && !ref.trim() && (
                <span className="text-xs text-muted-foreground">
                  Add the bank transfer reference to submit.
                </span>
              )}
              {!paymentDue && refundOpen && !refundBank.trim() && (
                <span className="text-xs text-muted-foreground">
                  Add your bank details to request the refund.
                </span>
              )}
              {!paymentDue && !refundOpen && (
                <span className="text-xs text-muted-foreground">
                  Your existing credit covers this change in full.
                </span>
              )}

            </div>

          </div>
        </Card>
      )}

      <div className="text-center">
        <Link to="/dashboard" className="text-xs text-muted-foreground hover:underline">
          Skip for now — I'll pick later
        </Link>
      </div>
    </div>
  );
}

function BankRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  const v = value?.trim() || "—";
  const copy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    toast.success("Copied");
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={cn("truncate", mono && "font-mono text-xs")}>{v}</span>
        {value && (
          <button onClick={copy} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Copy">
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
