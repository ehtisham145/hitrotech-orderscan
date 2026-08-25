import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/ext-client";

type Row = {
  id: string;
  batch_id: string | null;
  customer_name: string | null;
  phone_number: string | null;
  cnic: string | null;
  order_number: string | null;
  created_at: string;
};

type Props = {
  extraction: Row & { is_duplicate?: boolean | null; duplicate_of?: string | null };
};

const MATCH_FIELDS: (keyof Row)[] = ["cnic", "phone_number", "order_number"];

/**
 * Clickable "Dup" badge. On open, fetches the matched original extraction
 * (via extractions.duplicate_of, falling back to a first-match search on
 * CNIC / phone / order#) and shows which field(s) collided. Read-only.
 */
export function DuplicateBadge({ extraction }: Props) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [match, setMatch] = React.useState<Row | null>(null);
  const [matchedFields, setMatchedFields] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const findMatch = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Prefer explicit link
      if (extraction.duplicate_of) {
        const { data } = await supabase
          .from("extractions")
          .select("id, batch_id, customer_name, phone_number, cnic, order_number, created_at")
          .eq("id", extraction.duplicate_of)
          .maybeSingle();
        if (data) {
          setMatch(data as Row);
          setMatchedFields(
            MATCH_FIELDS.filter((f) => {
              const a = (extraction[f] ?? "").toString().trim().toLowerCase();
              const b = (data[f as keyof typeof data] ?? "").toString().trim().toLowerCase();
              return a && b && a === b;
            }) as string[],
          );
          return;
        }
      }
      // 2. Search by matching identifiers, oldest first (that's the "original")
      const clauses: string[] = [];
      MATCH_FIELDS.forEach((f) => {
        const v = (extraction[f] ?? "").toString().trim();
        if (v) clauses.push(`${f}.eq.${v.replace(/,/g, "")}`);
      });
      if (clauses.length === 0) {
        setMatch(null);
        return;
      }
      const { data } = await supabase
        .from("extractions")
        .select("id, batch_id, customer_name, phone_number, cnic, order_number, created_at")
        .neq("id", extraction.id)
        .eq("is_duplicate", false)
        .or(clauses.join(","))
        .order("created_at", { ascending: true })
        .limit(1);
      const first = (data ?? [])[0] as Row | undefined;
      if (first) {
        setMatch(first);
        setMatchedFields(
          MATCH_FIELDS.filter((f) => {
            const a = (extraction[f] ?? "").toString().trim().toLowerCase();
            const b = (first[f] ?? "").toString().trim().toLowerCase();
            return a && b && a === b;
          }) as string[],
        );
      } else {
        setMatch(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load match");
    } finally {
      setLoading(false);
    }
  }, [extraction]);

  React.useEffect(() => {
    if (open && !match && !loading) void findMatch();
  }, [open, match, loading, findMatch]);

  const fieldLabel = (f: string) =>
    f === "cnic" ? "CNIC" : f === "phone_number" ? "Phone" : f === "order_number" ? "Order #" : f;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="View duplicate match details">
          <Badge
            variant="outline"
            className="border-amber-500/40 text-amber-700 hover:bg-amber-50 cursor-pointer dark:hover:bg-amber-950/30 rounded-2xl"
          >
            <Copy className="w-3 h-3 mr-0.5" />
            Dup
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 rounded-2xl" align="start">
        <div className="text-sm font-semibold mb-1">Duplicate match</div>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Looking up original…
          </div>
        ) : error ? (
          <div className="text-xs text-destructive">{error}</div>
        ) : !match ? (
          <div className="text-xs text-muted-foreground">
            Flagged as duplicate, but the original record could not be located. It may have been deleted.
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground mb-2">
              Matched on{" "}
              {matchedFields.length > 0
                ? matchedFields.map((f, i) => (
                    <React.Fragment key={f}>
                      <span className="font-medium text-foreground">{fieldLabel(f)}</span>
                      {i < matchedFields.length - 1 ? ", " : ""}
                    </React.Fragment>
                  ))
                : "customer identifier"}
              .
            </div>
            <div className="rounded-2xl border p-2 text-xs space-y-1 bg-muted/30">
              <div>
                <span className="text-muted-foreground">Customer:</span>{" "}
                <span className="font-medium">{match.customer_name || "—"}</span>
              </div>
              {matchedFields.includes("cnic") && (
                <div>
                  <span className="text-muted-foreground">CNIC:</span> <span className="font-mono">{match.cnic}</span>
                </div>
              )}
              {matchedFields.includes("phone_number") && (
                <div>
                  <span className="text-muted-foreground">Phone:</span>{" "}
                  <span className="font-mono">{match.phone_number}</span>
                </div>
              )}
              {matchedFields.includes("order_number") && (
                <div>
                  <span className="text-muted-foreground">Order #:</span>{" "}
                  <span className="font-mono">{match.order_number}</span>
                </div>
              )}
              <div className="text-[10px] text-muted-foreground pt-1">
                Original imported {new Date(match.created_at).toLocaleString()}
              </div>
            </div>
            {match.batch_id && (
              <Button asChild size="sm" variant="ghost" className="w-full mt-2 h-7 text-xs">
                <Link to="/batches/$id" params={{ id: match.batch_id }}>
                  Open original batch <ExternalLink className="w-3 h-3 ml-1" />
                </Link>
              </Button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
