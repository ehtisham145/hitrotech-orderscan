-- ============================================================
-- 1) AUDIT TRAIL on partners / commission_slabs / partner_payouts
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_row_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  entity TEXT := TG_ARGV[0];
  action TEXT;
  eid UUID;
  payload JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    action := entity || '.create';
    eid := NEW.id;
    payload := jsonb_build_object('after', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    action := entity || '.update';
    eid := NEW.id;
    payload := jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    action := entity || '.delete';
    eid := OLD.id;
    payload := jsonb_build_object('before', to_jsonb(OLD));
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), action, entity, eid, payload);

  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER trg_partners_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.log_row_change('partner');

CREATE TRIGGER trg_slabs_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.commission_slabs
  FOR EACH ROW EXECUTE FUNCTION public.log_row_change('commission_slab');

CREATE TRIGGER trg_payouts_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_payouts
  FOR EACH ROW EXECUTE FUNCTION public.log_row_change('payout');

-- ============================================================
-- 2) ANOMALY DETECTION on extractions
-- ============================================================

ALTER TABLE public.extractions
  ADD COLUMN IF NOT EXISTS anomalies TEXT[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.compute_extraction_anomalies()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a TEXT[] := '{}';
  known BOOLEAN;
BEGIN
  IF NEW.status = 'success' AND NEW.is_duplicate = false THEN
    -- future activation date
    IF NEW.activation_date_parsed IS NOT NULL
       AND NEW.activation_date_parsed > (CURRENT_DATE + INTERVAL '1 day')::date THEN
      a := array_append(a, 'future_activation_date');
    END IF;

    -- unknown store id
    IF NEW.store_id IS NOT NULL AND btrim(NEW.store_id) <> '' THEN
      SELECT EXISTS(SELECT 1 FROM public.stores WHERE upper(code) = upper(NEW.store_id))
             OR upper(NEW.store_id) IN ('FD4001','FD4002','FD4004') INTO known;
      IF NOT known THEN
        a := array_append(a, 'unknown_store_id');
      END IF;
    END IF;

    -- missing phone
    IF NEW.phone_number IS NULL OR btrim(NEW.phone_number) = '' THEN
      a := array_append(a, 'missing_phone');
    ELSIF length(regexp_replace(NEW.phone_number, '\D', '', 'g')) < 10 THEN
      a := array_append(a, 'malformed_phone');
    END IF;

    -- missing order number
    IF NEW.order_number IS NULL OR btrim(NEW.order_number) = '' THEN
      a := array_append(a, 'missing_order_number');
    END IF;
  END IF;

  NEW.anomalies := a;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_extractions_anomalies ON public.extractions;
CREATE TRIGGER trg_extractions_anomalies
  BEFORE INSERT OR UPDATE ON public.extractions
  FOR EACH ROW EXECUTE FUNCTION public.compute_extraction_anomalies();

CREATE INDEX IF NOT EXISTS idx_extractions_has_anomalies
  ON public.extractions USING GIN (anomalies)
  WHERE array_length(anomalies, 1) > 0;

-- Backfill existing rows
UPDATE public.extractions SET updated_at = updated_at WHERE anomalies = '{}';

-- ============================================================
-- 3) MONTH LOCKS
-- ============================================================

CREATE TABLE public.month_locks (
  month DATE NOT NULL PRIMARY KEY,
  locked_by UUID REFERENCES auth.users(id),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.month_locks TO authenticated;
GRANT ALL ON public.month_locks TO service_role;

ALTER TABLE public.month_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers/admins can view month locks" ON public.month_locks
  FOR SELECT TO authenticated USING (public.is_manager_or_admin(auth.uid()));
CREATE POLICY "Admins can lock months" ON public.month_locks
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can unlock months" ON public.month_locks
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can annotate month locks" ON public.month_locks
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Block writes on extractions for a locked month
CREATE OR REPLACE FUNCTION public.enforce_month_lock_on_extractions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m1 DATE;
  m2 DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    m1 := OLD.commission_month;
    IF m1 IS NOT NULL AND EXISTS (SELECT 1 FROM public.month_locks WHERE month = m1) THEN
      RAISE EXCEPTION 'Month % is locked. Unlock it before deleting activations.', to_char(m1,'YYYY-MM');
    END IF;
    RETURN OLD;
  END IF;

  m1 := NEW.commission_month;
  m2 := CASE WHEN TG_OP = 'UPDATE' THEN OLD.commission_month ELSE NULL END;

  IF m1 IS NOT NULL AND EXISTS (SELECT 1 FROM public.month_locks WHERE month = m1) THEN
    RAISE EXCEPTION 'Month % is locked. Unlock it before editing activations.', to_char(m1,'YYYY-MM');
  END IF;
  IF m2 IS NOT NULL AND m2 IS DISTINCT FROM m1
     AND EXISTS (SELECT 1 FROM public.month_locks WHERE month = m2) THEN
    RAISE EXCEPTION 'Month % is locked. Unlock it before moving activations out of it.', to_char(m2,'YYYY-MM');
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_extractions_month_lock
  BEFORE UPDATE OR DELETE ON public.extractions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_month_lock_on_extractions();

-- ============================================================
-- 4) RECONCILIATION SNAPSHOT
-- ============================================================

ALTER TABLE public.partner_payouts
  ADD COLUMN IF NOT EXISTS snapshot_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS snapshot_count INTEGER,
  ADD COLUMN IF NOT EXISTS snapshot_amount INTEGER;

-- Recent-audit helper (fast recent-activity read for managers/admins)
GRANT SELECT ON public.audit_logs TO authenticated;