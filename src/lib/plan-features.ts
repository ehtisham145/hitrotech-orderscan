import type { PlanTier } from "@/lib/plans";

/** Every gated capability in the app. */
export type FeatureKey =
  | "partners"           // partner directory & matching
  | "leaderboard"        // partner leaderboard
  | "employees"          // internal employees management
  | "store_performance"  // store-level performance
  | "anomalies"          // anomaly detection page
  | "commissions"        // commission slabs
  | "payouts"            // partner payouts engine
  | "brand_earnings"     // my brand, brand slabs & agency margin
  | "reconciliation"     // payment ledger & month close
  | "reports"            // manual/custom reports
  | "scheduled_reports"  // recurring/scheduled reports
  | "audit_log"          // full audit log
  | "notifications"      // in-app notifications & alerts
  | "priority_support"
  | "sso";

const MATRIX: Record<PlanTier, FeatureKey[]> = {
  // Free plan needs Partners because a partner is required to run any import.
  free: ["partners", "store_performance", "employees"],
  starter: ["partners", "store_performance", "leaderboard", "anomalies", "employees"],
  pro: [
    "partners", "store_performance", "leaderboard", "anomalies", "employees",
    "commissions", "payouts", "brand_earnings", "reconciliation",
    "reports",
    "scheduled_reports",
    "audit_log", "notifications", "priority_support",
  ],
  enterprise: [
    "partners", "store_performance", "leaderboard", "anomalies", "employees",
    "commissions", "payouts", "brand_earnings", "reconciliation",
    "reports",
    "scheduled_reports",
    "audit_log", "notifications", "priority_support", "sso",
  ],
};


export function planAllows(tier: PlanTier | string | null | undefined, feature: FeatureKey): boolean {
  const t = (tier ?? "free") as PlanTier;
  return (MATRIX[t] ?? []).includes(feature);
}

/** Minimum tier that unlocks a given feature, for upsell copy. */
export function minTierFor(feature: FeatureKey): PlanTier {
  const order: PlanTier[] = ["free", "starter", "pro", "enterprise"];
  for (const t of order) {
    if ((MATRIX[t] ?? []).includes(feature)) return t;
  }
  return "enterprise";
}

export const FEATURE_LABEL: Record<FeatureKey, string> = {
  partners: "Partners",
  leaderboard: "Partner Leaderboard",
  employees: "Internal Employees",
  store_performance: "Store Performance",
  anomalies: "Anomaly Detection",
  commissions: "Commissions Engine",
  payouts: "Payouts Engine",
  brand_earnings: "My Brand & Agency Earnings",
  reconciliation: "Reconciliation & Month Close",
  reports: "Advanced Reports",
  scheduled_reports: "Scheduled Reports",
  audit_log: "Full Audit Log",
  notifications: "Notifications & Alerts",
  priority_support: "Priority Support",
  sso: "SSO / SAML",
};

/** Plan expiry helper. Returns true if plan is active (or free). */
export function isPlanActive(tier: PlanTier | string | null | undefined, expiresAt: string | null | undefined): boolean {
  const t = (tier ?? "free") as PlanTier;
  if (t === "free") return true;
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() > Date.now();
}
