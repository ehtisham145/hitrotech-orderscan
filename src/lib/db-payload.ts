/**
 * Drops keys that are explicitly `null` from a write payload.
 *
 * Several columns are NOT NULL with a database default — `employees.
 * commission_per_activation` and `partners.join_date` are the two that bit us.
 * Their input schemas allow `null`, because from the form's point of view "the
 * user left this blank" is a real state. But sending `null` for such a column
 * does not mean "use the default", it means "write NULL", which the constraint
 * rejects: the whole insert or update fails and the user sees a raw database
 * error on a field they simply left empty.
 *
 * Omitting the key is what actually expresses "no value supplied" — the column
 * default then applies on insert, and on update the existing value is left
 * alone.
 *
 * Both cases were invisible to the typechecker for as long as the payloads were
 * cast with `as any` (see CLAUDE.md 2.11); they surfaced the moment the casts
 * came off.
 */
/**
 * The return type matters as much as the behaviour: the listed keys come back
 * optional and non-nullable, which is exactly what the generated Insert/Update
 * types want for a NOT NULL column with a default. Returning plain `T` would
 * strip the nulls at runtime while still telling the typechecker they might be
 * there — leaving the same error it is meant to resolve.
 */
export type NullsOmitted<T, K extends keyof T> = Omit<T, K> & {
  [P in K]?: Exclude<T[P], null>;
};

export function omitNulls<T extends Record<string, unknown>, K extends keyof T & string>(
  payload: T,
  keys: readonly K[],
): NullsOmitted<T, K> {
  const out: Record<string, unknown> = { ...payload };
  for (const key of keys) {
    if (key in out && out[key] === null) delete out[key];
  }
  return out as NullsOmitted<T, K>;
}
