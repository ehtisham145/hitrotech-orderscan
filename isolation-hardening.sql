-- Phase 1: multi-tenant isolation hardening.
-- Run in the external Supabase project (the one holding orders/partners data).
-- Safe to re-run; everything is guarded.

-- 1. Report rows that have no workspace yet (must be 0 before step 3) -------
select 'partners' as table_name, count(*) from public.partners where workspace_id is null
union all select 'stores', count(*) from public.stores where workspace_id is null
union all select 'extractions', count(*) from public.extractions where workspace_id is null
union all select 'batches', count(*) from public.batches where workspace_id is null
union all select 'employees', count(*) from public.employees where workspace_id is null
union all select 'partner_payouts', count(*) from public.partner_payouts where workspace_id is null;

-- 2. Backfill from parents where the link is unambiguous --------------------
update public.extractions e
   set workspace_id = b.workspace_id
  from public.batches b
 where e.batch_id = b.id
   and e.workspace_id is null
   and b.workspace_id is not null;

update public.partner_payouts p
   set workspace_id = pa.workspace_id
  from public.partners pa
 where p.partner_id = pa.id
   and p.workspace_id is null
   and pa.workspace_id is not null;

-- 3. Enforce NOT NULL once step 1 reports zero for a table ------------------
-- (uncomment per table after verifying)
-- alter table public.partners        alter column workspace_id set not null;
-- alter table public.stores          alter column workspace_id set not null;
-- alter table public.extractions     alter column workspace_id set not null;
-- alter table public.batches         alter column workspace_id set not null;
-- alter table public.employees       alter column workspace_id set not null;
-- alter table public.partner_payouts alter column workspace_id set not null;

-- 4. Indexes for the workspace filters the app now always sends -------------
create index if not exists partners_ws_idx        on public.partners (workspace_id);
create index if not exists stores_ws_idx          on public.stores (workspace_id);
create index if not exists batches_ws_idx         on public.batches (workspace_id);
create index if not exists employees_ws_idx       on public.employees (workspace_id);
create index if not exists partner_payouts_ws_idx on public.partner_payouts (workspace_id, month);
create index if not exists extractions_ws_month_idx
  on public.extractions (workspace_id, commission_month);
create index if not exists extractions_ws_status_idx
  on public.extractions (workspace_id, status);

notify pgrst, 'reload schema';
