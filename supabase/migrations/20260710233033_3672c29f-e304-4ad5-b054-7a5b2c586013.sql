
CREATE INDEX IF NOT EXISTS extractions_created_by_created_at_idx
  ON public.extractions (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS batches_created_by_created_at_idx
  ON public.batches (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS extractions_batch_status_idx
  ON public.extractions (batch_id, status);
