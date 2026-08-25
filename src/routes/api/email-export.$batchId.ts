import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import * as XLSX from "xlsx";

function jsonError(error: string, status = 500) {
  return Response.json({ error }, { status });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const Route = createFileRoute("/api/email-export/$batchId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const authHeader = request.headers.get("authorization");
          const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
          if (!token || token === "undefined" || token === "null") return jsonError("Please sign in again", 401);

          const payload = (await request.json().catch(() => null)) as { recipients?: unknown } | null;
          const recipients = Array.isArray(payload?.recipients) ? payload.recipients : [];
          const clean = Array.from(
            new Set(
              recipients
                .filter((r): r is string => typeof r === "string")
                .map((r) => r.trim().toLowerCase())
                .filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)),
            ),
          );
          if (clean.length === 0) return jsonError("Enter at least one valid email", 400);

          const SUPABASE_URL = process.env.EXT_SUPABASE_URL || import.meta.env.VITE_EXT_SUPABASE_URL;
          const SUPABASE_KEY = process.env.EXT_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_EXT_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_EXT_SUPABASE_PUBLISHABLE_KEY;
          if (!SUPABASE_URL || !SUPABASE_KEY) return jsonError("Backend configuration is missing on this deployment");

          const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY } },
            auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
          });

          const { data: userData, error: userError } = await supabase.auth.getUser(token);
          if (userError || !userData?.user) return jsonError("Please sign in again", 401);

          const { data: batch, error: batchError } = await supabase.from("batches").select("*").eq("id", params.batchId).single();
          if (batchError || !batch) return jsonError("Batch not found", 404);

          const { data: rows, error: rowsError } = await supabase
            .from("extractions")
            .select("*")
            .eq("batch_id", params.batchId)
            .order("created_at", { ascending: true });
          if (rowsError) return jsonError(rowsError.message);

          const exportRows = (rows ?? []).map((r, i) => ({
            "#": i + 1,
            Date: r.activation_date ?? (r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : ""),
            "Order No": r.order_number,
            "Sim Type": (r as Record<string, unknown>).sim_type ?? "",
            "Number Type": (r as Record<string, unknown>).number_type ?? "",
            "Current/Onic Number": r.phone_number,
            "Current Network": r.current_network,
            Name: r.customer_name,
            Cnic: r.cnic,
            Package: (r as Record<string, unknown>).package_name ?? r.plan_price ?? "",
            "Num Charges": r.number_charges,
            "Paid Via": r.paid_via,
            Discount: r.discount,
            Email: r.email,
            "Store ID": r.store_id,
            Reference: r.reference,
            Deposit: r.deposit,
            "Remaining Deposit": r.remaining_deposit,
            Remarks: r.remarks,
            Batch: batch.name,
            "Plan Price": r.plan_price,
            "Activation Time": r.activation_time,
            "Employee Name": r.employee_name,
            "Branch Name": r.branch_name,
            Status: r.order_status,
          }));

          const ws = XLSX.utils.json_to_sheet(exportRows.length ? exportRows : [{ "": "No rows" }]);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "Orders");
          const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
          const safeName = `${batch.name.replace(/[^a-z0-9-_]/gi, "_") || "orders"}.xlsx`;

          const resendKey =
            process.env.RESEND_API_KEY ||
            process.env.RESEND_API_KEY_2 ||
            process.env.RESEND_API_KEY_3 ||
            Object.entries(process.env).find(([name, value]) => /^RESEND_API_KEY(?:_\d+)?$/.test(name) && Boolean(value))?.[1];
          if (!resendKey) return jsonError("Email service is not configured on this deployment.");

          const batchName = escapeHtml(batch.name);
          const subject = `${batch.name} — ${exportRows.length.toLocaleString()} rows`;
          const html = `
            <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;padding:24px;color:#0f172a">
              <h2 style="margin:0 0 12px;font-size:18px">${batchName}</h2>
              <p style="margin:0 0 16px;color:#475569">
                Your batch export is ready. It contains
                <strong>${exportRows.length.toLocaleString()}</strong> rows.
              </p>
              <p style="margin:0;color:#94a3b8;font-size:12px">
                The Excel file is attached to this email.
              </p>
            </div>`;

          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${resendKey}`,
            },
            body: JSON.stringify({
              from: "HitroTech OrderScan <o.scan@orders.hitrotech.com>",
              to: clean,
              subject,
              html,
              attachments: [
                {
                  filename: safeName,
                  content: Buffer.from(buf).toString("base64"),
                },
              ],
            }),
          });
          if (!res.ok) {
            const body = await res.text();
            return jsonError(`Email provider rejected the send (${res.status}): ${body}`);
          }

          return Response.json({ ok: true, emailed: clean.length, rows: exportRows.length });
        } catch (error) {
          console.error("[email-export]", error);
          return jsonError(error instanceof Error ? error.message : "Email export failed");
        }
      },
    },
  },
});
