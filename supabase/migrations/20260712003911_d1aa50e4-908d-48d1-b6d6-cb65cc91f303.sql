
CREATE POLICY "workspace members read logos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'workspace-logos'
    AND public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY "workspace admins upload logos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'workspace-logos'
    AND public.has_workspace_role((storage.foldername(name))[1]::uuid, ARRAY['owner','admin'])
  );

CREATE POLICY "workspace admins update logos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'workspace-logos'
    AND public.has_workspace_role((storage.foldername(name))[1]::uuid, ARRAY['owner','admin'])
  );

CREATE POLICY "workspace admins delete logos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'workspace-logos'
    AND public.has_workspace_role((storage.foldername(name))[1]::uuid, ARRAY['owner','admin'])
  );
