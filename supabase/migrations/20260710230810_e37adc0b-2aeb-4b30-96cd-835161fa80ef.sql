
ALTER TABLE public.extractions
  ADD COLUMN IF NOT EXISTS order_number_normalized text
  GENERATED ALWAYS AS (
    NULLIF(
      regexp_replace(
        replace(replace(replace(upper(trim(order_number)), 'O', '0'), 'I', '1'), 'L', '1'),
        '\s+', '', 'g'
      ),
      ''
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS extractions_created_by_order_norm_idx
  ON public.extractions (created_by, order_number_normalized)
  WHERE order_number_normalized IS NOT NULL AND is_duplicate = false;
