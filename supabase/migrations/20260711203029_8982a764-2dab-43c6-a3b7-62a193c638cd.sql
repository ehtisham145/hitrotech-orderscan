
DROP POLICY IF EXISTS "Staff can view partners" ON public.partners;
CREATE POLICY "Managers/admins can view partners" ON public.partners
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

DROP POLICY IF EXISTS "Staff can insert partners" ON public.partners;
CREATE POLICY "partners_insert_admin_manager" ON public.partners
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

DROP POLICY IF EXISTS "Staff can update partners" ON public.partners;
CREATE POLICY "partners_update_admin_manager" ON public.partners
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));
