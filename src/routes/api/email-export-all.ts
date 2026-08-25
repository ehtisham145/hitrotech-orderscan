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

type Filters = {
  batchId?: string | null;
  status?: string | null;
  network?: string | null;
  search?: string | null;
  activationFrom?: string | null;
  activationTo?: string | null;
};

export const Route = createFileRoute("/api/email-export-all")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authHeader = request.headers.get("authorization");
          const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
          if (!token || token === "undefined" || token === "null") return jsonError("Please sign in again", 401);

          const payload = (await request.json().catch(() => null)) as
            | { recipients?: unknown; filters?: Filters }
            | null;
          const recipients = Array.isArray(payload?.recipients) ? payload!.recipients : [];
          const filters: Filters = payload?.filters ?? {};

          const clean = Array.from(
            new Set(
              recipients
                .filter((r): r is string => typeof r === "string")
                .map((r) => r.trim().toLowerCase())
                .filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)),
            ),
          );
          if (clean.length === 0) return jsonError("Enter at least one valid email", 400);

          const SUPABASE_URL = process.env.EXT_SUPABASE_URL;
          const SUPABASE_KEY = process.env.EXT_SUPABASE_PUBLISHABLE_KEY;
          if (!SUPABASE_URL || !SUPABASE_KEY) return jsonError("Backend configuration is missing on this deployment");

          const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY } },
            auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
          });

          // Pull all matching rows in chunks (RLS scopes to this user).
          const all: Record<string, unknown>[] = [];
          const CHUNK = 1000;
          for (let offset = 0; ; offset += CHUNK) {
            let q = supabase
              .from("extractions")
              .select("*")
              .order("created_at", { ascending: false })
              .range(offset, offset + CHUNK - 1);

            if (filters.batchId && filters.batchId !== "all") q = q.eq("batch_id", filters.batchId);
            if (filters.status === "duplicate") q = q.eq("is_duplicate", true);
            else if (filters.status === "review") q = q.eq("needs_review", true);
            else if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
            if (filters.network && filters.network !== "all") q = q.eq("current_network", filters.network);
            if (filters.activationFrom) q = q.gte("activation_date_parsed", filters.activationFrom);
            if (filters.activationTo) q = q.lte("activation_date_parsed", filters.activationTo);

            const term = (filters.search ?? "").trim();
            if (term.length >= 2) {
              const safe = term.replace(/[%,]/g, " ");
              const cols = ["customer_name", "phone_number", "cnic", "order_number", "email", "reference", "branch_name", "employee_name"];
              q = q.or(cols.map((c) => `${c}.ilike.%${safe}%`).join(","));
            }

            const { data, error } = await q;
            if (error) return jsonError(error.message);
            if (!data || data.length === 0) break;
            all.push(...(data as Record<string, unknown>[]));
            if (data.length < CHUNK) break;
          }

          // Batch id → name map
          const batchIds = Array.from(new Set(all.map((r) => r.batch_id as string).filter(Boolean)));
          const batchMap = new Map<string, string>();
          if (batchIds.length > 0) {
            const { data: bs } = await supabase.from("batches").select("id, name").in("id", batchIds);
            (bs ?? []).forEach((b) => batchMap.set(b.id, b.name));
          }

          const exportRows = all.map((r, i) => ({
            "#": i + 1,
            Batch: batchMap.get(r.batch_id as string) ?? "",
            Date: (r.activation_date as string) ?? (r.created_at ? new Date(r.created_at as string).toISOString().slice(0, 10) : ""),
            "Order No": r.order_number ?? "",
            "Sim Type": r.sim_type ?? "",
            "Number Type": r.number_type ?? "",
            "Current/Onic Number": r.phone_number ?? "",
            "Current Network": r.current_network ?? "",
            Name: r.customer_name ?? "",
            Cnic: r.cnic ?? "",
            Package: r.package_name ?? r.plan_price ?? "",
            "Num Charges": r.number_charges ?? "",
            "Paid Via": r.paid_via ?? "",
            Discount: r.discount ?? "",
            Email: r.email ?? "",
            "Store ID": r.store_id ?? "",
            Reference: r.reference ?? "",
            Deposit: r.deposit ?? "",
            "Remaining Deposit": r.remaining_deposit ?? "",
            Remarks: r.remarks ?? "",
            "Plan Price": r.plan_price ?? "",
            "Activation Time": r.activation_time ?? "",
            "Employee Name": r.employee_name ?? "",
            "Branch Name": r.branch_name ?? "",
            Status: r.order_status ?? "",
            Duplicate: r.is_duplicate ? "YES" : "",
            "Needs Review": r.needs_review ? "YES" : "",
            "Extraction Status": r.status ?? "",
          }));

          const ws = XLSX.utils.json_to_sheet(exportRows.length ? exportRows : [{ "": "No rows" }]);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "Orders");
          const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
          const dateStr = new Date().toISOString().slice(0, 10);
          const safeName = `all-orders-${dateStr}.xlsx`;

          const resendKey =
            process.env.RESEND_API_KEY ||
            process.env.RESEND_API_KEY_2 ||
            process.env.RESEND_API_KEY_3 ||
            Object.entries(process.env).find(([name, value]) => /^RESEND_API_KEY(?:_\d+)?$/.test(name) && Boolean(value))?.[1];
          if (!resendKey) return jsonError("Email service is not configured on this deployment.");

          const subject = `All Orders Export — ${exportRows.length.toLocaleString()} rows`;
          const filterBits: string[] = [];
          if (filters.batchId && filters.batchId !== "all") filterBits.push(`Batch: ${escapeHtml(batchMap.get(filters.batchId) ?? filters.batchId)}`);
          if (filters.status && filters.status !== "all") filterBits.push(`Status: ${escapeHtml(filters.status)}`);
          if (filters.network && filters.network !== "all") filterBits.push(`Network: ${escapeHtml(filters.network)}`);
          if (filters.search && filters.search.trim().length >= 2) filterBits.push(`Search: ${escapeHtml(filters.search.trim())}`);
          const filterLine = filterBits.length > 0
            ? `<p style="margin:0 0 10px;color:#64748b;font-size:12px">Filters applied: ${filterBits.join(" · ")}</p>`
            : "";

          const html = `
            <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;padding:24px;color:#0f172a">
              <h2 style="margin:0 0 12px;font-size:18px">All Orders Export</h2>
              <p style="margin:0 0 12px;color:#475569">
                Your export is ready. It contains <strong>${exportRows.length.toLocaleString()}</strong> rows across ${batchIds.length.toLocaleString()} batch(es).
              </p>
              ${filterLine}
              <p style="margin:0;color:#94a3b8;font-size:12px">The Excel file is attached to this email.</p>
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
              attachments: [{ filename: safeName, content: Buffer.from(buf).toString("base64") }],
            }),
          });
          if (!res.ok) {
            const body = await res.text();
            return jsonError(`Email provider rejected the send (${res.status}): ${body}`);
          }

          return Response.json({ ok: true, emailed: clean.length, rows: exportRows.length });
        } catch (error) {
          console.error("[email-export-all]", error);
          return jsonError(error instanceof Error ? error.message : "Email export failed");
        }
      },
    },
  },
});
