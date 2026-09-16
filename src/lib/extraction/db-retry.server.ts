// Postgres deadlocks (error 40P01) between concurrent single-row writes are
// a normal, expected occurrence under bulk load — the standard response is
// simply to retry, since the losing transaction rolls back with no partial
// effect. First hit and fixed for the row-claim step; confirmed happening
// again at the final "save extracted fields" write during a live 18-image
// bulk-upload test, and at the shared batches-row update inside
// syncBatchCounts too (every extraction in one batch contends on that same
// row). Shared here instead of copy-pasting the same retry loop at each
// call site.
//
// Statement timeouts (57014) are retried on the same path. They are not a
// separate problem here: under this contention a statement times out because
// it spent its whole budget waiting on a lock somebody else held, which is
// the same transient condition as losing a deadlock — confirmed in a live
// 25-image run, where "canceling statement due to statement timeout" appeared
// interleaved with the 40P01s at the claim step.
//
// Sizing: a 25-image batch produced deadlocks at the claim step, the save
// step AND the batches-row update simultaneously, and three attempts spaced
// 50-200ms apart (≈375ms of total runway) exhausted themselves while the
// contention was still going. The window now reaches ≈3s, which covers a
// burst of workers finishing at once without leaving a row stuck.
type DeadlockableResult<TData> = { data: TData; error: { message: string; code?: string } | null };

const DEADLOCK_CODE = "40P01";
const STATEMENT_TIMEOUT_CODE = "57014";

function isTransientWriteConflict(error: { message: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === DEADLOCK_CODE || error.code === STATEMENT_TIMEOUT_CODE) return true;
  return /deadlock detected|canceling statement due to statement timeout/i.test(error.message ?? "");
}

// `attempt` returns PromiseLike, not Promise — Supabase's query builder is a
// thenable ("awaitable"), not a real Promise instance, so a stricter
// `() => Promise<T>` parameter type rejects it.
export async function retryOnDeadlock<TData>(
  attempt: () => PromiseLike<DeadlockableResult<TData>>,
  label: string,
  maxAttempts = 5,
): Promise<DeadlockableResult<TData>> {
  let result: DeadlockableResult<TData>;
  for (let i = 0; i < maxAttempts; i++) {
    result = await attempt();
    if (!isTransientWriteConflict(result.error)) return result;
    if (i === maxAttempts - 1) break;
    // Exponential with jitter. Flat backoff is the wrong shape here: every
    // contending worker retries on the same schedule and collides again.
    const backoff = 100 * 2 ** i + Math.random() * 100;
    console.warn(
      `[extract-core] ${label} hit a write conflict, retrying in ${Math.round(backoff)}ms (attempt ${i + 1}/${maxAttempts})`,
    );
    await new Promise((r) => setTimeout(r, backoff));
  }
  return result!;
}

/**
 * Marks a row's terminal state, retrying through the same contention the work
 * itself just lost to.
 *
 * Every "give up and record why" write in extract-core used to be a bare,
 * unchecked update. When one of those lost a deadlock — which is exactly when
 * it is most likely to, since it runs immediately after a write that already
 * deadlocked — the row was left sitting in `processing` with no error and no
 * owner. Two rows of a live 25-image batch ended up exactly there, stuck until
 * the two-minute staleness cutoff re-drove them into the same contention
 * again. A failure path that cannot record the failure is how a batch stops
 * making progress without anything in the UI saying so.
 */
export async function markExtractionFailed(
  supabase: {
    from: (table: string) => {
      update: (values: Record<string, unknown>) => {
        eq: (column: string, value: string) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
      };
    };
  },
  extractionId: string,
  errorMessage: string,
  nowIso: () => string,
): Promise<void> {
  const { error } = await retryOnDeadlock(
    () =>
      supabase
        .from("extractions")
        .update({ status: "failed", error_message: errorMessage.slice(0, 500), updated_at: nowIso() })
        .eq("id", extractionId),
    `Mark failed for ${extractionId}`,
  );
  if (error) {
    // Nothing further to try — but say so loudly, because the row is now in
    // whatever state the failed write left it and only the staleness sweep
    // will pick it back up.
    console.error(`[extract-core] Could not even mark ${extractionId} failed: ${error.message}`);
  }
}
