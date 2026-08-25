import { useWorkspace, type WorkspaceRole } from "@/components/WorkspaceContext";

export type Permissions = {
  role: WorkspaceRole | null;
  isSuperAdmin: boolean;
  isOwner: boolean;
  isAdmin: boolean;         // owner | admin
  isManagerOrAdmin: boolean; // owner | admin | manager
  isPartner: boolean;
  isStaff: boolean;         // any internal (non-partner) workspace member
  /** Read-only finance role. */
  isAccountant: boolean;
  /** Import/data-entry only role. */
  isOperator: boolean;
  /** Can upload batches and edit extraction data. */
  canImport: boolean;
  /** Can open money screens (payouts, reconciliation, brand, commissions). */
  canViewFinance: boolean;
  /** Can change money data (record payments, close months, edit slabs). */
  canEditFinance: boolean;
  /** True when the role may look but never touch. */
  isReadOnly: boolean;
  loading: boolean;
  /** Human-readable label for the current role. */
  roleLabel: string;
};

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
  operator: "Operator",
  accountant: "Accountant",
  partner: "Partner",
  super_admin: "Super Admin",
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: "Full control including billing and workspace deletion.",
  admin: "Everything except billing ownership.",
  manager: "Partners, payouts and day-to-day operations.",
  employee: "Imports, batches and orders.",
  operator: "Imports and orders only — no money screens.",
  accountant: "Read-only access to all financial reports. Cannot change anything.",
  partner: "Sees only their own portal, statements and performance.",
};

export function usePermissions(): Permissions {
  const { workspace, isSuperAdmin, loading } = useWorkspace();
  const role = workspace?.role ?? null;
  const isOwner = role === "owner";
  const isAdmin = isOwner || role === "admin" || isSuperAdmin;
  const isManagerOrAdmin = isAdmin || role === "manager";
  const isPartner = role === "partner";
  const isAccountant = role === "accountant";
  const isOperator = role === "operator";
  const isStaff = isManagerOrAdmin || role === "employee" || isAccountant || isOperator;

  const canImport = isManagerOrAdmin || role === "employee" || isOperator;
  const canViewFinance = isAdmin || isAccountant;
  const canEditFinance = isAdmin;
  const isReadOnly = isAccountant;

  const roleLabel = isSuperAdmin ? "Super Admin" : ROLE_LABELS[role ?? ""] ?? "Member";

  return {
    role,
    isSuperAdmin,
    isOwner,
    isAdmin,
    isManagerOrAdmin,
    isPartner,
    isStaff,
    isAccountant,
    isOperator,
    canImport,
    canViewFinance,
    canEditFinance,
    isReadOnly,
    loading,
    roleLabel,
  };
}

/** Small helper: describe minimum role needed for an action. */
export function requiredRoleLabel(min: "owner" | "admin" | "manager"): string {
  if (min === "owner") return "Owner";
  if (min === "admin") return "Owner or Admin";
  return "Owner, Admin, or Manager";
}
