ALTER PUBLICATION supabase_realtime ADD TABLE public.extractions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.batches;
ALTER TABLE public.extractions REPLICA IDENTITY FULL;
ALTER TABLE public.batches REPLICA IDENTITY FULL;