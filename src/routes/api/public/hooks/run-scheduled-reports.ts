import { createFileRoute } from "@tanstack/react-router";
import * as XLSX from "xlsx";

type Filters = {
  from?: string;
  to?: string;
  batchIds?: string[];
  status?: string;
  network?: string;
  branch?: string;
  needsReview?: boolean;
  duplicatesOnly?: boolean;
};

function nextRunAt(cadence: string, from: Date): Date {
  const d = new Date(from);
  if (cadence === "hourly") d.setHours(d.getHours() + 1);
  else if (cadence === "daily") d.setDate(d.getDate() + 1);
  else if (cadence === "weekly") d.setDate(d.getDate() + 7);
  return d;
}

async function sendReportEmail(opts: {
  recipients: string[];
  scheduleName: string;
  rowCount: number;
  signedUrl: string;
  fromDomain?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "Email service not configured" };
  const from = "HitroTech OrderScan <o.scan@orders.hitrotech.com>";
  const subject = `${opts.scheduleName} — ${opts.rowCount.toLocaleString()} rows`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 12px;font-size:18px">${opts.scheduleName}</h2>
      <p style="margin:0 0 16px;color:#475569">
        Your scheduled report is ready. It contains
        <strong>${opts.rowCount.toLocaleString()}</strong> rows.
      </p>
      <p style="margin:0 0 24px">
        <a href="${opts.signedUrl}"
           style="display:inline-block;background:#0f172a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">
          Download Excel
        </a>
      </p>
      <p style="margin:0;color:#94a3b8;font-size:12px">
        This download link expires in 7 days. Generated automatically — do not reply.
      </p>
    </div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to: opts.recipients, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `Resend ${res.status}: ${body}` };
  }
  return { ok: true };
}

async function runOne(
  supabaseAdmin: any,
  schedule: { id: string; user_id: string; name: string; view_id: string; cadence: string; recipients: string[] | null },
): Promise<{ id: string; ok: boolean; rows?: number; emailed?: number; error?: string }> {
  try {
    const { data: view, error: viewErr } = await supabaseAdmin
      .from("report_views")
      .select("filters")
      .eq("id", schedule.view_id)
      .single();
    if (viewErr || !view) throw new Error(viewErr?.message || "view not found");

    const f = (view.filters ?? {}) as Filters;
    let q = supabaseAdmin.from("extractions").select("*").order("created_at", { ascending: false }).limit(50000);
    if (f.from) q = q.gte("created_at", new Date(f.from).toISOString());
    if (f.to) {
      const to = new Date(f.to);
      to.setDate(to.getDate() + 1);
      q = q.lt("created_at", to.toISOString());
    }
    if (f.batchIds && f.batchIds.length > 0) q = q.in("batch_id", f.batchIds);
    if (f.status && f.status !== "all") q = q.eq("order_status", f.status);
    if (f.network && f.network !== "all") q = q.eq("current_network", f.network);
    if (f.branch && f.branch !== "all") q = q.eq("branch_name", f.branch);
    if (f.needsReview) q = q.eq("needs_review", true);
    if (f.duplicatesOnly) q = q.eq("is_duplicate", true);

    const { data: rows, error: rowsErr } = await q;
    if (rowsErr) throw new Error(rowsErr.message);

    const { data: batches } = await supabaseAdmin.from("batches").select("id, name");
    const batchNameById = new Map<string, string>((batches ?? []).map((b: any) => [b.id, b.name]));

    const exportRows = (rows ?? []).map((r: any, i: number) => ({
      "#": i + 1,
      Date: r.activation_date ?? (r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : ""),
      "Order No": r.order_number,
      "Sim Type": r.sim_type ?? "",
      "Number Type": r.number_type ?? "",
      "Current/Onic Number": r.phone_number,
      "Current Network": r.current_network,
      Name: r.customer_name,
      Cnic: r.cnic,
      Package: r.package_name ?? r.plan_price ?? "",
      "Num Charges": r.number_charges,
      "Paid Via": r.paid_via,
      Discount: r.discount,
      Email: r.email,
      "Store ID": r.store_id,
      Reference: r.reference,
      Deposit: r.deposit,
      "Remaining Deposit": r.remaining_deposit,
      Remarks: r.remarks,
      Batch: batchNameById.get(r.batch_id) ?? "",
      "Plan Price": r.plan_price,
      "Activation Time": r.activation_time,
      "Employee Name": r.employee_name,
      "Branch Name": r.branch_name,
      Status: r.order_status,
      Duplicate: r.is_duplicate ? "YES" : "",
      "Needs Review": r.needs_review ? "YES" : "",
      Created: r.created_at,
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows.length ? exportRows : [{ "": "No rows" }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const safe = schedule.name.replace(/[^a-z0-9-_]/gi, "_");
    const path = `${schedule.user_id}/${schedule.id}/${stamp}-${safe}.xlsx`;

    const { error: upErr } = await supabaseAdmin.storage.from("reports").upload(path, buf, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
    if (upErr) throw new Error(upErr.message);

    await supabaseAdmin.from("generated_reports").insert({
      scheduled_report_id: schedule.id,
      user_id: schedule.user_id,
      name: `${schedule.name} — ${now.toISOString().slice(0, 16).replace("T", " ")}`,
      storage_path: path,
      row_count: exportRows.length,
    });

    await supabaseAdmin
      .from("scheduled_reports")
      .update({ last_run_at: now.toISOString(), next_run_at: nextRunAt(schedule.cadence, now).toISOString() })
      .eq("id", schedule.id);

    let emailed = 0;
    let emailError: string | undefined;
    const recipients = (schedule.recipients ?? []).filter((r) => r && r.includes("@"));
    if (recipients.length > 0) {
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from("reports")
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      if (signErr || !signed?.signedUrl) {
        emailError = signErr?.message ?? "signed url failed";
      } else {
        const sent = await sendReportEmail({
          recipients,
          scheduleName: schedule.name,
          rowCount: exportRows.length,
          signedUrl: signed.signedUrl,
        });
        if (sent.ok) emailed = recipients.length;
        else emailError = sent.error;
      }
    }

    return { id: schedule.id, ok: true, rows: exportRows.length, emailed, error: emailError };
  } catch (err) {
    return { id: schedule.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const Route = createFileRoute("/api/public/hooks/run-scheduled-reports")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyHmacSignature, rateLimit, getClientIp } = await import(
          "@/lib/webhook-security.server"
        );

        // Rate limit per source IP — best-effort burst protection.
        const ip = getClientIp(request);
        const rl = rateLimit({ key: `hooks:run-scheduled-reports:${ip}`, capacity: 10, refillPerSec: 1 });
        if (!rl.ok) {
          return new Response("Too Many Requests", {
            status: 429,
            headers: { "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)) },
          });
        }

        // Optional HMAC verification. If WEBHOOK_SIGNING_SECRET is set, callers
        // must sign the raw body with sha256; otherwise verification is skipped
        // (backwards compatible with existing cron config).
        const rawBody = await request.text();
        const sig = request.headers.get("x-signature") || request.headers.get("x-hub-signature-256");
        const check = verifyHmacSignature({
          rawBody,
          header: sig,
          secret: process.env.WEBHOOK_SIGNING_SECRET,
        });
        if (!check.ok) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
        const { data: due, error } = await supabaseAdmin
          .from("scheduled_reports")
          .select("id, user_id, name, view_id, cadence, recipients")
          .eq("enabled", true)
          .lte("next_run_at", new Date().toISOString())
          .limit(50);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const results = [] as Awaited<ReturnType<typeof runOne>>[];
        for (const s of due ?? []) {
          results.push(await runOne(supabaseAdmin, s as any));
        }
        return Response.json({ processed: results.length, results });
      },
    },
  },
});
