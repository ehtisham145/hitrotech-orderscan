import { RefreshCw, Loader2, FileText, BrainCircuit, PauseCircle, XCircle, AlertTriangle, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DuplicateBadge } from "@/components/DuplicateBadge";

export function StatusBadge({ row, onRetry }: { row: any; onRetry: () => void }) {
  if (row.status === "pending") return <Badge variant="secondary" className="bg-muted text-muted-foreground border-none rounded-2xl"><RefreshCw className="w-3 h-3 mr-1 animate-spin-slow" /> Queued</Badge>;
  if (row.status === "processing") return <Badge variant="secondary" className="bg-primary/10 text-primary border-none animate-pulse rounded-2xl"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Processing</Badge>;
  if (row.status === "ocr_completed") return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-none rounded-2xl"><FileText className="w-3 h-3 mr-1" /> OCR Done</Badge>;
  if (row.status === "extracting") return <Badge variant="secondary" className="bg-purple-500/10 text-purple-600 border-none rounded-2xl"><BrainCircuit className="w-3 h-3 mr-1 animate-pulse" /> AI Extracting</Badge>;
  if (row.status === "paused") return <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50 rounded-2xl"><PauseCircle className="w-3 h-3 mr-1" /> Paused</Badge>;
  if (row.status === "cancelled") return <Badge variant="outline" className="text-muted-foreground border-muted rounded-2xl"><XCircle className="w-3 h-3 mr-1" /> Cancelled</Badge>;
  if (row.status === "failed")
    return (
      <div className="flex items-center gap-1">
        <Badge variant="destructive" title={row.error_message ?? undefined} className="border-none rounded-2xl"><AlertTriangle className="w-3 h-3 mr-1" /> Failed</Badge>
        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={onRetry} aria-label="Retry extraction"><RefreshCw className="w-3 h-3" /></Button>
      </div>
    );
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400 rounded-2xl">OK</Badge>
      {row.is_duplicate && (
        <DuplicateBadge
          extraction={{
            id: row.id,
            batch_id: row.batch_id,
            customer_name: row.customer_name ?? null,
            phone_number: row.phone_number ?? null,
            cnic: row.cnic ?? null,
            order_number: row.order_number ?? null,
            created_at: row.created_at ?? new Date().toISOString(),
            is_duplicate: row.is_duplicate,
            duplicate_of: row.duplicate_of ?? null,
          }}
        />
      )}
      {row.needs_review && <Badge variant="outline" className="border-yellow-500/40 text-yellow-700 rounded-2xl"><AlertTriangle className="w-3 h-3 mr-0.5" />Review</Badge>}
      {row.raw_response?.ocrUsed === false && (
        <Badge
          variant="outline"
          title="OCR was unavailable for this image — it went straight to the AI model instead. Not an error, just a sign OCR is under load."
          className="border-slate-400/40 text-slate-500 rounded-2xl"
        >
          <ImageOff className="w-3 h-3 mr-0.5" />No OCR
        </Badge>
      )}
    </div>
  );
}
