// Admin-only server functions for managing workspace users.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";

async function assertAdmin(context: {
  supabase: { from: (t: string) => { select: (c: string) => { eq: (col: string, v: string) => Promise<{ data: { role: string }[] | null }> } } };
  userId: string;
}) {
  const { data } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
  const roles = (data ?? []).map((r) => r.role);
  if (!roles.includes("admin") && !roles.includes("super_admin")) throw new Error("Forbidden: admin role required");
}

export const deleteUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ userIds: z.array(z.string().uuid()).min(1) }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);

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
  });
