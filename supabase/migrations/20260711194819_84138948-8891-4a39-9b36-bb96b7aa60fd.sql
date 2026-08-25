DROP POLICY IF EXISTS "partners_select_authenticated" ON public.partners;

CREATE POLICY "Managers/admins can view partners" ON public.partners
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));