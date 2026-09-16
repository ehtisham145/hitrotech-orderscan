import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { assertActiveWorkspaceRole } from "./authz.server";
import { requireActiveWorkspaceId } from "./workspace-helpers";
import { z } from "zod";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { effectivePlanTier } from "./plan-features";
import { omitNulls } from "./db-payload";
import { getPlan } from "./plans";
import { COMPENSATION_TYPES, monthlyEarnings } from "./employee-pay";
import type { ServerContext } from "./server-context";

// Each handler is a plain `<name>Core(data, context)` function with a one-line
// createServerFn wrapper under it — see src/lib/server-context.ts for why.

const WRITE_ROLES = ["owner", "admin", "manager"] as const;

export type EmployeeRole = "bdo" | "asm" | "rsm";

export async function getEmployeeUsageCore(context: ServerContext) {
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);

  const { count, error: countError } = await context.supabase
    .from("employees")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", wsId);

  if (countError) throw new Error(countError.message);

  const { data: ws, error: wsError } = await context.supabase
    .from("workspaces")
    .select("plan_tier, plan_expires_at")
    .eq("id", wsId)
    .single();

  if (wsError) throw new Error(wsError.message);

  // An expired plan reverts to free for every limit check — see
  // effectivePlanTier's note on why this is read-time.
  const tier = effectivePlanTier(ws?.plan_tier, ws?.plan_expires_at);
  const plan = getPlan(tier);

  return {
    used: count || 0,
    limit: plan.employeeLimit,
    planTier: tier,
  };
}

export const getEmployeeUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => getEmployeeUsageCore(context));

export async function listEmployeesCore(context: ServerContext) {
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
  const { data, error } = await context.supabase
    .from("employees")
    .select("*")
    .eq("workspace_id", wsId)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as any[];
}

export const listEmployees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => listEmployeesCore(context));

// BUG FIX: the original query fetched by `.eq("id", data.id)` alone — no
// workspace_id filter at all, so any authenticated user could read any
// employee's full record (salary, CNIC, phone) from any workspace just by
// knowing or guessing its id. Scoped to the caller's active workspace, same
// as every other read here.
export async function getEmployeeCore(data: { id: string }, context: ServerContext) {
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
  const { data: e, error } = await context.supabase
    .from("employees")
    .select("*, manager:manager_id(id, name, role)")
    .eq("workspace_id", wsId)
    .eq("id", data.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return e as any;
}

export const getEmployee = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(({ data, context }) => getEmployeeCore(data, context));

const employeeSchema = z.object({
  name: z.string().min(1),
  cnic: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  employee_id: z.string().optional().nullable(),
  role: z.enum(["bdo", "asm", "rsm"]),
  status: z.string().optional().nullable(),
  joining_date: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  area: z.string().optional().nullable(),
  manager_id: z.string().optional().nullable(),
  target_activations: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  salary: z.number().optional().nullable(),
  compensation_type: z.enum(COMPENSATION_TYPES).optional(),
  commission_per_activation: z.number().optional().nullable(),
  device_info: z.string().optional().nullable(),
  kpi_metrics: z.record(z.any()).optional().nullable(),
  promotion_history: z.array(z.any()).optional().nullable(),
});

export async function upsertEmployeeCore(
  data: z.infer<typeof employeeSchema> & { id?: string },
  context: ServerContext,
) {
  const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
  const { id, ...rest } = data;

  // Enforce limits for new records
  if (!id) {
    const { data: ws, error: wsError } = await context.supabase
      .from("workspaces")
      .select("plan_tier, plan_expires_at")
      .eq("id", wsId)
      .single();
    if (wsError) throw new Error(wsError.message);

    const { data: superAdmin, error: roleError } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "super_admin")
      .maybeSingle();
    if (roleError) throw new Error(roleError.message);

    const plan = getPlan(effectivePlanTier(ws?.plan_tier, ws?.plan_expires_at));
    // Skip limit check if user is a super admin
    if (plan.employeeLimit !== null && !superAdmin) {
      const { count, error: countError } = await context.supabase
        .from("employees")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", wsId);
      if (countError) throw new Error(countError.message);

      const currentCount = count || 0;
      if (currentCount >= plan.employeeLimit) {
        throw new Error(`Plan limit reached: You can only have up to ${plan.employeeLimit} employees on the ${plan.name} plan. Please upgrade to add more.`);
      }
    }
  }

  // commission_per_activation is NOT NULL with a default; the input schema
  // allows null for "left blank", which the constraint rejects. See omitNulls.
  const payload = omitNulls({ ...rest, workspace_id: wsId }, ["commission_per_activation"]);

  if (id) {
    // BUG FIX: the update previously matched `.eq("id", id)` alone — no
    // workspace_id filter — so a caller in one workspace could edit another
    // workspace's employee by id. Scoped to the caller's workspace now, and
    // a miss (wrong id, or an id from another workspace) fails loudly
    // instead of silently reporting success on a row that was never touched.
    const { data: row, error } = await context.supabase
      .from("employees")
      .update(payload)
      .eq("workspace_id", wsId)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Employee not found in this workspace");
    return { ok: true as const, row: row as any };
  } else {
    const { data: row, error } = await context.supabase
      .from("employees")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, row: row as any };
  }
}

export const upsertEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.infer<typeof employeeSchema> & { id?: string }) => input)
  .handler(({ data, context }) => upsertEmployeeCore(data, context));

// BUG FIX: previously deleted by `.eq("id", data.id)` alone — no workspace
// scoping — so a caller could delete another workspace's employee by id.
export async function deleteEmployeeCore(data: { id: string }, context: ServerContext) {
  const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
  const { error } = await context.supabase
    .from("employees")
    .delete()
    .eq("workspace_id", wsId)
    .eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export const deleteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(({ data, context }) => deleteEmployeeCore(data, context));

// BUG FIX: this endpoint had no workspace check at all — any authenticated
// user could pull any employee's monthly performance (and earnings) from any
// workspace by passing an arbitrary employeeId. Now scoped to the caller's
// active workspace on both the employee lookup and the activations query.
// Also fixed: activationsRes.error was never checked, so a failed activations
// query silently reported zero activations for the month instead of failing.
export async function getEmployeePerformanceCore(
  data: { employeeId: string; month?: string },
  context: ServerContext,
) {
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
  const monthStr = data.month || format(new Date(), "yyyy-MM");
  const start = startOfMonth(new Date(monthStr + "-01")).toISOString();
  const end = endOfMonth(new Date(monthStr + "-01")).toISOString();

  const employeeQ = (context.supabase.from("employees" as any) as any)
    .select("*")
    .eq("workspace_id", wsId)
    .eq("id", data.employeeId)
    .single();
  const activationsQ = (context.supabase
    .from("extractions" as any) as any)
    .select("id, status, created_at, current_network")
    .eq("workspace_id", wsId)
    .eq("employee_id" as any, data.employeeId)
    .eq("status", "success")
    .eq("is_duplicate", false)
    .gte("created_at", start)
    .lte("created_at", end);

  const [employeeRes, activationsRes] = await Promise.all([
    employeeQ,
    activationsQ,
  ]);

  if (employeeRes.error) throw new Error(employeeRes.error.message);
  if (activationsRes.error) throw new Error(activationsRes.error.message);
  const employee = employeeRes.data as any;
  const activations = (activationsRes.data ?? []) as any[];

  // Calculate daily history for the month
  const dailyMap = new Map<string, number>();
  activations.forEach((a) => {
    const day = format(new Date(a.created_at), "yyyy-MM-dd");
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
  });

  // Calculate network mix
  const networkMap = new Map<string, number>();
  activations.forEach((a) => {
    const net = a.current_network || "Unknown";
    networkMap.set(net, (networkMap.get(net) ?? 0) + 1);
  });

  // Calculate KPI metrics based on role
  const kpis = {
    activations: activations.length,
    target: employee.target_activations || 0,
    attainment: employee.target_activations ? Math.round((activations.length / employee.target_activations) * 100) : 0,
    successRate: activations.length > 0 ? 100 : 0, // Placeholder for future logic
    efficiency: 0, // Placeholder
  };

  const earnings = monthlyEarnings({
    compensation_type: employee.compensation_type,
    salary: employee.salary,
    commission_per_activation: employee.commission_per_activation,
    activations: activations.length,
  });

  return {
    employee,
    month: monthStr,
    totalActivations: activations.length,
    target: employee.target_activations || 0,
    attainment: kpis.attainment,
    kpis,
    earnings,
    daily: Array.from(dailyMap.entries()).map(([date, count]) => ({ date, count })),
    networks: Array.from(networkMap.entries()).map(([name, count]) => ({ name, count })),
  };
}

export const getEmployeePerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { employeeId: string; month?: string }) => input)
  .handler(({ data, context }) => getEmployeePerformanceCore(data, context));

// BUG FIX: same shape as getEmployeePerformanceCore — no workspace check at
// all, and neither query's error was checked (a failed team or activations
// fetch silently reported an empty/zero team performance instead of failing).
// Both queries are now scoped to the caller's workspace.
export async function getEmployeeTeamPerformanceCore(
  data: { managerId: string; month?: string },
  context: ServerContext,
) {
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
  const monthStr = data.month || format(new Date(), "yyyy-MM");
  const start = startOfMonth(new Date(monthStr + "-01")).toISOString();
  const end = endOfMonth(new Date(monthStr + "-01")).toISOString();

  const teamQ = context.supabase.from("employees").select("*").eq("workspace_id", wsId).eq("manager_id" as any, data.managerId);
  const activationsQ = (context.supabase.from("extractions" as any) as any)
    .select("id, employee_id, status, created_at")
    .eq("workspace_id", wsId)
    .eq("status", "success")
    .eq("is_duplicate", false)
    .gte("created_at", start)
    .lte("created_at", end);

  const [teamRes, activationsRes] = await Promise.all([teamQ, activationsQ]);

  if (teamRes.error) throw new Error(teamRes.error.message);
  if (activationsRes.error) throw new Error((activationsRes.error as { message: string }).message);

  const team = (teamRes.data ?? []) as any[];
  const allActivations = (activationsRes.data ?? []) as any[];

  const teamMembers = team.map((member) => {
    const memberActivations = allActivations.filter((a) => a.employee_id === member.id);
    return {
      ...member,
      activationsCount: memberActivations.length,
      target: member.target_activations || 0,
      attainment: member.target_activations ? Math.round((memberActivations.length / member.target_activations) * 100) : 0,
    };
  });

  return {
    month: monthStr,
    teamMembers: teamMembers.sort((a, b) => b.activationsCount - a.activationsCount),
    totalTeamActivations: teamMembers.reduce((sum, m) => sum + m.activationsCount, 0),
  };
}

export const getEmployeeTeamPerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { managerId: string; month?: string }) => input)
  .handler(({ data, context }) => getEmployeeTeamPerformanceCore(data, context));

// BUG FIX: no workspace filter — any authenticated user could list any
// employee's cash-advance history (amounts, dates) by passing an arbitrary
// employeeId. employees_advances carries its own workspace_id column (see
// upsertEmployeeAdvanceCore below), so it's filterable directly.
export async function listEmployeeAdvancesCore(data: { employeeId: string }, context: ServerContext) {
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
  const { data: advances, error } = await (context.supabase
    .from("employees_advances" as any) as any)
    .select("*")
    .eq("workspace_id", wsId)
    .eq("employee_id", data.employeeId)
    .order("payment_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (advances ?? []) as any[];
}

export const listEmployeeAdvances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { employeeId: string }) => input)
  .handler(({ data, context }) => listEmployeeAdvancesCore(data, context));

const advanceSchema = z.object({
  employee_id: z.string().uuid(),
  amount: z.number().positive(),
  repayment_amount: z.number().nonnegative().optional().nullable(),
  payment_date: z.string(),
  description: z.string().optional().nullable(),
  is_settled: z.boolean().optional(),
});

export async function upsertEmployeeAdvanceCore(
  data: z.infer<typeof advanceSchema> & { id?: string },
  context: ServerContext,
) {
  const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
  const { id, ...rest } = data;

  if (id) {
    // BUG FIX: the update previously matched `.eq("id", id)` alone. Worse
    // than a read leak — it also *wrote* `workspace_id: wsId` into the
    // payload, so a caller in workspace A supplying workspace B's advance id
    // could both edit B's row and reassign it into A's tenant. Scoped by
    // workspace_id in the WHERE clause now, so an id outside the caller's
    // workspace matches nothing.
    const { data: row, error } = await (context.supabase
      .from("employees_advances" as any) as any)
      .update({ ...rest, workspace_id: wsId })
      .eq("workspace_id", wsId)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Advance not found in this workspace");
    return { ok: true as const, row: row as any };
  } else {
    const { data: row, error } = await (context.supabase
      .from("employees_advances" as any) as any)
      .insert({ ...rest, workspace_id: wsId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, row: row as any };
  }
}

export const upsertEmployeeAdvance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.infer<typeof advanceSchema> & { id?: string }) => input)
  .handler(({ data, context }) => upsertEmployeeAdvanceCore(data, context));

// BUG FIX: no workspace filter — scoped by workspace_id now.
export async function settleEmployeeAdvanceCore(data: { id: string; settled: boolean }, context: ServerContext) {
  const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
  const { error } = await (context.supabase
    .from("employees_advances" as any) as any)
    .update({
      is_settled: data.settled,
      settled_at: data.settled ? new Date().toISOString() : null,
    })
    .eq("workspace_id", wsId)
    .eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export const settleEmployeeAdvance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; settled: boolean }) => input)
  .handler(({ data, context }) => settleEmployeeAdvanceCore(data, context));

// BUG FIX: no workspace filter — scoped by workspace_id now.
export async function deleteEmployeeAdvanceCore(data: { id: string }, context: ServerContext) {
  const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
  const { error } = await (context.supabase
    .from("employees_advances" as any) as any)
    .delete()
    .eq("workspace_id", wsId)
    .eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export const deleteEmployeeAdvance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(({ data, context }) => deleteEmployeeAdvanceCore(data, context));

// BUG FIX: no workspace filter — a caller could sum up another workspace's
// advances for an employee id of their choosing. Scoped by workspace_id now.
export async function getEmployeeAdvancesSummaryCore(data: { employeeId: string }, context: ServerContext) {
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
  const { data: advances, error } = await (context.supabase
    .from("employees_advances" as any) as any)
    .select("amount, repayment_amount, is_settled")
    .eq("workspace_id", wsId)
    .eq("employee_id", data.employeeId);

  if (error) throw new Error(error.message);

  const rows = (advances ?? []) as any[];
  const total = rows.reduce((sum, r) => sum + (r.amount || 0), 0);
  const repaid = rows.reduce((sum, r) => sum + (r.repayment_amount || 0), 0);
  const pending = total - repaid;

  return {
    total,
    repaid,
    pending: Math.max(0, pending),
    count: rows.length,
    activeCount: rows.filter((r) => !r.is_settled).length,
  };
}

export const getEmployeeAdvancesSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { employeeId: string }) => input)
  .handler(({ data, context }) => getEmployeeAdvancesSummaryCore(data, context));
