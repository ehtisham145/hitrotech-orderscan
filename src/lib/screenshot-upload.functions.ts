import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import type { ServerContext } from "./server-context";

// Each handler is a plain `<name>Core(data, context)` function with a one-line
// createServerFn wrapper under it — see src/lib/server-context.ts for why.

export async function createScreenshotUploadCore(data: { batch_id: string; file_name: string }, context: ServerContext) {
  const batchId = String(data.batch_id ?? "").trim();
  const fileName = String(data.file_name ?? "").trim();
  if (!batchId || !fileName) throw new Error("Missing upload details");

  const { data: batch, error: batchError } = await context.supabase
    .from("batches")
    .select("id, created_by")
    .eq("id", batchId)
    .maybeSingle();
  if (batchError) throw new Error(batchError.message);
  if (!batch || batch.created_by !== context.userId) throw new Error("Batch not found");

  const rawExtension = fileName.split(".").pop()?.toLowerCase() ?? "jpg";
  const extension = /^(png|jpe?g|webp)$/.test(rawExtension) ? rawExtension : "jpg";
  const path = `${context.userId}/${batchId}/${crypto.randomUUID()}.${extension}`;

  const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
  const { data: upload, error: uploadError } = await supabaseAdmin.storage
    .from("screenshots")
    .createSignedUploadUrl(path);
  if (uploadError || !upload?.token) {
    throw new Error(uploadError?.message ?? "Could not authorize image upload");
  }

  return { path, token: upload.token };
}

export const createScreenshotUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { batch_id: string; file_name: string }) => input)
  .handler(({ data, context }) => createScreenshotUploadCore(data, context));
