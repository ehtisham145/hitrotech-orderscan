import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, Pencil, Check, X, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import {
  listPartnerSlabs,
  upsertSlab,
  deleteSlab,
  type SlabInput,
} from "@/lib/commission.functions";
import { effectiveLabel, slabsEffectiveOn } from "@/lib/brand-slabs";
import { findSlabConflict, type SlabLike } from "@/lib/slab-validation";
import { useActivationTypes } from "@/components/ActivationTypesCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PartnerRole } from "@/lib/partners.functions";

type Row = SlabInput & { id: string; partner_id: string | null };

const today = () => new Date().toISOString().slice(0, 10);
const day = (v?: string | null) => (v ? v.slice(0, 10) : null);
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Two ranges overlap if start_a <= end_b AND start_b <= end_a (treating null max as +∞). */
function rangesOverlap(aMin: number, aMax: number | null, bMin: number, bMax: number | null) {
  const aHi = aMax ?? Number.POSITIVE_INFINITY;
  const bHi = bMax ?? Number.POSITIVE_INFINITY;
  return aMin <= bHi && bMin <= aHi;
}

/** Date windows overlap (null from = -∞, null to = +∞). */
function datesOverlap(
  aFrom: string | null,
  aTo: string | null,
  bFrom: string | null,
  bTo: string | null,
) {
  const aLo = aFrom ?? "0000-01-01";
  const aHi = aTo ?? "9999-12-31";
  const bLo = bFrom ?? "0000-01-01";
  const bHi = bTo ?? "9999-12-31";
  return aLo <= bHi && bLo <= aHi;
}

type Draft = {
  min_count: number;
  max_count: number | null;
  rate_pkr: number;
  activation_type_id: string | null;
  effective_from: string | null;
  effective_to: string | null;
};

const ALL_TYPES = "__all__";

function validateSlab(d: Draft, existing: Row[], ignoreId?: string): string | null {
  return findSlabConflict({ ...d, id: ignoreId }, existing as SlabLike[]);
}

function windowKey(r: Row) {
  return `${day(r.effective_from) ?? ""}|${day(r.effective_to) ?? ""}`;
}

export function PartnerSlabsEditor({
  partnerId,
  role,
}: {
  partnerId: string;
  role: PartnerRole;
}) {
  const qc = useQueryClient();
  const fetchPartnerSlabs = useServerFn(listPartnerSlabs);
  const doUpsert = useServerFn(upsertSlab);
  const doDelete = useServerFn(deleteSlab);

  const partnerKey = ["partner-slabs", partnerId];

  const { data: partnerSlabs, isLoading } = useQuery({
    queryKey: partnerKey,
    queryFn: () => fetchPartnerSlabs({ data: { partner_id: partnerId } }),
  });

  const save = useMutation({
    mutationFn: (row: SlabInput) => doUpsert({ data: { ...row, partner_id: partnerId, role } }),
    onSuccess: () => {
      toast.success("Slab saved");
      qc.invalidateQueries({ queryKey: partnerKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => doDelete({ data: { id } }),
    onSuccess: () => {
      toast.success("Slab removed");
      qc.invalidateQueries({ queryKey: partnerKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: activationTypes } = useActivationTypes();
  const typeName = (id?: string | null) =>
    (activationTypes ?? []).find((t) => t.id === id)?.name ?? null;

  const [draft, setDraft] = useState<Draft>({
    min_count: 1,
    max_count: null,
    rate_pkr: 500,
    activation_type_id: null,
    effective_from: null,
    effective_to: null,
  });
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [repriceFrom, setRepriceFrom] = useState<string>(today());
  const [repricing, setRepricing] = useState(false);

  const rows = ((partnerSlabs ?? []) as Row[])
    .slice()
    .sort(
      (a, b) =>
        (day(a.effective_from) ?? "0000-01-01").localeCompare(day(b.effective_from) ?? "0000-01-01") ||
        a.min_count - b.min_count,
    );

  const liveRows = slabsEffectiveOn(rows, today());

  // Group rows by their validity window so periods read clearly.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = windowKey(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const handleAdd = () => {
    const err = validateSlab(draft, rows);
    if (err) {
      toast.error(err);
      return;
    }
    save.mutate(
      {
        role,
        min_count: draft.min_count,
        max_count: draft.max_count,
        rate_pkr: draft.rate_pkr,
        activation_type_id: draft.activation_type_id,
        effective_from: draft.effective_from,
        effective_to: draft.effective_to,
        active: true,
      },
      {
        onSuccess: () =>
          setDraft({ min_count: 1, max_count: null, rate_pkr: 500, activation_type_id: null, effective_from: null, effective_to: null }),
      },
    );
  };

  /**
   * Close the currently-live slabs the day before `repriceFrom` and clone them
   * into a new open-ended period, so historical months keep their old rates.
   */
  const startNewPeriod = async () => {
    if (liveRows.length === 0) {
      toast.error("There are no active slabs to carry forward.");
      return;
    }
    if (liveRows.some((r) => day(r.effective_from) && day(r.effective_from)! >= repriceFrom)) {
      toast.error("Pick a start date after the current period's start date.");
      return;
    }
    setRepricing(true);
    try {
      const closeOn = addDays(repriceFrom, -1);
      for (const r of liveRows) {
        await doUpsert({
          data: {
            id: r.id,
            role,
            partner_id: partnerId,
            min_count: r.min_count,
            max_count: r.max_count,
            rate_pkr: r.rate_pkr,
            active: r.active,
            effective_from: day(r.effective_from),
            effective_to: closeOn,
          },
        });
      }
      for (const r of liveRows) {
        await doUpsert({
          data: {
            role,
            partner_id: partnerId,
            min_count: r.min_count,
            max_count: r.max_count,
            rate_pkr: r.rate_pkr,
            active: true,
            effective_from: repriceFrom,
            effective_to: null,
          },
        });
      }
      toast.success(`New rate period started ${repriceFrom} — edit the rates below.`);
      qc.invalidateQueries({ queryKey: partnerKey });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRepricing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Commission slabs</CardTitle>
        <p className="text-xs text-muted-foreground">
          Add activation ranges and the PKR rate this partner earns per activation. Leave the dates blank
          for rates that have always applied; set them when a rate changes mid-relationship so past months
          keep their original pricing.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Add row */}
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Add slab for this partner</div>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1.2fr_1fr_1fr_auto] md:items-end">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Min</div>
              <Input
                type="number"
                min={1}
                value={Number.isFinite(draft.min_count) ? draft.min_count : ""}
                onChange={(e) =>
                  setDraft({ ...draft, min_count: e.target.value === "" ? NaN : parseInt(e.target.value, 10) })
                }
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Max (blank = ∞)</div>
              <Input
                type="number"
                value={draft.max_count ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, max_count: e.target.value ? parseInt(e.target.value, 10) : null })
                }
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Rate (PKR)</div>
              <Input
                type="number"
                min={0}
                value={Number.isFinite(draft.rate_pkr) ? draft.rate_pkr : ""}
                onChange={(e) =>
                  setDraft({ ...draft, rate_pkr: e.target.value === "" ? NaN : parseInt(e.target.value, 10) })
                }
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Activation type</div>
              <Select
                value={draft.activation_type_id ?? ALL_TYPES}
                onValueChange={(v) => setDraft({ ...draft, activation_type_id: v === ALL_TYPES ? null : v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TYPES}>All types</SelectItem>
                  {(activationTypes ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Effective from</div>
              <Input
                type="date"
                value={draft.effective_from ?? ""}
                onChange={(e) => setDraft({ ...draft, effective_from: e.target.value || null })}
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Effective to</div>
              <Input
                type="date"
                value={draft.effective_to ?? ""}
                onChange={(e) => setDraft({ ...draft, effective_to: e.target.value || null })}
              />
            </div>
            <Button onClick={handleAdd} disabled={save.isPending}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>
        </div>

        {/* Reprice helper */}
        {liveRows.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed p-3">
            <CalendarClock className="mb-2 h-4 w-4 text-muted-foreground" />
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Start a new rate period from</div>
              <Input
                type="date"
                className="w-44"
                value={repriceFrom}
                onChange={(e) => setRepriceFrom(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={startNewPeriod} disabled={repricing}>
              Carry forward &amp; reprice
            </Button>
            <p className="basis-full text-xs text-muted-foreground">
              Closes the current slabs the day before and copies them into a new period you can edit —
              statements for earlier months stay on the old rates.
            </p>
          </div>
        )}

        {/* Existing rows */}
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Slabs ({rows.length})</div>
          {isLoading ? (
            <Skeleton className="h-20" />
          ) : rows.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
              No slabs yet — add one above.
            </div>
          ) : (
            <div className="space-y-4">
              {Array.from(groups.entries()).map(([key, groupRows]) => {
                const isLive = slabsEffectiveOn(groupRows, today()).length > 0;
                return (
                  <div key={key}>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-medium">{effectiveLabel(groupRows[0])}</span>
                      {isLive ? (
                        <Badge variant="secondary" className="text-[10px]">
                          Current
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          Historical
                        </Badge>
                      )}
                    </div>
                    <div className="divide-y rounded-md border">
                      {groupRows.map((r) => (
                        <SlabRow
                          key={r.id}
                          row={r}
                          allRows={rows}
                          typeName={typeName(r.activation_type_id)}
                          pending={save.isPending}
                          onSave={(next) => save.mutate({ ...next, id: r.id })}
                          onDelete={() => setPendingDeleteId(r.id)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this slab?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the activation range and its PKR rate for this partner. You can add it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteId) del.mutate(pendingDeleteId);
                setPendingDeleteId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function SlabRow({
  row,
  allRows,
  typeName,
  onSave,
  onDelete,
  pending,
}: {
  row: Row;
  allRows: Row[];
  typeName: string | null;
  onSave: (next: {
    min_count: number;
    max_count: number | null;
    rate_pkr: number;
    effective_from: string | null;
    effective_to: string | null;
    active: boolean;
    role: PartnerRole;
  }) => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState<Draft>({
    min_count: row.min_count,
    max_count: row.max_count,
    rate_pkr: row.rate_pkr,
    activation_type_id: row.activation_type_id ?? null,
    effective_from: day(row.effective_from),
    effective_to: day(row.effective_to),
  });

  const startEdit = () => {
    setLocal({
      min_count: row.min_count,
      max_count: row.max_count,
      rate_pkr: row.rate_pkr,
      activation_type_id: row.activation_type_id ?? null,
      effective_from: day(row.effective_from),
      effective_to: day(row.effective_to),
    });
    setEditing(true);
  };

  const cancel = () => {
    setLocal({
      min_count: row.min_count,
      max_count: row.max_count,
      rate_pkr: row.rate_pkr,
      activation_type_id: row.activation_type_id ?? null,
      effective_from: day(row.effective_from),
      effective_to: day(row.effective_to),
    });
    setEditing(false);
  };

  const commit = () => {
    const err = validateSlab(local, allRows, row.id);
    if (err) {
      toast.error(err);
      return;
    }
    const dirty =
      local.min_count !== row.min_count ||
      local.max_count !== row.max_count ||
      local.rate_pkr !== row.rate_pkr ||
      local.effective_from !== day(row.effective_from) ||
      local.effective_to !== day(row.effective_to);
    if (!dirty) {
      setEditing(false);
      return;
    }
    onSave({ ...local, active: row.active, role: row.role });
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="w-24 text-sm">
          <div className="text-xs text-muted-foreground">Range</div>
          <div>{row.min_count}–{row.max_count ?? "∞"}</div>
        </div>
        <div className="w-32 text-sm">
          <div className="text-xs text-muted-foreground">Rate (PKR)</div>
          <div className="font-medium">{row.rate_pkr.toLocaleString()}</div>
        </div>
        <div className="w-36 text-sm">
          <div className="text-xs text-muted-foreground">Activation type</div>
          <div>{typeName ?? "All types"}</div>
        </div>
        <div className="w-44 text-sm">
          <div className="text-xs text-muted-foreground">Effective</div>
          <div>{effectiveLabel(row)}</div>
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={startEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={onDelete} className="text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3 p-3">
      <div className="w-24">
        <div className="text-xs text-muted-foreground">Min</div>
        <Input
          type="number"
          min={1}
          value={Number.isFinite(local.min_count) ? local.min_count : ""}
          onChange={(e) =>
            setLocal({ ...local, min_count: e.target.value === "" ? NaN : parseInt(e.target.value, 10) })
          }
        />
      </div>
      <div className="w-28">
        <div className="text-xs text-muted-foreground">Max (∞)</div>
        <Input
          type="number"
          value={local.max_count ?? ""}
          onChange={(e) =>
            setLocal({ ...local, max_count: e.target.value ? parseInt(e.target.value, 10) : null })
          }
        />
      </div>
      <div className="w-32">
        <div className="text-xs text-muted-foreground">Rate (PKR)</div>
        <Input
          type="number"
          min={0}
          value={Number.isFinite(local.rate_pkr) ? local.rate_pkr : ""}
          onChange={(e) =>
            setLocal({ ...local, rate_pkr: e.target.value === "" ? NaN : parseInt(e.target.value, 10) })
          }
        />
      </div>
      <div className="w-40">
        <div className="text-xs text-muted-foreground">From</div>
        <Input
          type="date"
          value={local.effective_from ?? ""}
          onChange={(e) => setLocal({ ...local, effective_from: e.target.value || null })}
        />
      </div>
      <div className="w-40">
        <div className="text-xs text-muted-foreground">To</div>
        <Input
          type="date"
          value={local.effective_to ?? ""}
          onChange={(e) => setLocal({ ...local, effective_to: e.target.value || null })}
        />
      </div>
      <div className="flex-1" />
      <Button size="sm" onClick={commit} disabled={pending}>
        <Check className="mr-1 h-4 w-4" /> Save
      </Button>
      <Button size="sm" variant="outline" onClick={cancel}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
