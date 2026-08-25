CREATE TABLE public.report_views (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_views TO authenticated;
GRANT ALL ON public.report_views TO service_role;

ALTER TABLE public.report_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their views" ON public.report_views
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Managers and admins can view all" ON public.report_views
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

CREATE TRIGGER trg_report_views_updated_at
  BEFORE UPDATE ON public.report_views
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();