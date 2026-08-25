-- Enable pg_cron for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Function that downgrades workspaces whose plan has expired
CREATE OR REPLACE FUNCTION public.expire_workspace_plans()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ws RECORD;
BEGIN
  FOR _ws IN
    SELECT id, name, plan_tier, plan_expires_at
    FROM public.workspaces
    WHERE plan_expires_at IS NOT NULL
      AND plan_expires_at < now()
      AND plan_tier <> 'free'
  LOOP
    UPDATE public.workspaces
       SET plan_tier = 'free',
           seat_limit = LEAST(seat_limit, 2)
     WHERE id = _ws.id;

    INSERT INTO public.audit_logs (user_id, workspace_id, action, entity_type, entity_id, details)
    VALUES (
      NULL,
      _ws.id,
      'workspace.plan_expired',
      'workspace',
      _ws.id,
      jsonb_build_object(
        'previous_plan', _ws.plan_tier,
        'expired_at', _ws.plan_expires_at,
        'downgraded_to', 'free'
      )
    );
  END LOOP;
END;
$$;

-- Schedule the job to run every day at midnight UTC
SELECT cron.schedule(
  'expire-workspace-plans-daily',
  '0 0 * * *',
  $$SELECT public.expire_workspace_plans();$$
);
