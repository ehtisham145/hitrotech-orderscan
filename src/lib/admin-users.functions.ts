// Admin-only server functions for managing workspace users.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import type { ServerContext } from "./server-context";

// BUG FIX: the query's error was discarded entirely (only `data` was
// destructured). A failed query already denied access either way (an empty
// roles list fails the admin check), so this wasn't a security hole — but a
// caller deserves "the role check failed" rather than being told they're
// simply not an admin.
async function assertAdmin(context: ServerContext) {
  const { data, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((r) => r.role);
  if (!roles.includes("admin") && !roles.includes("super_admin")) throw new Error("Forbidden: admin role required");
}

export async function deleteUsersCore(data: { userIds: string[] }, context: ServerContext) {
  await assertAdmin(context);

  // Refuse to delete self
  const targets = data.userIds.filter((id) => id !== context.userId);
  if (targets.length === 0) throw new Error("You cannot delete your own account.");

  const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");

  const errors: { userId: string; message: string }[] = [];
  for (const uid of targets) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (error) errors.push({ userId: uid, message: error.message });
  }

  return {
    deleted: targets.length - errors.length,
    skippedSelf: data.userIds.length - targets.length,
    errors,
  };
}

export const deleteUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ userIds: z.array(z.string().uuid()).min(1) }).parse(data))
  .handler(({ data, context }) => deleteUsersCore(data, context));
