// Postgres deadlocks (error 40P01) between concurrent single-row writes are
// a normal, expected occurrence under bulk load — the standard response is
// simply to retry, since the losing transaction rolls back with no partial
// effect. First hit and fixed for the row-claim step; confirmed happening
// again at the final "save extracted fields" write during a live 18-image
// bulk-upload test, and likely at the shared batches-row update inside
// syncBatchCounts too (every extraction in one batch contends on that same
// row). Shared here instead of copy-pasting the same retry loop at each
// call site.
type DeadlockableResult<TData> = { data: TData; error: { message: string; code?: string } | null };

// `attempt` returns PromiseLike, not Promise — Supabase's query builder is a
// thenable ("awaitable"), not a real Promise instance, so a stricter
// `() => Promise<T>` parameter type rejects it.
export async function retryOnDeadlock<TData>(
  attempt: () => PromiseLike<DeadlockableResult<TData>>,
  label: string,
  maxAttempts = 3,
): Promise<DeadlockableResult<TData>> {
  let result: DeadlockableResult<TData>;
  for (let i = 0; i < maxAttempts; i++) {
    result = await attempt();
    const isDeadlock = result.error?.code === "40P01" || /deadlock detected/i.test(result.error?.message ?? "");
    if (!isDeadlock) return result;
    console.warn(`[extract-core] ${label} deadlocked, retrying (attempt ${i + 1}/${maxAttempts})`);
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));
  }
  return result!;
}
