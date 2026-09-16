// A small, purpose-built (not fully-generic) chainable Supabase fake.
//
// Covers exactly what the Tier 2 core functions actually call:
// .from(table).<filters>.<optional single()/maybeSingle()>, and
// storage.from(bucket).createSignedUploadUrl(path). Extend as more
// functions get tests rather than over-building a generic Supabase mock
// up front.
//
// Usage: queue one canned response per expected .from(table) call, in the
// order the code under test will make them (FIFO per table name). A
// .from(table) call with no queued response left throws immediately — an
// incomplete mock setup fails the test loudly instead of silently falling
// through to a real client.
import { vi } from "vitest";

export type MockResult<T = unknown> = { data: T; error: { message: string } | null };

export function createMockSupabase() {
  const queues = new Map<string, MockResult[]>();
  const chainsByTable = new Map<string, Record<string, unknown>[]>();
  const rpcQueues = new Map<string, MockResult[]>();

  function queueResponse<T>(table: string, result: MockResult<T>) {
    const q = queues.get(table) ?? [];
    q.push(result as MockResult);
    queues.set(table, q);
  }

  function queueError(table: string, message: string) {
    queueResponse(table, { data: null, error: { message } });
  }

  function makeChain(table: string) {
    const chain: Record<string, unknown> = {};
    const passthroughMethods = [
      "select", "insert", "update", "delete", "upsert",
      "eq", "neq", "in", "order", "limit", "range", "gte", "lte", "gt", "lt", "is", "not", "contains",
      "single", "maybeSingle",
    ];
    // vi.fn() wrappers (not plain arrows) so a test can assert on how the
    // query was built when that matters — e.g. expect(chain.eq).toHaveBeen
    // CalledWith("status", "pending") to confirm a write only ever targets
    // the rows it's supposed to.
    for (const m of passthroughMethods) chain[m] = vi.fn(() => chain);

    chain.then = (onFulfilled: (v: MockResult) => unknown, onRejected?: (e: unknown) => unknown) => {
      const q = queues.get(table);
      if (!q || q.length === 0) {
        throw new Error(
          `mock-supabase: no queued response for .from("${table}") — call queueResponse("${table}", ...) before running this test.`,
        );
      }
      return Promise.resolve(q.shift()!).then(onFulfilled, onRejected);
    };

    const seen = chainsByTable.get(table) ?? [];
    seen.push(chain);
    chainsByTable.set(table, seen);

    return chain;
  }

  /** The Nth (0-indexed) chain built for a .from(table) call — for asserting
   * how a specific query was constructed, e.g. getChain("extractions", 0)
   * .eq.mock.calls. */
  function getChain(table: string, callIndex = 0) {
    const seen = chainsByTable.get(table);
    const c = seen?.[callIndex];
    if (!c) throw new Error(`mock-supabase: .from("${table}") was never called (call #${callIndex}).`);
    return c as Record<string, ReturnType<typeof vi.fn>>;
  }

  /**
   * Queue a result for supabase.rpc(name, ...). Needed by almost every server
   * function: assertActiveWorkspaceRole calls rpc("has_workspace_role"), so a
   * test that does not queue it cannot get past the authorization check.
   */
  function queueRpc<T>(fn: string, result: MockResult<T>) {
    const q = rpcQueues.get(fn) ?? [];
    q.push(result as MockResult);
    rpcQueues.set(fn, q);
  }

  /** Shorthand: the caller does / does not hold one of the required roles. */
  function allowRole(allowed = true) {
    queueRpc("has_workspace_role", { data: allowed, error: null });
  }

  // Awaitable *and* chainable: some callers await rpc() directly, others append
  // .maybeSingle()/.single() to it (a set-returning SQL function). Returning a
  // bare promise breaks the second group.
  const rpc = vi.fn((fn: string, _args?: unknown) => {
    const take = () => {
      const q = rpcQueues.get(fn);
      if (!q || q.length === 0) {
        throw new Error(
          `mock-supabase: no queued response for .rpc("${fn}") — call queueRpc("${fn}", ...) or allowRole() before running this test.`,
        );
      }
      return q.shift()!;
    };
    const result: Record<string, unknown> = {
      then: (onFulfilled: (v: MockResult) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(take()).then(onFulfilled, onRejected),
      maybeSingle: () => Promise.resolve(take()),
      single: () => Promise.resolve(take()),
    };
    return result;
  });

  const createSignedUploadUrl = vi.fn();

  const client = {
    from: (table: string) => makeChain(table),
    rpc,
    storage: {
      from: (_bucket: string) => ({ createSignedUploadUrl }),
    },
  };

  return {
    // Cast to `any` at the call site (context.supabase expects the real
    // SupabaseClient<Database> type) — this fake deliberately implements
    // only the subset of the interface actually exercised.
    client,
    queueResponse,
    queueError,
    queueRpc,
    allowRole,
    getChain,
    rpc,
    createSignedUploadUrl,
  };
}
