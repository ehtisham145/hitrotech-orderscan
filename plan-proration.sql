-- =========================================================
-- Plan changes: proration credits, scheduled downgrades
-- Run this once in the SQL editor.
-- =========================================================

-- 1) Extra columns on billing requests -------------------------------------
ALTER TABLE public.billing_requests
  ADD COLUMN IF NOT EXISTS gross_pkr      integer,
  ADD COLUMN IF NOT EXISTS credit_pkr     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS change_type    text    NOT NULL DEFAULT 'renewal',
  ADD COLUMN IF NOT EXISTS effective_from timestamptz;

UPDATE public.billing_requests SET gross_pkr = amount_pkr WHERE gross_pkr IS NULL;

-- 2) Scheduled (future) plan on the workspace ------------------------------
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS scheduled_plan_tier text,
  ADD COLUMN IF NOT EXISTS scheduled_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_months    integer;

-- 3) Approval: upgrades/renewals apply now, downgrades are scheduled -------
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

  _plan_seats := CASE _req.plan_tier::text
    WHEN 'free' THEN 2
    WHEN 'starter' THEN 5
    WHEN 'pro' THEN 15
    WHEN 'enterprise' THEN 999
    ELSE 3
  END;

  IF _req.change_type = 'downgrade' AND _current_expiry IS NOT NULL AND _current_expiry > now() THEN
    -- Keep the richer plan until the paid term ends, then switch.
    UPDATE public.workspaces
       SET scheduled_plan_tier = _req.plan_tier::text,
           scheduled_starts_at = COALESCE(_req.effective_from, _current_expiry),
           scheduled_months    = _req.months
     WHERE id = _req.workspace_id;
  ELSE
    -- Upgrade or renewal: applies immediately, unused time is never lost.
    _new_expiry := GREATEST(COALESCE(_current_expiry, now()), now()) + (_req.months || ' months')::interval;

    UPDATE public.workspaces
       SET plan_tier = _req.plan_tier,
           plan_activated_at = COALESCE(plan_activated_at, now()),
           plan_expires_at = _new_expiry,
           seat_limit = GREATEST(seat_limit, _plan_seats),
           scheduled_plan_tier = NULL,
           scheduled_starts_at = NULL,
           scheduled_months    = NULL
     WHERE id = _req.workspace_id;
  END IF;

  UPDATE public.billing_requests
     SET status = 'approved',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         admin_note = COALESCE(_admin_note, admin_note)
   WHERE id = _request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_billing_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_billing_request(uuid, text) TO authenticated;

-- 4) Apply scheduled downgrades once their start date arrives --------------
CREATE OR REPLACE FUNCTION public.apply_scheduled_plan_changes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer := 0;
BEGIN
  WITH due AS (
    SELECT id, scheduled_plan_tier, scheduled_starts_at, COALESCE(scheduled_months, 1) AS months
      FROM public.workspaces
     WHERE scheduled_plan_tier IS NOT NULL
       AND scheduled_starts_at IS NOT NULL
       AND scheduled_starts_at <= now()
  ), upd AS (
    UPDATE public.workspaces w
       SET plan_tier = d.scheduled_plan_tier::plan_tier,
           plan_expires_at = d.scheduled_starts_at + (d.months || ' months')::interval,
           seat_limit = CASE d.scheduled_plan_tier
             WHEN 'free' THEN 2 WHEN 'starter' THEN 5
             WHEN 'pro' THEN 15 WHEN 'enterprise' THEN 999 ELSE 3 END,
           scheduled_plan_tier = NULL,
           scheduled_starts_at = NULL,
           scheduled_months    = NULL
      FROM due d
     WHERE w.id = d.id
    RETURNING w.id
  )
  SELECT count(*) INTO _count FROM upd;
  RETURN _count;
END;
$$;

-- 5) Expire lapsed paid plans back to Free ---------------------------------
CREATE OR REPLACE FUNCTION public.expire_lapsed_plans()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _count integer := 0;
BEGIN
  WITH upd AS (
    UPDATE public.workspaces
       SET plan_tier = 'free', seat_limit = GREATEST(seat_limit, 2)
     WHERE plan_tier <> 'free'
       AND plan_tier <> 'enterprise'
       AND plan_expires_at IS NOT NULL
       AND plan_expires_at < now()
       AND scheduled_plan_tier IS NULL
    RETURNING id
  )
  SELECT count(*) INTO _count FROM upd;
  RETURN _count;
END;
$$;

-- 6) Nightly job: apply schedules first, then expire lapsed plans ----------
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('apply-plan-changes') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'apply-plan-changes'
);

SELECT cron.schedule(
  'apply-plan-changes',
  '10 0 * * *',  -- every day, 00:10
  $$ SELECT public.apply_scheduled_plan_changes(); SELECT public.expire_lapsed_plans(); $$
);
