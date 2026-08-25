DROP POLICY IF EXISTS "Users can view company extractions" ON public.extractions;
CREATE POLICY "Users can view own extractions or managers all" ON public.extractions
FOR SELECT TO authenticated
USING (created_by = auth.uid() OR public.is_manager_or_admin(auth.uid()));