
DROP POLICY IF EXISTS "Members read co-worker profiles" ON public.profiles;
CREATE POLICY "Members read co-worker profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm_self
    JOIN public.workspace_members wm_other ON wm_other.workspace_id = wm_self.workspace_id
    WHERE wm_self.user_id = auth.uid() AND wm_other.user_id = profiles.id
  ));

DROP POLICY IF EXISTS "Super admins read all profiles" ON public.profiles;
CREATE POLICY "Super admins read all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));
