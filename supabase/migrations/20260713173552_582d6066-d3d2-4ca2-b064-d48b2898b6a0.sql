
CREATE OR REPLACE FUNCTION public.trg_extractions_automatch_partner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _match_id UUID; _month DATE;
BEGIN
  IF NEW.status <> 'success' OR NEW.is_duplicate = true THEN
    RETURN NEW;
  END IF;

  -- If no partner yet, try to auto-match by keys.
  IF NEW.partner_id IS NULL THEN
    SELECT id INTO _match_id
    FROM public.partners
    WHERE active = true AND workspace_id = NEW.workspace_id
      AND (
        (NEW.employee_name IS NOT NULL AND lower(NEW.employee_name) = ANY(SELECT lower(k) FROM unnest(match_keys) AS k))
        OR (NEW.reference IS NOT NULL AND lower(NEW.reference) = ANY(SELECT lower(k) FROM unnest(match_keys) AS k))
        OR (NEW.branch_name IS NOT NULL AND lower(NEW.branch_name) = ANY(SELECT lower(k) FROM unnest(match_keys) AS k))
      )
    ORDER BY created_at ASC LIMIT 1;

    IF _match_id IS NOT NULL THEN
      NEW.partner_id := _match_id;
    END IF;
  END IF;

  -- Whenever a partner is linked, ensure commission_month is set.
  IF NEW.partner_id IS NOT NULL AND NEW.commission_month IS NULL THEN
    NEW.commission_month := date_trunc(
      'month',
      COALESCE(NEW.activation_date_parsed, NEW.created_at::date, CURRENT_DATE)
    )::date;
  END IF;

  RETURN NEW;
END;
$function$;

-- Backfill existing rows: any partner-linked extraction missing commission_month.
UPDATE public.extractions
SET commission_month = date_trunc(
  'month',
  COALESCE(activation_date_parsed, created_at::date, CURRENT_DATE)
)::date
WHERE partner_id IS NOT NULL
  AND commission_month IS NULL;
