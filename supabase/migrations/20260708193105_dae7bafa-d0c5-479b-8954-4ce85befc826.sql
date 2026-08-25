CREATE POLICY "Users read own report files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'reports' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Managers read all report files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'reports' AND public.is_manager_or_admin(auth.uid()));