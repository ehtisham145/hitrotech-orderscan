// Flat slab maths shared by server functions and UI previews.
export type Slab = {
  min_count: number;
  max_count: number | null;
  rate_pkr: number;
  active?: boolean;
  /** Inclusive start date (YYYY-MM-DD). Null/undefined = always been in effect. */
  effective_from?: string | null;
  /** Inclusive end date (YYYY-MM-DD). Null/undefined = still in effect. */
  effective_to?: string | null;
};

/** Normalise any date-ish input to a YYYY-MM-DD string. */
function toDay(input?: string | Date | null): string {
  if (!input) return new Date().toISOString().slice(0, 10);
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  return input.slice(0, 10);
}

/**
 * Keep only the slabs in effect on a given day. A rate change mid-relationship
 * is modelled as closing the old row (effective_to) and opening a new one
 * (effective_from), so historical months keep pricing at the old rate.
 */
export function slabsEffectiveOn<T extends Slab>(slabs: T[], on?: string | Date | null): T[] {
  const day = toDay(on);
  return slabs.filter((s) => {
    const from = s.effective_from ? s.effective_from.slice(0, 10) : null;
    const to = s.effective_to ? s.effective_to.slice(0, 10) : null;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}

/** Human label for a slab's validity window. */
export function effectiveLabel(s: Slab): string {
  const from = s.effective_from ? s.effective_from.slice(0, 10) : null;
  const to = s.effective_to ? s.effective_to.slice(0, 10) : null;
  if (!from && !to) return "Always";
  if (from && !to) return `From ${from}`;
  if (!from && to) return `Until ${to}`;
  return `${from} → ${to}`;
}

/**
 * Flat (non-progressive) slabs: the tier the total count lands in sets a single
 * rate, and that rate applies to every activation in the month. e.g. 120
 * activations with a 51-150 @ 750 slab => 120 x 750, not 50 x 600 + 70 x 750.
 */
export function computeSlabAmount(totalCount: number, slabs: Slab[], on?: string | Date | null) {
  const tiers = slabsEffectiveOn(slabs, on)
    .filter((s) => s.active !== false)
    .slice()
    .sort((a, b) => a.min_count - b.min_count);

  const breakdown: { from: number; to: number | null; units: number; rate: number; amount: number }[] = [];

  if (totalCount <= 0 || tiers.length === 0) return { total: 0, breakdown };

  const matched =
    tiers.find((s) => totalCount >= s.min_count && (s.max_count == null || totalCount <= s.max_count)) ??
    // Above every defined tier: use the highest tier's rate.
    [...tiers].reverse().find((s) => totalCount >= s.min_count);

  if (!matched) return { total: 0, breakdown };

  const rate = matched.rate_pkr ?? 0;
  const total = totalCount * rate;
  breakdown.push({ from: matched.min_count, to: matched.max_count, units: totalCount, rate, amount: total });

  return { total, breakdown };
}
