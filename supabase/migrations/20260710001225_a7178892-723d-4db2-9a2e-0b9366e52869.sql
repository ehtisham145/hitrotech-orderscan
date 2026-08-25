DROP POLICY IF EXISTS "Users manage own extractions" ON public.extractions;

CREATE POLICY "Users can view company extractions"
ON public.extractions
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can create own extractions"
ON public.extractions
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update own extractions or managers can update all"
ON public.extractions
FOR UPDATE
TO authenticated
USING ((created_by = auth.uid()) OR public.is_manager_or_admin(auth.uid()))
WITH CHECK ((created_by = auth.uid()) OR public.is_manager_or_admin(auth.uid()));

CREATE POLICY "Users can delete own extractions or managers can delete all"
ON public.extractions
FOR DELETE
TO authenticated
USING ((created_by = auth.uid()) OR public.is_manager_or_admin(auth.uid()));