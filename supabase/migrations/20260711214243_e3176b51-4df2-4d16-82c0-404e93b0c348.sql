
ALTER TABLE public.commission_slabs
  ADD COLUMN IF NOT EXISTS partner_id UUID NULL REFERENCES public.partners(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS commission_slabs_partner_idx
  ON public.commission_slabs(partner_id) WHERE partner_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.recompute_partner_commission(_partner_id uuid, _month date)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _role public.partner_role;
  _count INTEGER;
  _rate INTEGER;
  _month_start DATE;
BEGIN
  IF _partner_id IS NULL OR _month IS NULL THEN RETURN; END IF;
  _month_start := date_trunc('month', _month)::date;
  SELECT role INTO _role FROM public.partners WHERE id = _partner_id;
  IF _role IS NULL THEN RETURN; END IF;

  SELECT COUNT(*) INTO _count
  FROM public.extractions
  WHERE partner_id = _partner_id
    AND commission_month = _month_start
    AND status = 'success' AND is_duplicate = false;

  SELECT rate_pkr INTO _rate
  FROM public.commission_slabs
  WHERE partner_id = _partner_id AND active = true
    AND _count >= min_count AND (max_count IS NULL OR _count <= max_count)
  ORDER BY min_count DESC LIMIT 1;

  IF _rate IS NULL THEN
    SELECT rate_pkr INTO _rate
    FROM public.commission_slabs
    WHERE partner_id IS NULL AND role = _role AND active = true
      AND _count >= min_count AND (max_count IS NULL OR _count <= max_count)
    ORDER BY min_count DESC LIMIT 1;
  END IF;

  IF _rate IS NULL THEN _rate := 0; END IF;

  UPDATE public.extractions
  SET commission_amount = _rate
  WHERE partner_id = _partner_id AND commission_month = _month_start;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_partner_slab_recompute()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _pid UUID;
BEGIN
  _pid := COALESCE(NEW.partner_id, OLD.partner_id);
  IF _pid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  PERFORM public.recompute_partner_commission(_pid, cm)
  FROM (
    SELECT DISTINCT commission_month AS cm
    FROM public.extractions
    WHERE partner_id = _pid AND commission_month IS NOT NULL
  ) s;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS commission_slabs_recompute_ins ON public.commission_slabs;
DROP TRIGGER IF EXISTS commission_slabs_recompute_upd ON public.commission_slabs;
DROP TRIGGER IF EXISTS commission_slabs_recompute_del ON public.commission_slabs;

CREATE TRIGGER commission_slabs_recompute_ins
  AFTER INSERT ON public.commission_slabs
  FOR EACH ROW WHEN (NEW.partner_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_partner_slab_recompute();

CREATE TRIGGER commission_slabs_recompute_upd
  AFTER UPDATE ON public.commission_slabs
  FOR EACH ROW WHEN (NEW.partner_id IS NOT NULL OR OLD.partner_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_partner_slab_recompute();

CREATE TRIGGER commission_slabs_recompute_del
  AFTER DELETE ON public.commission_slabs
  FOR EACH ROW WHEN (OLD.partner_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_partner_slab_recompute();
