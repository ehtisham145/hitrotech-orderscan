CREATE OR REPLACE FUNCTION public.enforce_month_lock_on_extractions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  m1 DATE; m2 DATE; ws1 uuid; ws2 uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    m1 := OLD.commission_month; ws1 := OLD.workspace_id;
    IF m1 IS NOT NULL AND EXISTS (SELECT 1 FROM public.month_locks WHERE workspace_id = ws1 AND month = m1) THEN
      RAISE EXCEPTION 'Month % is locked. Unlock it before deleting activations.', to_char(m1,'YYYY-MM');
    END IF;
    RETURN OLD;
  END IF;

  m1 := NEW.commission_month; ws1 := NEW.workspace_id;
  m2 := CASE WHEN TG_OP = 'UPDATE' THEN OLD.commission_month ELSE NULL END;
  ws2 := CASE WHEN TG_OP = 'UPDATE' THEN OLD.workspace_id ELSE NULL END;

  IF m1 IS NOT NULL AND ws1 IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.month_locks WHERE workspace_id = ws1 AND month = m1) THEN
    RAISE EXCEPTION 'Month % is locked. Unlock it before editing activations.', to_char(m1,'YYYY-MM');
  END IF;
  IF m2 IS NOT NULL AND ws2 IS NOT NULL AND (m2 IS DISTINCT FROM m1 OR ws2 IS DISTINCT FROM ws1)
     AND EXISTS (SELECT 1 FROM public.month_locks WHERE workspace_id = ws2 AND month = m2) THEN
    RAISE EXCEPTION 'Month % is locked. Unlock it before moving activations out of it.', to_char(m2,'YYYY-MM');
  END IF;

  RETURN NEW;
END;
$fn$;