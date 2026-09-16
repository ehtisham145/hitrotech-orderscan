import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

// A generous safety cap, not a real product limit — matches MAX_FILES in
// batches.new.tsx. That client-side check is the friendlier, faster one;
// this is the one that actually can't be bypassed (a direct call to this
// server function skips the UI entirely). See its comment for why this
// number: an oversized batch floods the OCR/AI pipeline's per-minute rate
// limits far worse than a normal bulk upload does.
const MAX_BATCH_FILES = 150;

const inputSchema = z.object({
  name: z.string().min(1),
  workspace_id: z.string().uuid(),
  files: z.array(z.object({
    name: z.string(),
    type: z.string(),
  })).max(MAX_BATCH_FILES, `A single batch can have at most ${MAX_BATCH_FILES} images — split this into smaller batches.`),
  defaults: z.object({
    store_id: z.string().optional().nullable(),
    employee_name: z.string().optional().nullable(),
    branch_name: z.string().optional().nullable(),
    partner_id: z.string().optional().nullable(),
  }),
});

type ServerContext = { supabase: SupabaseClient<Database>; userId: string };

// Handler logic pulled out of createServerFn(...).handler() so it's callable
// directly from Vitest without a real HTTP request — see queue.functions.ts's
// identical comment for why (requireSupabaseAuth needs a real request).
export async function createBatchWithExtractionsCore(data: z.infer<typeof inputSchema>, context: ServerContext) {
    const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
    const userId = context.userId;

    // 1. Verify workspace access (as user)
    const { data: workspace, error: workspaceErr } = await context.supabase
      .from("workspaces")
      .select("id")
      .eq("id", data.workspace_id)
      .maybeSingle();

    if (workspaceErr || !workspace) {
      throw new Error("Workspace not found or access denied");
    }

    // 2. Create batch (as admin)
    const { data: batch, error: batchErr } = await supabaseAdmin
      .from("batches")
      .insert({
        name: data.name,
        created_by: userId,
        workspace_id: data.workspace_id,
        total_images: data.files.length,
        status: "uploading",
        default_store_id: data.defaults.store_id || null,
        default_employee_name: data.defaults.employee_name || null,
        default_branch_name: data.defaults.branch_name || null,
      })
      .select()
      .single();

    if (batchErr || !batch) {
      console.error("[createBatchWithExtractions] Batch creation failed:", batchErr);
      throw new Error(`Failed to create batch: ${batchErr?.message || "Unknown error"}`);
    }

    // 3. Create extractions and signed upload URLs (as admin)
    const extractions = [];
    const uploadTokens = [];

    for (const file of data.files) {
      const rawExtension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const extension = /^(png|jpe?g|webp|heic|heif|pdf)$/.test(rawExtension) ? rawExtension : "jpg";
      const storagePath = `${userId}/${batch.id}/${crypto.randomUUID()}.${extension}`;

      // Insert record
      const { data: extraction, error: extErr } = await supabaseAdmin
        .from("extractions")
        .insert({
          batch_id: batch.id,
          created_by: userId,
          workspace_id: data.workspace_id,
          storage_path: storagePath,
          file_name: file.name,
          status: "pending",
          store_id: data.defaults.store_id || null,
          employee_name: data.defaults.employee_name || null,
          branch_name: data.defaults.branch_name || null,
          partner_id: data.defaults.partner_id || null,
        })
        .select("id")
        .single();

      if (extErr || !extraction) {
        console.error("[createBatchWithExtractions] Extraction record failed:", extErr);
        // We continue for other files but log the error
        continue;
      }

      // Create signed URL
      const { data: upload, error: uploadError } = await supabaseAdmin.storage
        .from("screenshots")
        .createSignedUploadUrl(storagePath);

      if (uploadError || !upload?.token) {
        console.error("[createBatchWithExtractions] Storage authorization failed:", uploadError);
        continue;
      }

      extractions.push({ id: extraction.id, fileName: file.name, path: storagePath });
      uploadTokens.push({ fileName: file.name, path: storagePath, token: upload.token });
    }

    if (extractions.length === 0) {
      // Clean up failed batch
      await supabaseAdmin.from("batches").update({ status: "failed" }).eq("id", batch.id);
      throw new Error("Failed to initialize any extraction records");
    }

    return {
      batchId: batch.id,
      extractions,
      uploadTokens,
    };
}

export const createBatchWithExtractions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => inputSchema.parse(data))
  .handler(({ data, context }) => createBatchWithExtractionsCore(data, context));