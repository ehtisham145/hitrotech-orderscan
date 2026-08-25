
-- Partner role enum
CREATE TYPE public.partner_role AS ENUM ('franchise_owner', 'retailer', 'franchise_as_retailer', 'field_worker');

-- =========================
-- partners table
-- =========================
CREATE TABLE public.partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  cnic TEXT,
  address TEXT,
  city TEXT,
  store_id TEXT,
  role public.partner_role NOT NULL,
  match_keys TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  join_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX partners_store_id_idx ON public.partners(store_id);
CREATE INDEX partners_role_idx ON public.partners(role);
CREATE INDEX partners_active_idx ON public.partners(active);
CREATE INDEX partners_match_keys_idx ON public.partners USING GIN (match_keys);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partners TO authenticated;
GRANT ALL ON public.partners TO service_role;

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partners_select_authenticated"
  ON public.partners FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "partners_insert_admin_manager"
  ON public.partners FOR INSERT
  TO authenticated
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

CREATE POLICY "partners_update_admin_manager"
  ON public.partners FOR UPDATE
  TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

CREATE POLICY "partners_delete_admin"
  ON public.partners FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER partners_set_updated_at
  BEFORE UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- commission_slabs table
-- =========================
CREATE TABLE public.commission_slabs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.partner_role NOT NULL,
  min_count INTEGER NOT NULL,
  max_count INTEGER, -- NULL means "and above"
  rate_pkr INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT slabs_min_positive CHECK (min_count >= 1),
  CONSTRAINT slabs_rate_positive CHECK (rate_pkr >= 0),
  CONSTRAINT slabs_range_valid CHECK (max_count IS NULL OR max_count >= min_count)
);

CREATE INDEX commission_slabs_role_idx ON public.commission_slabs(role) WHERE active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commission_slabs TO authenticated;
GRANT ALL ON public.commission_slabs TO service_role;

ALTER TABLE public.commission_slabs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "slabs_select_authenticated"
  ON public.commission_slabs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "slabs_insert_admin"
  ON public.commission_slabs FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "slabs_update_admin"
  ON public.commission_slabs FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "slabs_delete_admin"
  ON public.commission_slabs FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER commission_slabs_set_updated_at
  BEFORE UPDATE ON public.commission_slabs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed slabs
INSERT INTO public.commission_slabs (role, min_count, max_count, rate_pkr) VALUES
  ('franchise_owner', 1, 50, 600),
  ('franchise_owner', 51, 150, 750),
  ('franchise_owner', 151, 300, 850),
  ('franchise_owner', 301, NULL, 1000),
  ('retailer', 1, 20, 400),
  ('retailer', 21, 50, 500),
  ('retailer', 51, NULL, 700),
  ('franchise_as_retailer', 1, 50, 500),
  ('franchise_as_retailer', 51, 150, 650),
  ('franchise_as_retailer', 151, 300, 750),
  ('franchise_as_retailer', 301, NULL, 1000),
  ('field_worker', 1, NULL, 500);

-- =========================
-- extractions columns
-- =========================
ALTER TABLE public.extractions
  ADD COLUMN partner_id UUID REFERENCES public.partners(id) ON DELETE SET NULL,
  ADD COLUMN commission_amount INTEGER,
  ADD COLUMN commission_month DATE;

CREATE INDEX extractions_partner_month_idx
  ON public.extractions(partner_id, commission_month)
  WHERE partner_id IS NOT NULL AND is_duplicate = false;

-- =========================
-- Commission recompute function
-- =========================
CREATE OR REPLACE FUNCTION public.recompute_partner_commission(_partner_id UUID, _month DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Count successful, non-duplicate activations for this partner in this month
  SELECT COUNT(*) INTO _count
  FROM public.extractions
  WHERE partner_id = _partner_id
    AND commission_month = _month_start
    AND status = 'success'
    AND is_duplicate = false;

  -- Look up the slab rate for this count
  SELECT rate_pkr INTO _rate
  FROM public.commission_slabs
  WHERE role = _role
    AND active = true
    AND _count >= min_count
    AND (max_count IS NULL OR _count <= max_count)
  ORDER BY min_count DESC
  LIMIT 1;

  IF _rate IS NULL THEN _rate := 0; END IF;

  -- Apply the rate to every row in this partner/month
  UPDATE public.extractions
  SET commission_amount = _rate
  WHERE partner_id = _partner_id
    AND commission_month = _month_start;
END;
$$;

-- =========================
-- Trigger: recompute after extractions change
-- =========================
CREATE OR REPLACE FUNCTION public.trg_extractions_recompute_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- New/updated row now belongs to a partner
  IF NEW.partner_id IS NOT NULL AND NEW.commission_month IS NOT NULL THEN
    PERFORM public.recompute_partner_commission(NEW.partner_id, NEW.commission_month);
  END IF;

  -- Row moved off an old partner/month — recompute the old bucket too
  IF TG_OP = 'UPDATE' THEN
    IF OLD.partner_id IS NOT NULL
       AND (OLD.partner_id IS DISTINCT FROM NEW.partner_id
            OR OLD.commission_month IS DISTINCT FROM NEW.commission_month) THEN
      PERFORM public.recompute_partner_commission(OLD.partner_id, OLD.commission_month);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER extractions_recompute_commission
  AFTER INSERT OR UPDATE OF partner_id, commission_month, status, is_duplicate
  ON public.extractions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_extractions_recompute_commission();
