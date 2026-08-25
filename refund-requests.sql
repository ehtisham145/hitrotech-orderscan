-- =========================================================
-- Refund requests: when a workspace has unused, paid-for value
-- and wants the money back instead of credit/time.
-- Run this once in the SQL editor.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.refund_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  requested_by  uuid NOT NULL,
  amount_pkr    integer NOT NULL CHECK (amount_pkr >= 0),
  plan_tier     text,
  unused_days   integer NOT NULL DEFAULT 0,
  reason        text,
  bank_details  text,
  status        text NOT NULL DEFAULT 'pending',
  admin_note    text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.refund_requests TO authenticated;
GRANT ALL ON public.refund_requests TO service_role;

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own workspace refunds" ON public.refund_requests;
CREATE POLICY "members read own workspace refunds"
  ON public.refund_requests FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_workspace_role(workspace_id, ARRAY['owner','admin'], auth.uid())
  );

DROP POLICY IF EXISTS "owners request refunds" ON public.refund_requests;
CREATE POLICY "owners request refunds"
  ON public.refund_requests FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND public.has_workspace_role(workspace_id, ARRAY['owner','admin'], auth.uid())
  );

DROP POLICY IF EXISTS "super admin decides refunds" ON public.refund_requests;
CREATE POLICY "super admin decides refunds"
  ON public.refund_requests FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP TRIGGER IF EXISTS trg_refund_requests_updated_at ON public.refund_requests;
CREATE TRIGGER trg_refund_requests_updated_at
  BEFORE UPDATE ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS refund_requests_ws_idx ON public.refund_requests(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refund_requests_status_idx ON public.refund_requests(status, created_at DESC);
