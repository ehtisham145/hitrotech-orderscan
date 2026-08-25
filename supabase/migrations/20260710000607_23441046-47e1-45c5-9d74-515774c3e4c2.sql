
CREATE OR REPLACE FUNCTION public.parse_activation_date(t text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF t IS NULL OR btrim(t) = '' THEN RETURN NULL; END IF;
  BEGIN
    RETURN to_date(t, 'DD Mon YYYY');
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      RETURN to_date(t, 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
  END;
END;
$$;

ALTER TABLE public.extractions
  ADD COLUMN IF NOT EXISTS activation_date_parsed date
  GENERATED ALWAYS AS (public.parse_activation_date(activation_date)) STORED;

CREATE INDEX IF NOT EXISTS extractions_activation_date_parsed_idx
  ON public.extractions(activation_date_parsed);
