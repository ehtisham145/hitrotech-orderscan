// Pure overlap rules for commission slabs. Shared by the editor (instant
// feedback) and the server function (the rule that actually holds).

export type SlabLike = {
  id?: string;
  min_count: number;
  max_count: number | null;
  rate_pkr: number;
  partner_id?: string | null;
  activation_type_id?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
};

const day = (v?: string | null) => (v ? v.slice(0, 10) : null);

/** Count ranges overlap; a null max means "and everything above". */
export function countRangesOverlap(aMin: number, aMax: number | null, bMin: number, bMax: number | null) {
  const aHi = aMax ?? Number.POSITIVE_INFINITY;
  const bHi = bMax ?? Number.POSITIVE_INFINITY;
  return aMin <= bHi && bMin <= aHi;
}

/** Date windows overlap; null from = -∞, null to = +∞. */
export function dateWindowsOverlap(
  aFrom?: string | null,
  aTo?: string | null,
  bFrom?: string | null,
  bTo?: string | null,
) {
  const aLo = day(aFrom) ?? "0000-01-01";
  const aHi = day(aTo) ?? "9999-12-31";
  const bLo = day(bFrom) ?? "0000-01-01";
  const bHi = day(bTo) ?? "9999-12-31";
  return aLo <= bHi && bLo <= aHi;
}

/**
 * Returns a human-readable reason the slab cannot be saved, or null when it is
 * fine. Slabs for different activation types never conflict; a type-specific
 * slab is allowed to sit alongside an "all types" slab, and wins at payout time.
 */
export function findSlabConflict(candidate: SlabLike, existing: SlabLike[]): string | null {
  if (!Number.isFinite(candidate.min_count) || candidate.min_count < 1) return "Min must be 1 or greater.";
  if (candidate.max_count !== null && (!Number.isFinite(candidate.max_count) || candidate.max_count < candidate.min_count))
    return "Max must be blank or greater than or equal to Min.";
  if (!Number.isFinite(candidate.rate_pkr) || candidate.rate_pkr < 0) return "Rate must be 0 or greater.";
  if (candidate.effective_from && candidate.effective_to && day(candidate.effective_to)! < day(candidate.effective_from)!)
    return "The 'to' date must be on or after the 'from' date.";

  for (const r of existing) {
    if (candidate.id && r.id === candidate.id) continue;
    if ((r.activation_type_id ?? null) !== (candidate.activation_type_id ?? null)) continue;
    if (!dateWindowsOverlap(candidate.effective_from, candidate.effective_to, r.effective_from, r.effective_to)) continue;
    if (countRangesOverlap(candidate.min_count, candidate.max_count, r.min_count, r.max_count)) {
      return `Range overlaps slab ${r.min_count}–${r.max_count ?? "∞"} in an overlapping period. Change the range, the dates, or the activation type.`;
    }
  }
  return null;
}
