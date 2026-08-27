# Production fixes: isolation, typography, commission schemes

Your document covers a lot. I've grouped it into four phases so each one lands verified instead of half-done. I found one confirmed root cause already (below).

## Confirmed bug: partner/store leakage across accounts

`listPartners` selects from `partners` with **no workspace filter** — it relies on row-level security alone. A Super Admin's policy allows every row, so when you switch into another workspace you still see your own partners (hence "2/1 used" on a 1-partner plan). The same pattern needs auditing on every list query. Stores are filtered correctly, so the Store IDs you saw are likely the same class of bug elsewhere (e.g. Store Performance aggregating unscoped extractions).

Fix: every server function scopes by the caller's **active workspace**, not by role, and Super Admin sees other accounts only through the impersonation context. Backend-enforced, plus query keys that include workspace id so switching accounts can never show cached data from the previous one.

---

## Phase 1 — Multi-tenant isolation (items 4, 5, 6, 17)

- Audit every server function in `src/lib/*.functions.ts` and add explicit `workspace_id` scoping.
- Include the active workspace id in every TanStack query key, and clear the query cache on workspace switch.
- Review RLS: super-admin policies must not widen ordinary reads; add missing policies and GRANTs.
- Backfill/verify `workspace_id` on legacy rows (partners, stores, extractions, batches, employees) and add NOT NULL + indexes where safe.

## Phase 2 — Data model + UI readability (items 1, 2, 3, 7, 8)

- Add **Email** and **Alternative Contact** to All Orders (list, detail, search, export). `email` already exists on extractions; alternative contact needs a migration.
- Typography pass on All Orders, Batches, Reports and other dense tables: larger base size, readable headers, no aggressive truncation of store IDs, order numbers, phones, CNICs, dates, amounts. Wider columns + wrapping instead of ellipsis.
- Restyle the **Choose folder** button to the app's gradient pill standard with proper hover/active/disabled states.

## Phase 3 — Commission schemes (items 9–12, 16)

New tables:

```text
activation_types      (workspace_id, name, code, active)
commission_schemes    (workspace_id, activation_type_id, name, effective_from, effective_to, active)
commission_slabs      (scheme_id, min_count, max_count, rate_pkr)
```

- Admin UI to create/edit activation types, schemes and slabs, with validation against overlapping ranges, inverted ranges, negatives and duplicates.
- One calculation engine on the server (`commission.server.ts`) used by dashboard, orders, reports, partner and employee commission — no duplicated frontend math.
- **Historical protection:** when a month is finalised, the applied rate, scheme version and computed amount are frozen on the row. Later slab edits never retroactively change closed periods.

## Phase 4 — Employee compensation (items 13, 14, 15)

- Add `compensation_type` (fixed / commission_only / salary_plus_commission), `base_salary`, `commission_scheme_id` to employees.
- Earnings for commission-eligible employees computed from their verified activations through the same engine; cancelled/reversed activations excluded.
- Employee UI clearly labels the compensation model and shows the earnings breakdown.

## Verification (item 19)

After each phase: run the isolation checks against two workspaces plus a Super Admin session in a real browser, confirm no cross-account rows, and check the build and console are clean.

---

I'd start with Phase 1 since it's the security issue, then move down. Tell me if you want a different order or want Phase 3 first.
