export type PlanTier = "free" | "starter" | "pro" | "enterprise";

export type PlanDef = {
  id: PlanTier;
  name: string;
  tagline: string;
  pricePkr: number | null; // null = contact us
  seatLimit: number;
  employeeLimit: number | null; // null = unlimited
  activationsPerMonth: number | null; // null = unlimited
  partnerLimit: number | null; // null = unlimited
  features: string[];
  cta: string;
  highlight?: boolean;
};

export const PLANS: PlanDef[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Get started, no card needed",
    pricePkr: 0,
    seatLimit: 2,
    employeeLimit: 1,
    activationsPerMonth: 500,
    partnerLimit: 1,
    features: [
      "1 workspace",
      "Up to 2 team members",
      "1 internal employee",
      "500 activations / month",
      "1 partner",
      "Order dashboard",
      "Store performance",
      "CSV export",
    ],
    cta: "Start free",
  },
  {
    id: "starter",
    name: "Starter",
    tagline: "For growing telecom teams",
    pricePkr: 10000,
    seatLimit: 5,
    employeeLimit: 5,
    activationsPerMonth: 1000,
    partnerLimit: null,
    features: [
      "Up to 5 team members",
      "Up to 5 internal employees",
      "1,000 activations / month",
      "Everything in Free",
      "Unlimited partners & leaderboard",
      "Anomaly detection",
      "Email support",
    ],
    cta: "Choose Starter",
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "The complete operations suite",
    pricePkr: 20000,
    seatLimit: 15,
    employeeLimit: 20,
    activationsPerMonth: 10000,
    partnerLimit: null,
    features: [
      "Up to 15 team members",
      "Up to 20 internal employees",
      "10,000 activations / month",
      "Everything in Starter",
      "Unlimited partners",
      "Commissions & payouts engine",
      "Brand earnings & margin tracking",
      "Reconciliation & month close",
      "Scheduled reports",

      "Full audit log",
      "Priority support",
    ],
    cta: "Choose Pro",
    highlight: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For large operators & MVNOs",
    pricePkr: null,
    seatLimit: 999,
    employeeLimit: null,
    activationsPerMonth: null,
    partnerLimit: null,
    features: [
      "Everything in Pro",
      "Unlimited members",
      "Unlimited employees",
      "Unlimited activations",
      "Unlimited partners",
      "SSO / SAML",
      "Dedicated account manager",
      "Custom SLAs & integrations",
      "On-premise / private deployment",
    ],
    cta: "Contact us",
  },
];

export function getPartnerLimit(tier: PlanTier | string | null | undefined): number | null {
  return getPlan(tier).partnerLimit;
}

export function getPlan(tier: PlanTier | string | null | undefined): PlanDef {
  return PLANS.find((p) => p.id === tier) ?? PLANS[0];
}

export function formatPkr(n: number): string {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(n);
}

// ---------- Multi-month term discounts ----------

export type TermOption = { months: number; discountPct: number; label: string };

export const TERM_OPTIONS: TermOption[] = [
  { months: 1, discountPct: 0, label: "1 month" },
  { months: 3, discountPct: 5, label: "3 months" },
  { months: 6, discountPct: 10, label: "6 months" },
  { months: 12, discountPct: 20, label: "12 months" },
];

export function getTermDiscountPct(months: number): number {
  const exact = TERM_OPTIONS.find((t) => t.months === months);
  if (exact) return exact.discountPct;
  // Fall back to the best term the duration qualifies for.
  return TERM_OPTIONS.filter((t) => months >= t.months).reduce(
    (acc, t) => Math.max(acc, t.discountPct),
    0,
  );
}

export function computeTermPrice(monthlyPkr: number, months: number) {
  const gross = monthlyPkr * months;
  const discountPct = getTermDiscountPct(months);
  const discount = Math.round((gross * discountPct) / 100);
  const total = gross - discount;
  return {
    gross,
    discountPct,
    discount,
    total,
    effectiveMonthly: Math.round(total / months),
  };
}

// ---------- Tier ordering, upgrades / downgrades ----------

export const TIER_ORDER: PlanTier[] = ["free", "starter", "pro", "enterprise"];

export function tierRank(tier: PlanTier | string | null | undefined): number {
  const i = TIER_ORDER.indexOf((tier ?? "free") as PlanTier);
  return i === -1 ? 0 : i;
}

export type PlanChangeType = "upgrade" | "renewal" | "downgrade";

export function getPlanChangeType(
  currentTier: PlanTier | string | null | undefined,
  targetTier: PlanTier | string,
): PlanChangeType {
  const a = tierRank(currentTier);
  const b = tierRank(targetTier);
  if (b > a) return "upgrade";
  if (b < a) return "downgrade";
  return "renewal";
}

export const DAY_MS = 86_400_000;

export function remainingDays(expiresAt: string | Date | null | undefined, now = new Date()): number {
  if (!expiresAt) return 0;
  const exp = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  if (Number.isNaN(exp.getTime())) return 0;
  const days = (exp.getTime() - now.getTime()) / DAY_MS;
  return Math.max(0, Math.min(366, Math.round(days * 100) / 100));
}

export type ProrationQuote = {
  changeType: PlanChangeType;
  months: number;
  gross: number;
  discountPct: number;
  discount: number;
  subtotal: number;
  /** Unused value of the current paid plan, applied to this invoice. */
  credit: number;
  creditDays: number;
  /** What the customer pays now. */
  total: number;
  effectiveMonthly: number;
  /** Kept for compatibility — the new plan always starts on approval now. */
  startsAt: string | null;
  /** Monthly rate actually being credited back. */
  creditMonthlyRate: number;
  /** Full money value of the unused days on the current plan. */
  unusedValue: number;
  /** Value kept as time (same-tier renewal) rather than as money off this invoice. */
  carriedValue: number;
  /** Credit left over after this invoice is fully covered — refundable on request. */
  refundable: number;
};

/**
 * Works out what a workspace pays when moving between plans mid-term.
 *
 * The unused, already-paid value of the current term is measured exactly:
 * remaining days ÷ days in the current term × what they actually paid for it.
 *
 * - Upgrade / downgrade -> the unused value becomes money credit on this
 *   invoice. Anything left over after the invoice is covered is refundable.
 *   The new plan starts as soon as the payment is approved.
 * - Renewal (same tier) -> nothing is credited; the months are appended to the
 *   current expiry, so the unused value is kept as time.
 */
export function computeProration(args: {
  currentTier: PlanTier | string | null | undefined;
  currentExpiresAt: string | Date | null | undefined;
  /** Start of the current paid term (when the plan was activated / last renewed). */
  currentTermStart?: string | Date | null;
  /** Total amount actually paid for the current term. */
  currentPaidTotal?: number | null;
  /** Effective monthly rate the workspace actually paid (after term discount). */
  currentPaidMonthly?: number | null;
  targetTier: PlanTier | string;
  months: number;
  now?: Date;
}): ProrationQuote {
  const now = args.now ?? new Date();
  const target = getPlan(args.targetTier);
  const monthly = target.pricePkr ?? 0;
  const term = computeTermPrice(monthly, args.months);
  const changeType = getPlanChangeType(args.currentTier, args.targetTier);

  const days = remainingDays(args.currentExpiresAt, now);
  const currentPlan = getPlan(args.currentTier);
  const listMonthly = currentPlan.pricePkr ?? 0;
  const paidMonthly =
    args.currentPaidMonthly != null && args.currentPaidMonthly > 0
      ? Math.min(args.currentPaidMonthly, listMonthly || args.currentPaidMonthly)
      : listMonthly;

  // Exact day-based proration of the current term when we know its bounds.
  let termDays = 0;
  if (args.currentTermStart && args.currentExpiresAt) {
    const start = new Date(args.currentTermStart).getTime();
    const end = new Date(args.currentExpiresAt).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      termDays = (end - start) / DAY_MS;
    }
  }

  let unusedValue = 0;
  if (days > 0 && currentPlan.pricePkr) {
    if (termDays > 0 && args.currentPaidTotal && args.currentPaidTotal > 0) {
      unusedValue = Math.round(args.currentPaidTotal * (Math.min(days, termDays) / termDays));
    } else if (paidMonthly > 0) {
      unusedValue = Math.round((days / 30) * paidMonthly);
    }
  }

  // Tier changes cash the unused value out onto this invoice; a same-tier
  // renewal keeps it as time instead.
  const credit = changeType === "renewal" ? 0 : Math.max(0, Math.min(unusedValue, term.total));
  const total = Math.max(0, term.total - credit);
  const carriedValue = changeType === "renewal" ? unusedValue : 0;
  const refundable = changeType === "renewal" ? 0 : Math.max(0, unusedValue - credit);

  return {
    changeType,
    months: args.months,
    gross: term.gross,
    discountPct: term.discountPct,
    discount: term.discount,
    subtotal: term.total,
    credit,
    creditDays: Math.floor(days),
    total,
    effectiveMonthly: Math.round(total / Math.max(1, args.months)),
    startsAt: null,
    creditMonthlyRate: paidMonthly,
    unusedValue,
    carriedValue,
    refundable,
  };
}


