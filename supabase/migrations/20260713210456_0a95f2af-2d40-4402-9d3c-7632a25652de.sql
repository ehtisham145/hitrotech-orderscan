
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
  _plan_seats INTEGER;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only super admin can approve billing requests';
  END IF;

  SELECT * INTO _req FROM public.billing_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF _req.status <> 'pending' THEN RAISE EXCEPTION 'Request already %', _req.status; END IF;

  SELECT plan_expires_at INTO _current_expiry FROM public.workspaces WHERE id = _req.workspace_id;
  _new_expiry := GREATEST(COALESCE(_current_expiry, now()), now()) + (_req.months || ' months')::interval;

  _plan_seats := CASE _req.plan_tier::text
    WHEN 'free' THEN 2
    WHEN 'starter' THEN 5
    WHEN 'pro' THEN 15
    WHEN 'enterprise' THEN 999
    ELSE 3
  END;

  UPDATE public.workspaces
     SET plan_tier = _req.plan_tier,
         plan_activated_at = COALESCE(plan_activated_at, now()),
         plan_expires_at = _new_expiry,
         seat_limit = GREATEST(seat_limit, _plan_seats)
   WHERE id = _req.workspace_id;

  UPDATE public.billing_requests
     SET status = 'approved',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         admin_note = COALESCE(_admin_note, admin_note)
   WHERE id = _request_id;
END;
$$;

-- Backfill existing workspaces to plan defaults
UPDATE public.workspaces SET seat_limit = 15 WHERE plan_tier = 'pro' AND seat_limit < 15;
UPDATE public.workspaces SET seat_limit = 5 WHERE plan_tier = 'starter' AND seat_limit < 5;
UPDATE public.workspaces SET seat_limit = 999 WHERE plan_tier = 'enterprise' AND seat_limit < 999;
UPDATE public.workspaces SET seat_limit = 2 WHERE plan_tier = 'free' AND seat_limit < 2;
