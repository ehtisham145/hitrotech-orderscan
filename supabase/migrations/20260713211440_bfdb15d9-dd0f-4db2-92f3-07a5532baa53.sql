
DROP POLICY IF EXISTS "Users delete own report files" ON storage.objects;
CREATE POLICY "Users delete own report files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'reports'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );
