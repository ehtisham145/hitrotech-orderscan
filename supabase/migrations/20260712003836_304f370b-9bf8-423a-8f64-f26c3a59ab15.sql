
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Karachi',
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en-PK';
