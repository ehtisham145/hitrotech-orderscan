-- Tighten profiles read: super admins only (was any 'admin' globally)
DROP POLICY IF EXISTS "Admins read all profiles" ON public.profiles;

CREATE POLICY "Super admins read all profiles"
ON public.profiles
FOR SELECT
USING (public.is_super_admin(auth.uid()));

-- Allow reading profiles of co-members within the same workspace so team UIs still work
CREATE POLICY "Members read co-worker profiles"
ON public.profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm_self
    JOIN public.workspace_members wm_other
      ON wm_other.workspace_id = wm_self.workspace_id
    WHERE wm_self.user_id = auth.uid()
      AND wm_other.user_id = public.profiles.id
  )
);

-- Reports bucket: allow owners to delete their own files; managers/admins can delete any
CREATE POLICY "Users delete own report files"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'reports'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

CREATE POLICY "Managers delete all report files"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'reports'
  AND public.is_manager_or_admin(auth.uid())
);
