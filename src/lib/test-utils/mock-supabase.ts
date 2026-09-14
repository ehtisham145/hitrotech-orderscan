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
      "eq", "neq", "in", "order", "limit", "gte", "lte", "gt", "lt", "is", "not",
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

  const createSignedUploadUrl = vi.fn();

  const client = {
    from: (table: string) => makeChain(table),
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
    getChain,
    createSignedUploadUrl,
  };
}
