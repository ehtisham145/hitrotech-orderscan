ALTER TABLE public.month_locks DROP CONSTRAINT month_locks_pkey;
ALTER TABLE public.month_locks ADD PRIMARY KEY (workspace_id, month);