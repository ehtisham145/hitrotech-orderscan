-- Employees: salary, device, KPI, promotion history + advance repayment tracking
-- Run this in YOUR Supabase project (iggnmbkylikybpespgsr) SQL editor.

alter table public.employees
  add column if not exists salary numeric,
  add column if not exists device_info text,
  add column if not exists kpi_metrics jsonb not null default '{}'::jsonb,
  add column if not exists promotion_history jsonb not null default '[]'::jsonb;

-- Advances: partial monthly deduction tracking
create table if not exists public.employees_advances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  amount numeric not null,
  repayment_amount numeric,
  reason text,
  taken_on date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.employees_advances
  add column if not exists repayment_amount numeric;

grant select, insert, update, delete on public.employees_advances to authenticated;
grant all on public.employees_advances to service_role;

alter table public.employees_advances enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'employees_advances'
      and policyname = 'ws members manage advances'
  ) then
    create policy "ws members manage advances"
      on public.employees_advances
      for all
      to authenticated
      using (
        exists (
          select 1 from public.workspace_members m
          where m.workspace_id = employees_advances.workspace_id
            and m.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1 from public.workspace_members m
          where m.workspace_id = employees_advances.workspace_id
            and m.user_id = auth.uid()
        )
      );
  end if;
end $$;

create index if not exists employees_advances_employee_idx
  on public.employees_advances (employee_id);

-- Refresh PostgREST schema cache so the new columns are visible immediately
notify pgrst, 'reload schema';
