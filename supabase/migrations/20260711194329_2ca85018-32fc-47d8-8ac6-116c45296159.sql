CREATE TABLE public.partner_payouts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  activations_count INTEGER NOT NULL DEFAULT 0,
  rate_pkr INTEGER NOT NULL DEFAULT 0,
  amount_pkr INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  paid_by UUID REFERENCES auth.users(id),
  payment_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (partner_id, month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_payouts TO authenticated;
GRANT ALL ON public.partner_payouts TO service_role;

ALTER TABLE public.partner_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers/admins can view payouts" ON public.partner_payouts
  FOR SELECT TO authenticated USING (public.is_manager_or_admin(auth.uid()));
CREATE POLICY "Managers/admins can insert payouts" ON public.partner_payouts
  FOR INSERT TO authenticated WITH CHECK (public.is_manager_or_admin(auth.uid()));
CREATE POLICY "Managers/admins can update payouts" ON public.partner_payouts
  FOR UPDATE TO authenticated USING (public.is_manager_or_admin(auth.uid())) WITH CHECK (public.is_manager_or_admin(auth.uid()));
CREATE POLICY "Admins can delete payouts" ON public.partner_payouts
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_partner_payouts_updated_at
  BEFORE UPDATE ON public.partner_payouts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_partner_payouts_month ON public.partner_payouts (month DESC);
CREATE INDEX idx_partner_payouts_partner ON public.partner_payouts (partner_id);