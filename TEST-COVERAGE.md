# Test coverage — what is done, what is left

Status at commit `b325ea8`, 16 September 2026. **544 tests passing** (516 vitest
+ 28 pytest), `tsc` clean.

**112 of 120 server functions covered** — 19 of 25 files.

> An earlier note in this project said "151 server functions". That counted every
> occurrence of `createServerFn`, including import lines. Counting
> `export const X = createServerFn(` gives **120**.

---

## The pattern — read this before writing a test

A handler written inline inside `createServerFn(...).handler(...)` **cannot be
called from a test**: `requireSupabaseAuth` calls `getRequest()`, which only
resolves inside a real request. So every handler is a plain function with a
one-line wrapper:

```ts
import type { ServerContext } from "./server-context";

export async function doThingCore(data: Input, context: ServerContext) {
  /* all the logic */
}

export const doThing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Input) => input)
  .handler(({ data, context }) => doThingCore(data, context));
```

The test imports `doThingCore`. A handler with no `data` becomes
`doThingCore(context)`.

### The mock

`src/lib/test-utils/mock-supabase.ts` queues one canned result per `.from(table)`
call, FIFO per table. A call with nothing queued **throws** — an incomplete setup
fails loudly instead of reaching a real client. That throw doubles as an
assertion: queue nothing to prove the code never touches a table.

```ts
const { client, queueResponse, queueError, allowRole, getChain, rpc } = createMockSupabase();

queueResponse("profiles", { data: { active_workspace_id: "ws1" }, error: null });
allowRole();                     // has_workspace_role -> true
allowRole(false);                // -> assert the refusal
queueError("stores", "boom");

await doThingCore({ id: "s1" }, { supabase: client as never, userId: "u1" });
expect(getChain("stores").eq).toHaveBeenCalledWith("workspace_id", "ws1");
```

**Almost every test needs `allowRole()`** — `assertActiveWorkspaceRole` calls
`rpc("has_workspace_role")`, and reads `profiles` first for the active workspace.
`rpc()` is both awaitable and chainable, because some callers append
`.maybeSingle()` to it.

Passthrough query-builder methods the mock supports: `select insert update
delete upsert eq neq in order limit range gte lte gt lt is not contains single
maybeSingle`. Extend the list in `mock-supabase.ts` if a covered function uses
something not on it — `range()` and `contains()` were added this round when
`notifications`/`reliability` needed them.

---

## Covered — 19 files, 112 endpoints, 428 tests

| File | Endpoints | Tests |
|---|---:|---:|
| `billing.functions.ts` | 13 | 30 |
| `workspace-members.functions.ts` | 11 | 20 |
| `commission.functions.ts` | 10 | 29 |
| `employees.functions.ts` | 12 | 45 |
| `brand.functions.ts` | 9 | 22 |
| `reliability.functions.ts` | 9 | 32 |
| `reconcile.functions.ts` | 6 | 18 |
| `partners.functions.ts` | 6 | 25 |
| `workspace.functions.ts` | 6 | 40 |
| `payouts.functions.ts` | 5 | 16 |
| `notifications.functions.ts` | 5 | 18 |
| `stores.functions.ts` | 4 | 18 |
| `month-close.functions.ts` | 4 | 17 |
| `admin-recovery.functions.ts` | 3 | 20 |
| `queue.functions.ts` | 3 | 12 |
| `statements.functions.ts` | 2 | 10 |
| `portal.functions.ts` | 2 | 7 |
| `batch-actions.functions.ts` | 1 | 5 |
| `admin-users.functions.ts` | 1 | 7 |

A further 124 tests cover pure functions: `plans` (23), `template-extract` (27),
`slab-validation` (15), `plan-features` (15), `brand-slabs` (15), `format` (14),
`db-payload` (8), `employee-pay` (7).

---

## Remaining — 6 files, 8 endpoints

Small surface left, all read-mostly dashboard/reporting endpoints.

| File | Endpoints | Why it matters |
|---|---:|---|
| `performance.functions.ts` | 2 | Store/partner performance figures. |
| `usage.functions.ts` | 2 | Plan usage counters. |
| `kpis.functions.ts` | 1 | Dashboard tiles. |
| `trends.functions.ts` | 1 | Dashboard charts. |
| `activity.functions.ts` | 1 | Activity feed. |
| `screenshot-upload.functions.ts` | 1 | Signed upload URLs. |

Also untested: the 10 handlers under `src/routes/api/`, and every React
component — `vitest.config.ts` sets `environment: "node"`, so there is no DOM.

---

## What to test for

This round (employees, partners, month-close, workspace, admin-users,
reliability, notifications, statements, portal) found real bugs of every one of
the five shapes below, plus one new one worth adding as its own category:

1. **Missing workspace filter.** Every query and write needs
   `.eq("workspace_id", wsId)`. Assert via `getChain(table).eq`.
   `reliability.functions.ts` had three outright cross-tenant leaks this way
   (`listAuditLogs`, `listMonthLocks`, `isMonthLocked` — no workspace filter
   at all, not even a missing check on an otherwise-scoped query).
2. **Write by id alone.** `.eq("id", ...)` with no workspace lets one tenant
   touch another's row. `employees.functions.ts`'s `upsertEmployeeAdvance`
   update path was the worst instance found all session — it also *wrote*
   `workspace_id: wsId` into the payload while matching only by id, so a
   caller could reassign another workspace's row into their own tenant.
3. **Unchecked write result.** `.select("id")` and treat zero rows as failure,
   or a refused write reports success. `workspace.functions.ts`'s
   `reopenMonth` was the worst: none of its three writes checked their error
   at all, so a failed reopen could still return `{ ok: true }`.
4. **Discarded query error.** `const { data } = await ...` without touching
   `error` turns a failure into an empty result — on a money report, a
   confident zero. By far the most common shape this round: found in
   `getReconciliation`, `exportMonthlyBackup`, `getPartnerStatement`,
   `getPartnerHistory` (all real money/report endpoints), plus
   `getActiveWorkspace`'s auto-provisioning path, `createPartner`'s
   plan-limit precheck, `addPartnerMatchKey` (this one actively *deleted*
   data — a failed lookup fell through to an empty key set, and the update
   that followed overwrote the row, discarding every key it already had),
   and several audit-log inserts (those were fixed by *logging* rather than
   throwing, since by the time an audit write runs the real operation has
   already succeeded — see `closeMonthNow`/`reopenMonth`/`createWorkspace`).
5. **Missing role check.** Every write endpoint needs an `allowRole(false)`
   test. `workspace.functions.ts`'s `renameWorkspace` had *no* authorization
   check at all — not even a workspace-membership check — despite its own
   doc comment saying "Owner or admin only."
6. **New: copy-pasted date-normalization bug.** The same buggy `monthStart`
   formula (`input.slice(0, 8) + "01"`) was found independently in three
   different files — `reliability.functions.ts`, `month-close.server.ts`,
   `statements.functions.ts`. It only produces a valid date for a 10-char
   "YYYY-MM-DD" input; a 7-char "YYYY-MM" input (what `<input type="month">`
   actually sends) comes out as `"2026-0901"` — no separating dash, not
   parseable at all. All three fixed the same way: take the `"YYYY-MM"`
   prefix and append `"-01"` explicitly, which is correct regardless of
   input length. Worth grepping for `.slice(0, 8)` near a month-handling
   function if touching date logic elsewhere in this codebase.

**Per-endpoint checklist:** refusal (`allowRole(false)`) · workspace scoping ·
row from another workspace reported not silently ok · `queueError` surfaces ·
edge values (`null`, `0`, empty list, divide-by-zero) · for money/report
endpoints specifically, every `Promise.all` branch's `.error` checked, not
just the first one.

---

## Running

```bash
npm test                                   # vitest — 516
npx vitest run src/lib/stores.functions.test.ts
npx tsc --noEmit -p tsconfig.json          # must stay clean

pip install -r ocr-service/requirements/test.txt   # once
pytest                                     # 28, works from the repo root
```

Tests live beside the file they cover: `src/lib/x.ts` → `src/lib/x.test.ts`.

Install `requirements/test.txt`, **not** `dev.txt` — dev pulls in `base.txt` and
therefore paddlepaddle, which is a large download and will not install on
Windows. The suite never needs it.

---

## Traps that cost real time

- **A scripted edit that `sys.exit()`s on a failed match before saving silently
  discards the edits that already matched.** One fix was reported as applied and
  never written to disk; only a test caught it. Collect every edit, verify all
  match, then write once.
- **Check `tsc` before committing, not after.** One commit went out with two type
  errors in a test file.
- **A test asserting on "the current month" must compute it the same way the
  code does (`new Date()` at call time), not hardcode a date from whenever the
  test was written.** `getPartnerHistoryCore`'s first test failed exactly this
  way — the fixture assumed the session's narrative date, not the real system
  clock the test suite actually runs under.
- **A `Promise.all([a, b, c])` mock needs every branch queued, even the ones
  the test isn't "about."** Forgetting the second/third table's queued
  response surfaces as a confusing "no queued response" error instead of the
  assertion you meant to write.
