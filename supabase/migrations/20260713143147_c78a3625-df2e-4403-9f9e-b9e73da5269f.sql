
-- 1) Restrict billing_settings SELECT to workspace owners/admins (or super admin)
DROP POLICY IF EXISTS "read billing settings" ON public.billing_settings;

CREATE POLICY "Owners/admins read billing settings"
ON public.billing_settings
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.user_id = auth.uid()
      AND wm.role::text IN ('owner','admin')
  )
);

-- 2) Revoke anon EXECUTE on SECURITY DEFINER helper
REVOKE EXECUTE ON FUNCTION public.can_manage_user_files(uuid, uuid) FROM PUBLIC, anon;
