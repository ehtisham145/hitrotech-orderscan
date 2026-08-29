// Employee compensation models. Pure helpers, shared by server and UI.

export const COMPENSATION_TYPES = ["fixed", "commission_only", "salary_plus_commission"] as const;
export type CompensationType = (typeof COMPENSATION_TYPES)[number];

export const COMPENSATION_LABELS: Record<CompensationType, string> = {
  fixed: "Fixed salary",
  commission_only: "Commission only",
  salary_plus_commission: "Salary + commission",
};

export const COMPENSATION_HINTS: Record<CompensationType, string> = {
  fixed: "Paid the same amount every month, whatever the activation count.",
  commission_only: "Paid per activation only — no base salary.",
  salary_plus_commission: "Base salary plus a rate for every activation.",
};

export function normalizeCompensationType(v: unknown): CompensationType {
  return (COMPENSATION_TYPES as readonly string[]).includes(v as string)
    ? (v as CompensationType)
    : "fixed";
}

export type MonthlyEarnings = {
  compensationType: CompensationType;
  baseSalary: number;
  ratePerActivation: number;
  activations: number;
  commission: number;
  gross: number;
};

/** What the employee earned for a month, before advances are deducted. */
export function monthlyEarnings(input: {
  compensation_type?: unknown;
  salary?: number | null;
  commission_per_activation?: number | null;
  activations: number;
}): MonthlyEarnings {
  const compensationType = normalizeCompensationType(input.compensation_type);
  const salary = Number(input.salary ?? 0) || 0;
  const rate = Number(input.commission_per_activation ?? 0) || 0;
  const activations = input.activations ?? 0;

  const baseSalary = compensationType === "commission_only" ? 0 : salary;
  const ratePerActivation = compensationType === "fixed" ? 0 : rate;
  const commission = ratePerActivation * activations;

  return {
    compensationType,
    baseSalary,
    ratePerActivation,
    activations,
    commission,
    gross: baseSalary + commission,
  };
}
