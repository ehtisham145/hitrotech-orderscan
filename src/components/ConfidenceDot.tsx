import * as React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FIELD_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  avg?: number | null;
  perField?: Record<string, number> | null;
  className?: string;
};

function tone(v: number) {
  if (v >= 90) return { color: "bg-emerald-500", label: "High" };
  if (v >= 75) return { color: "bg-amber-500", label: "Medium" };
  return { color: "bg-rose-500", label: "Low" };
}

/**
 * Small colored dot showing overall OCR/extraction confidence for a row.
 * Hover reveals the top uncertain fields. Read-only.
 */
export function ConfidenceDot({ avg, perField, className }: Props) {
  const val = typeof avg === "number" && !isNaN(avg) ? Math.round(avg) : null;
  if (val === null) {
    return <span className={cn("inline-block w-2 h-2 rounded-full bg-muted-foreground/30", className)} aria-hidden />;
  }
  const t = tone(val);

  const uncertain = React.useMemo(() => {
    if (!perField) return [];
    return Object.entries(perField)
      .filter(([, v]) => typeof v === "number" && v > 0 && v < 90)
      .sort((a, b) => (a[1] as number) - (b[1] as number))
      .slice(0, 5)
      .map(([k, v]) => ({ field: k, value: v as number }));
  }, [perField]);

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn("inline-flex items-center gap-1 cursor-help", className)}
            aria-label={`Confidence ${val}% (${t.label})`}
          >
            <span className={cn("w-2 h-2 rounded-full", t.color)} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <div className="text-xs font-semibold mb-1">
            {t.label} confidence · {val}%
          </div>
          {uncertain.length > 0 ? (
            <>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Least certain fields</div>
              <ul className="text-xs space-y-0.5">
                {uncertain.map((u) => (
                  <li key={u.field} className="flex justify-between gap-3">
                    <span>{FIELD_LABELS[u.field as keyof typeof FIELD_LABELS] ?? u.field}</span>
                    <span className="tabular-nums text-muted-foreground">{Math.round(u.value)}%</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">All fields extracted with high confidence.</div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
