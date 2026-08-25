// Field normalization + validation helpers

export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = String(input).replace(/[^\d+]/g, "");
  // Pakistan formats
  if (s.startsWith("+92")) s = "0" + s.slice(3);
  else if (s.startsWith("92") && s.length >= 12) s = "0" + s.slice(2);
  if (s.length === 10 && s.startsWith("3")) s = "0" + s;
  return s || null;
}

export function normalizeCnic(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, "");
  if (digits.length === 13) return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
  return String(input).trim() || null;
}

export function avgConfidence(conf: Record<string, number> | null | undefined): number {
  if (!conf) return 0;
  const vals = Object.values(conf).filter((v) => typeof v === "number");
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export const EXTRACT_FIELDS = [
  "customer_name",
  "phone_number",
  "current_network",
  "sim_type",
  "number_type",
  "package_name",
  "number_charges",
  "paid_via",
  "discount",
  "email",
  "store_id",
  "reference",
  "deposit",
  "remaining_deposit",
  "order_number",
  "cnic",
  "plan_price",
  "activation_date",
  "activation_time",
  "employee_name",
  "branch_name",
  "order_status",
  "remarks",
] as const;

export type ExtractField = (typeof EXTRACT_FIELDS)[number];

export const FIELD_LABELS: Record<ExtractField, string> = {
  customer_name: "Customer Name",
  phone_number: "Current / Onic Number",
  current_network: "Current Network",
  sim_type: "Sim Type",
  number_type: "Number Type",
  package_name: "Package",
  number_charges: "Number Charges",
  paid_via: "Paid Via",
  discount: "Discount",
  email: "Email",
  store_id: "Store ID",
  reference: "Reference",
  deposit: "Deposit",
  remaining_deposit: "Remaining Deposit",
  order_number: "Order Number",
  cnic: "CNIC",
  plan_price: "Plan Price",
  activation_date: "Activation Date",
  activation_time: "Activation Time",
  employee_name: "Employee Name",
  branch_name: "Branch Name",
  order_status: "Status",
  remarks: "Remarks",
};
