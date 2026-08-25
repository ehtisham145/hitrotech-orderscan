
-- 1. Plan expiry columns on workspaces
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS plan_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz;

-- 2. Billing settings (singleton row, keyed by id='global')
CREATE TABLE IF NOT EXISTS public.billing_settings (
  id text PRIMARY KEY DEFAULT 'global',
  bank_name text NOT NULL DEFAULT 'Meezan Bank',
  account_title text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  iban text NOT NULL DEFAULT '',
  branch text NOT NULL DEFAULT '',
  branch_code text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT 'Send proof of payment to billing@hitrotech.com or WhatsApp +92-XXX-XXXXXXX with your workspace reference.',
  contact_email text NOT NULL DEFAULT 'billing@hitrotech.com',
  contact_whatsapp text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_settings_singleton CHECK (id = 'global')
);

GRANT SELECT ON public.billing_settings TO authenticated;
GRANT ALL ON public.billing_settings TO service_role;

ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read billing settings" ON public.billing_settings;
CREATE POLICY "read billing settings" ON public.billing_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "super admin manages billing settings" ON public.billing_settings;
CREATE POLICY "super admin manages billing settings" ON public.billing_settings
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

INSERT INTO public.billing_settings (id) VALUES ('global') ON CONFLICT DO NOTHING;

-- 3. Billing requests
CREATE TABLE IF NOT EXISTS public.billing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_tier public.workspace_plan NOT NULL,
  amount_pkr integer NOT NULL,
  months integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected | cancelled
  payment_reference text,
  payer_note text,
  admin_note text,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_requests_ws_idx ON public.billing_requests(workspace_id);
CREATE INDEX IF NOT EXISTS billing_requests_status_idx ON public.billing_requests(status);

GRANT SELECT, INSERT, UPDATE ON public.billing_requests TO authenticated;
GRANT ALL ON public.billing_requests TO service_role;

ALTER TABLE public.billing_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace admins read own requests" ON public.billing_requests;
CREATE POLICY "workspace admins read own requests" ON public.billing_requests
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_workspace_role(workspace_id, ARRAY['owner','admin']::text[], auth.uid())
  );

DROP POLICY IF EXISTS "workspace admins create requests" ON public.billing_requests;
CREATE POLICY "workspace admins create requests" ON public.billing_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND public.has_workspace_role(workspace_id, ARRAY['owner','admin']::text[], auth.uid())
  );

DROP POLICY IF EXISTS "workspace owners cancel own pending" ON public.billing_requests;
CREATE POLICY "workspace owners cancel own pending" ON public.billing_requests
  FOR UPDATE TO authenticated
  USING (
    public.has_workspace_role(workspace_id, ARRAY['owner','admin']::text[], auth.uid())
    AND status = 'pending'
  )
  WITH CHECK (
    public.has_workspace_role(workspace_id, ARRAY['owner','admin']::text[], auth.uid())
    AND status IN ('pending','cancelled')
  );

DROP POLICY IF EXISTS "super admin manages billing requests" ON public.billing_requests;
CREATE POLICY "super admin manages billing requests" ON public.billing_requests
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP TRIGGER IF EXISTS trg_billing_requests_updated_at ON public.billing_requests;
CREATE TRIGGER trg_billing_requests_updated_at
  BEFORE UPDATE ON public.billing_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_billing_settings_updated_at ON public.billing_settings;
CREATE TRIGGER trg_billing_settings_updated_at
  BEFORE UPDATE ON public.billing_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Approve function: super-admin activates a plan for N months
CREATE OR REPLACE FUNCTION public.approve_billing_request(_request_id uuid, _admin_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req public.billing_requests%ROWTYPE;
  _new_expiry timestamptz;
  _current_expiry timestamptz;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only super admin can approve billing requests';
  END IF;

  SELECT * INTO _req FROM public.billing_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF _req.status <> 'pending' THEN RAISE EXCEPTION 'Request already %', _req.status; END IF;

  SELECT plan_expires_at INTO _current_expiry FROM public.workspaces WHERE id = _req.workspace_id;

  -- Extend from current expiry if still valid, else from now
  _new_expiry := GREATEST(COALESCE(_current_expiry, now()), now()) + (_req.months || ' months')::interval;

  UPDATE public.workspaces
     SET plan_tier = _req.plan_tier,
         plan_activated_at = COALESCE(plan_activated_at, now()),
         plan_expires_at = _new_expiry
   WHERE id = _req.workspace_id;

  UPDATE public.billing_requests
     SET status = 'approved',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         admin_note = COALESCE(_admin_note, admin_note)
   WHERE id = _request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_billing_request(_request_id uuid, _admin_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only super admin can reject billing requests';
  END IF;
  UPDATE public.billing_requests
     SET status = 'rejected',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         admin_note = COALESCE(_admin_note, admin_note)
   WHERE id = _request_id AND status = 'pending';
END;
$$;
