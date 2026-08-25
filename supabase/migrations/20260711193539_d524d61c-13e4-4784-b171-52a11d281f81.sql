
CREATE OR REPLACE FUNCTION public.trg_extractions_automatch_partner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _match_id UUID;
  _month DATE;
BEGIN
  -- Only try to match successful, non-duplicate rows that aren't already linked
  IF NEW.status <> 'success' OR NEW.is_duplicate = true OR NEW.partner_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Try matching employee_name, then reference, then branch_name against partner.match_keys
  SELECT id INTO _match_id
  FROM public.partners
  WHERE active = true
    AND (
      (NEW.employee_name IS NOT NULL AND lower(NEW.employee_name) = ANY(SELECT lower(k) FROM unnest(match_keys) AS k))
      OR (NEW.reference IS NOT NULL AND lower(NEW.reference) = ANY(SELECT lower(k) FROM unnest(match_keys) AS k))
      OR (NEW.branch_name IS NOT NULL AND lower(NEW.branch_name) = ANY(SELECT lower(k) FROM unnest(match_keys) AS k))
    )
  ORDER BY created_at ASC
  LIMIT 1;

  IF _match_id IS NOT NULL THEN
    _month := date_trunc('month', COALESCE(NEW.activation_date_parsed, CURRENT_DATE))::date;
    NEW.partner_id := _match_id;
    NEW.commission_month := _month;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_extractions_automatch_partner() FROM PUBLIC, anon, authenticated;

-- Fire BEFORE the recompute trigger (BEFORE vs AFTER order handles that automatically)
CREATE TRIGGER extractions_automatch_partner
  BEFORE INSERT OR UPDATE OF status, employee_name, reference, branch_name
  ON public.extractions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_extractions_automatch_partner();
