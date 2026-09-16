# Test coverage — what is done, what is left

Status at commit `86a4dfa`, 16 September 2026. **342 tests passing** (314 vitest
+ 28 pytest), `tsc` clean.

**65 of 120 server functions covered** — 10 of 25 files.

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

---

## Covered — 10 files, 65 endpoints, 190 tests

| File | Endpoints | Tests |
|---|---:|---:|
| `billing.functions.ts` | 13 | 30 |
| `workspace-members.functions.ts` | 11 | 20 |
| `commission.functions.ts` | 10 | 29 |
| `brand.functions.ts` | 9 | 22 |
| `reconcile.functions.ts` | 6 | 18 |
| `payouts.functions.ts` | 5 | 16 |
| `stores.functions.ts` | 4 | 18 |
| `admin-recovery.functions.ts` | 3 | 20 |
| `queue.functions.ts` | 3 | 12 |
| `batch-actions.functions.ts` | 1 | 5 |

A further 124 tests cover pure functions: `plans` (23), `template-extract` (27),
`slab-validation` (15), `plan-features` (15), `brand-slabs` (15), `format` (14),
`db-payload` (8), `employee-pay` (7).

---

## Remaining — 15 files, 55 endpoints

Ordered by what a mistake costs.

| File | Endpoints | Why it matters |
|---|---:|---|
| `employees.functions.ts` | 12 | Salary, advances, seat limits. Two bugs already found here. |
| `partners.functions.ts` | 6 | Partner records, plan partner limits. One bug already found. |
| `month-close.functions.ts` | 4 | Locks a month; interacts with the DB trigger in CLAUDE.md §2.10. |
| `workspace.functions.ts` | 6 | Creating, renaming, deleting a workspace. |
| `admin-users.functions.ts` | 1 | Super-admin surface. |
| `reliability.functions.ts` | 9 | Report generation and delivery. |
| `notifications.functions.ts` | 5 | In-app alerts and preferences. |
| `statements.functions.ts` | 2 | Partner statements. |
| `portal.functions.ts` | 2 | What a partner sees of their own data. |
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

33 problems were found across the covered files, clustering into five shapes.
Write the test for the shape, not the happy path.

1. **Missing workspace filter.** Every query and write needs
   `.eq("workspace_id", wsId)`. Assert via `getChain(table).eq`. *Found 7×.*
2. **Write by id alone.** `.eq("id", ...)` with no workspace lets one tenant
   touch another's row. *Found 5×.*
3. **Unchecked write result.** `.select("id")` and treat zero rows as failure,
   or a refused write reports success. *Found 5×.*
4. **Discarded query error.** `const { data } = await ...` without touching
   `error` turns a failure into an empty result — on a money report, a confident
   zero. *Found 4×.*
5. **Missing role check.** Every write endpoint needs an `allowRole(false)`
   test. One listing endpoint had no check at all.

**Per-endpoint checklist:** refusal (`allowRole(false)`) · workspace scoping ·
row from another workspace reported not silently ok · `queueError` surfaces ·
edge values (`null`, `0`, empty list, divide-by-zero).

---

## Running

```bash
npm test                                   # vitest — 314
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

## Two traps that cost real time

- **A scripted edit that `sys.exit()`s on a failed match before saving silently
  discards the edits that already matched.** One fix was reported as applied and
  never written to disk; only a test caught it. Collect every edit, verify all
  match, then write once.
- **Check `tsc` before committing, not after.** One commit went out with two type
  errors in a test file.
