ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS default_store_id text,
  ADD COLUMN IF NOT EXISTS default_employee_name text,
  ADD COLUMN IF NOT EXISTS default_branch_name text;