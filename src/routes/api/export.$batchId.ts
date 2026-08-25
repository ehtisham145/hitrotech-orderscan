import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/api/export/$batchId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const authHeader = request.headers.get("authorization");
        const url = new URL(request.url);
        // Token is only accepted from the Authorization header — never from
        // the query string, which would leak into browser history, Referer,
        // and any intermediate proxy or access log.
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) return new Response("Unauthorized", { status: 401 });

        const SUPABASE_URL = process.env.EXT_SUPABASE_URL!;
        const SUPABASE_KEY = process.env.EXT_SUPABASE_PUBLISHABLE_KEY!;
        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY } },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });

        const { data: userData } = await supabase.auth.getUser(token);
        if (!userData?.user) return new Response("Unauthorized", { status: 401 });

        const { data: batch } = await supabase
          .from("batches")
          .select("*")
          .eq("id", params.batchId)
          .single();
        if (!batch) return new Response("Batch not found", { status: 404 });

        const filter = url.searchParams.get("filter") ?? "all";
        let query = supabase
          .from("extractions")
          .select("*")
          .eq("batch_id", params.batchId);
        if (filter === "success") query = query.eq("is_duplicate", false).in("status", ["success", "completed"]);
        else if (filter === "failed") query = query.eq("status", "failed");
        else if (filter === "duplicates") query = query.eq("is_duplicate", true);
        const { data: rows } = await query.order("created_at", { ascending: true });

        const exportRows = (rows ?? []).map((r, i) => ({
          "#": i + 1,
          "Date": r.activation_date ?? (r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : ""),
          "Order No": r.order_number,
          "Sim Type": (r as Record<string, unknown>).sim_type ?? "",
          "Number Type": (r as Record<string, unknown>).number_type ?? "",
          "Current/Onic Number": r.phone_number,
          "Current Network": r.current_network,
          "Name": r.customer_name,
          "Cnic": r.cnic,
          "Package": (r as Record<string, unknown>).package_name ?? r.plan_price ?? "",
          "Num Charges": r.number_charges,
          "Paid Via": r.paid_via,
          "Discount": r.discount,
          "Email": r.email,
          "Store ID": r.store_id,
          "Reference": r.reference,
          "Deposit": r.deposit,
          "Remaining Deposit": r.remaining_deposit,
          "Remarks": r.remarks,
          "Batch": batch.name,
          "Plan Price": r.plan_price,
          "Activation Time": r.activation_time,
          "Employee Name": r.employee_name,
          "Branch Name": r.branch_name,
          "Status": r.order_status,
          "OCR Confidence": r.avg_confidence ? `${Math.round(Number(r.avg_confidence))}%` : "",
          "Duplicate": r.is_duplicate ? "YES" : "",
          "Extraction Status": r.status,
        }));

        const ws = XLSX.utils.json_to_sheet(exportRows);
        // Auto-fit columns
        const cols = Object.keys(exportRows[0] ?? { x: "" }).map((k) => ({
          wch: Math.min(
            40,
            Math.max(k.length + 2, ...exportRows.map((r) => String((r as Record<string, unknown>)[k] ?? "").length)),
          ),
        }));
        ws["!cols"] = cols;
        ws["!freeze"] = { xSplit: 0, ySplit: 1 };
        if (exportRows.length > 0) {
          ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: Object.keys(exportRows[0]).length - 1, r: exportRows.length } }) };
        }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Orders");
        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

        const safeName = batch.name.replace(/[^a-z0-9-_]/gi, "_");
        return new Response(buf, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="${safeName}.xlsx"`,
          },
        });
      },
    },
  },
});
