import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { assertActiveWorkspaceRole } from "./authz.server";
import { requireActiveWorkspaceId } from "./workspace-helpers";
import { z } from "zod";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { getPlan } from "./plans";
import { COMPENSATION_TYPES, monthlyEarnings } from "./employee-pay";

const WRITE_ROLES = ["owner", "admin", "manager"] as const;

export type EmployeeRole = "bdo" | "asm" | "rsm";

export const getEmployeeUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);

    const { count, error: countError } = await context.supabase
      .from("employees")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", wsId);
    
    if (countError) throw countError;

    const { data: ws, error: wsError } = await context.supabase
      .from("workspaces")
      .select("plan_tier")
      .eq("id", wsId)
      .single();

    if (wsError) throw wsError;

    const plan = getPlan(ws?.plan_tier);

    return {
      used: count || 0,
      limit: plan.employeeLimit,
      planTier: ws?.plan_tier,
    };
  });


export const listEmployees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("employees")
      .select("*")
      .eq("workspace_id", wsId)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as any[];
  });


export const getEmployee = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: e, error } = await context.supabase
      .from("employees")
      .select("*, manager:manager_id(id, name, role)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return e as any;
  });

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

export const upsertEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.infer<typeof employeeSchema> & { id?: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { id, ...rest } = data;

    // Enforce limits for new records
    if (!id) {
      const { data: ws } = await context.supabase
        .from("workspaces")
        .select("plan_tier")
        .eq("id", wsId)
        .single();
      
      const { data: superAdmin } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "super_admin")
        .maybeSingle();

      const plan = getPlan(ws?.plan_tier);
      // Skip limit check if user is a super admin
      if (plan.employeeLimit !== null && !superAdmin) {
        const { count } = await context.supabase
          .from("employees")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", wsId);
        
        const currentCount = count || 0;
        if (currentCount >= plan.employeeLimit) {
          throw new Error(`Plan limit reached: You can only have up to ${plan.employeeLimit} employees on the ${plan.name} plan. Please upgrade to add more.`);
        }
      }
    }

    if (id) {
      const { data: row, error } = await context.supabase
        .from("employees")
        .update({ ...rest, workspace_id: wsId } as any)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return { ok: true as const, row: row as any };
    } else {
      const { data: row, error } = await context.supabase
        .from("employees")
        .insert({ ...rest, workspace_id: wsId } as any)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return { ok: true as const, row: row as any };
    }
  });

export const deleteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { error } = await context.supabase.from("employees").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getEmployeePerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { employeeId: string; month?: string }) => input)
  .handler(async ({ data, context }) => {
    const monthStr = data.month || format(new Date(), "yyyy-MM");
    const start = startOfMonth(new Date(monthStr + "-01")).toISOString();
    const end = endOfMonth(new Date(monthStr + "-01")).toISOString();

    const employeeQ = (context.supabase.from("employees" as any) as any).select("*").eq("id", data.employeeId).single();
    const activationsQ = (context.supabase
      .from("extractions" as any) as any)
      .select("id, status, created_at, current_network")
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
  });


export const getEmployeeTeamPerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { managerId: string; month?: string }) => input)
  .handler(async ({ data, context }) => {
    const monthStr = data.month || format(new Date(), "yyyy-MM");
    const start = startOfMonth(new Date(monthStr + "-01")).toISOString();
    const end = endOfMonth(new Date(monthStr + "-01")).toISOString();

    const [teamRes, activationsRes] = await Promise.all([
      context.supabase.from("employees").select("*").eq("manager_id" as any, data.managerId),
      context.supabase
        .from("extractions" as any)
        .select("id, employee_id, status, created_at")
        .eq("status", "success")
        .eq("is_duplicate", false)
        .gte("created_at", start)
        .lte("created_at", end),
    ]);

    const team = (teamRes.data ?? []) as any[];
    const allActivations = (activationsRes.data ?? []) as any[];
    const teamIds = new Set(team.map((m) => m.id));

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
  });

export const listEmployeeAdvances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { employeeId: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: advances, error } = await context.supabase
      .from("employees_advances" as any)
      .select("*")
      .eq("employee_id", data.employeeId)
      .order("payment_date", { ascending: false });
    if (error) throw new Error(error.message);
    return (advances ?? []) as any[];
  });

const advanceSchema = z.object({
  employee_id: z.string().uuid(),
  amount: z.number().positive(),
  repayment_amount: z.number().nonnegative().optional().nullable(),
  payment_date: z.string(),
  description: z.string().optional().nullable(),
  is_settled: z.boolean().optional(),
});

export const upsertEmployeeAdvance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.infer<typeof advanceSchema> & { id?: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { id, ...rest } = data;

    if (id) {
      const { data: row, error } = await context.supabase
        .from("employees_advances" as any)
        .update({ ...rest, workspace_id: wsId })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return { ok: true as const, row: row as any };
    } else {
      const { data: row, error } = await context.supabase
        .from("employees_advances" as any)
        .insert({ ...rest, workspace_id: wsId })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return { ok: true as const, row: row as any };
    }
  });

export const settleEmployeeAdvance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; settled: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { error } = await context.supabase
      .from("employees_advances" as any)
      .update({ 
        is_settled: data.settled,
        settled_at: data.settled ? new Date().toISOString() : null
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteEmployeeAdvance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { error } = await context.supabase
      .from("employees_advances" as any)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getEmployeeAdvancesSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { employeeId: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: advances, error } = await context.supabase
      .from("employees_advances" as any)
      .select("amount, repayment_amount, is_settled")
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
      activeCount: rows.filter(r => !r.is_settled).length
    };
  });

