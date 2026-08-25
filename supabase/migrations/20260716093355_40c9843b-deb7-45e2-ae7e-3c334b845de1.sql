ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_code_key;
ALTER TABLE public.stores ADD CONSTRAINT stores_ws_code_key UNIQUE (workspace_id, code);