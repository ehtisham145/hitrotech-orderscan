ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL
  DEFAULT jsonb_build_object('emailDigest', false, 'anomalyAlerts', true, 'batchComplete', true);