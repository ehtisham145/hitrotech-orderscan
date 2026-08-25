
-- 1) Tighten commission_slabs SELECT: drop the broad USING (true) policy
--    and replace with a manager/admin policy. Partners still get their own
--    role's slabs via the existing "Partners can view commission slabs" policy.
DROP POLICY IF EXISTS "slabs_select_authenticated" ON public.commission_slabs;

CREATE POLICY "slabs_select_manager_admin" ON public.commission_slabs
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- 2) Revoke public/anon/authenticated EXECUTE on internal trigger functions.
--    These are invoked by triggers as the table owner and should never be
--    callable directly from the Data API.
REVOKE ALL ON FUNCTION public.compute_extraction_anomalies() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_month_lock_on_extractions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_row_change() FROM PUBLIC, anon, authenticated;
