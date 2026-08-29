-- HitroTech OrderScan — Phase 2/3/4 schema
-- Run this in the EXTERNAL Supabase project (the one holding orders/partners/employees).
-- Safe to re-run: every statement is guarded.

-- ─────────────────────────────────────────────────────────────
-- Phase 2 — Alternative contact on orders
-- ─────────────────────────────────────────────────────────────
alter table public.extractions
  add column if not exists alternative_contact text;

create index if not exists extractions_alternative_contact_idx
  on public.extractions (alternative_contact);

-- ─────────────────────────────────────────────────────────────
-- Phase 3 — Database-driven activation types + typed commission schemes
-- ─────────────────────────────────────────────────────────────
create table if not exists public.activation_types (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  code text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

grant select, insert, update, delete on public.activation_types to authenticated;
grant all on public.activation_types to service_role;

alter table public.activation_types enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='activation_types' and policyname='activation_types_member_access') then
    create policy activation_types_member_access on public.activation_types
      for all to authenticated
      using (exists (select 1 from public.workspace_members m
                     where m.workspace_id = activation_types.workspace_id and m.user_id = auth.uid()))
      with check (exists (select 1 from public.workspace_members m
                          where m.workspace_id = activation_types.workspace_id and m.user_id = auth.uid()));
  end if;
end $$;

-- Slabs can now be scoped to one activation type (null = applies to every type).
alter table public.commission_slabs
  add column if not exists activation_type_id uuid references public.activation_types(id) on delete cascade;

create index if not exists commission_slabs_activation_type_idx
  on public.commission_slabs (workspace_id, activation_type_id);

-- Orders can record which activation type they belong to, so typed slabs can be applied.
alter table public.extractions
  add column if not exists activation_type_id uuid references public.activation_types(id) on delete set null;

create index if not exists extractions_activation_type_idx
  on public.extractions (workspace_id, activation_type_id);

-- ─────────────────────────────────────────────────────────────
-- Phase 4 — Employee compensation models
-- ─────────────────────────────────────────────────────────────
alter table public.employees
  add column if not exists compensation_type text not null default 'fixed',
  add column if not exists commission_per_activation numeric not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employees_compensation_type_check') then
    alter table public.employees
      add constraint employees_compensation_type_check
      check (compensation_type in ('fixed', 'commission_only', 'salary_plus_commission'));
  end if;
end $$;
