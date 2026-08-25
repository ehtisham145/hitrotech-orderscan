-- Plan tier enum for workspace billing
DO $$ BEGIN
  CREATE TYPE public.workspace_plan AS ENUM ('free','starter','pro','enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS plan_tier public.workspace_plan NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS seat_limit INTEGER NOT NULL DEFAULT 3;

-- Default seat limit sanity: keep positive
ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_seat_limit_positive;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_seat_limit_positive CHECK (seat_limit > 0);

-- Seat usage helper: counts active members + non-expired pending invites
CREATE OR REPLACE FUNCTION public.workspace_seat_usage(_ws UUID)
RETURNS TABLE (members_count INTEGER, pending_invites INTEGER, seats_used INTEGER, seat_limit INTEGER, plan_tier public.workspace_plan)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)::int FROM public.workspace_members WHERE workspace_id = _ws) AS members_count,
    (SELECT COUNT(*)::int FROM public.workspace_invites
       WHERE workspace_id = _ws AND accepted_at IS NULL AND expires_at > now()) AS pending_invites,
    (SELECT COUNT(*)::int FROM public.workspace_members WHERE workspace_id = _ws)
      + (SELECT COUNT(*)::int FROM public.workspace_invites
           WHERE workspace_id = _ws AND accepted_at IS NULL AND expires_at > now()) AS seats_used,
    (SELECT seat_limit FROM public.workspaces WHERE id = _ws) AS seat_limit,
    (SELECT plan_tier FROM public.workspaces WHERE id = _ws) AS plan_tier;
$$;

GRANT EXECUTE ON FUNCTION public.workspace_seat_usage(UUID) TO authenticated, service_role;
