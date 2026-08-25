
-- Scope manager/admin storage access to files owned by users in the same workspace.
-- Report/screenshot paths are `<owner_user_id>/...`, so we resolve the owner from the
-- first folder segment, then check the caller shares a workspace with them where the
-- caller holds owner/admin/manager. Super admins retain global access.

CREATE OR REPLACE FUNCTION public.can_manage_user_files(_owner uuid, _caller uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin(_caller)
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members caller_m
      JOIN public.workspace_members owner_m
        ON owner_m.workspace_id = caller_m.workspace_id
      WHERE caller_m.user_id = _caller
        AND caller_m.role::text IN ('owner','admin','manager')
        AND owner_m.user_id = _owner
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_user_files(uuid, uuid) TO authenticated, service_role;

-- Reports: replace global manager policies with workspace-scoped ones
DROP POLICY IF EXISTS "Managers read all report files" ON storage.objects;
DROP POLICY IF EXISTS "Managers delete all report files" ON storage.objects;

CREATE POLICY "Managers read same-workspace report files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'reports'
  AND public.can_manage_user_files(
    NULLIF((storage.foldername(name))[1], '')::uuid
  )
);

CREATE POLICY "Managers delete same-workspace report files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'reports'
  AND public.can_manage_user_files(
    NULLIF((storage.foldername(name))[1], '')::uuid
  )
);

-- Screenshots: tighten the SELECT policy (owner OR same-workspace manager, not any manager globally)
DROP POLICY IF EXISTS "Users read own screenshots" ON storage.objects;

CREATE POLICY "Users read own or same-workspace screenshots"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'screenshots'
  AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR public.can_manage_user_files(
      NULLIF((storage.foldername(name))[1], '')::uuid
    )
  )
);
