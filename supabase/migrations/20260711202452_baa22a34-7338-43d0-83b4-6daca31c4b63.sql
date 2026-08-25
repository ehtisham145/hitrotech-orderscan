
-- Widen partner visibility and editing to all staff (employee/manager/admin).
-- Delete stays admin-only.

DROP POLICY IF EXISTS "Managers/admins can view partners" ON public.partners;
CREATE POLICY "Staff can view partners" ON public.partners
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'employee')
  );

DROP POLICY IF EXISTS "partners_insert_admin_manager" ON public.partners;
CREATE POLICY "Staff can insert partners" ON public.partners
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'employee')
  );

DROP POLICY IF EXISTS "partners_update_admin_manager" ON public.partners;
CREATE POLICY "Staff can update partners" ON public.partners
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'employee')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'employee')
  );
