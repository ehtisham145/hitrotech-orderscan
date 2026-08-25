
CREATE OR REPLACE FUNCTION public.compute_extraction_anomalies()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a TEXT[] := '{}';
  known BOOLEAN;
BEGIN
  IF NEW.status = 'success' AND NEW.is_duplicate = false THEN
    IF NEW.activation_date_parsed IS NOT NULL
       AND NEW.activation_date_parsed > (CURRENT_DATE + INTERVAL '1 day')::date THEN
      a := array_append(a, 'future_activation_date');
    END IF;

    IF NEW.store_id IS NOT NULL AND btrim(NEW.store_id) <> '' THEN
      SELECT
        EXISTS(SELECT 1 FROM public.stores
               WHERE workspace_id = NEW.workspace_id
                 AND upper(code) = upper(NEW.store_id))
        OR EXISTS(SELECT 1 FROM public.partners
                  WHERE workspace_id = NEW.workspace_id
                    AND upper(btrim(store_id)) = upper(btrim(NEW.store_id)))
      INTO known;
      IF NOT known THEN
        a := array_append(a, 'unknown_store_id');
      END IF;
    END IF;

    IF NEW.phone_number IS NULL OR btrim(NEW.phone_number) = '' THEN
      a := array_append(a, 'missing_phone');
    ELSIF length(regexp_replace(NEW.phone_number, '\D', '', 'g')) < 10 THEN
      a := array_append(a, 'malformed_phone');
    END IF;

    IF NEW.order_number IS NULL OR btrim(NEW.order_number) = '' THEN
      a := array_append(a, 'missing_order_number');
    END IF;
  END IF;

  NEW.anomalies := a;
  RETURN NEW;
END; $$;

-- Recompute anomalies for existing rows (BEFORE UPDATE trigger will refresh them)
UPDATE public.extractions
SET updated_at = now()
WHERE 'unknown_store_id' = ANY(anomalies);
