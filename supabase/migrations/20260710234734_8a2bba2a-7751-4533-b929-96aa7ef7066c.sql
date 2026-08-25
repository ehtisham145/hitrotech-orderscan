-- Preset lists for store IDs, employees, and branches so admins can manage
-- them from the app instead of editing code.

CREATE TABLE public.stores (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  label text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stores TO authenticated;
GRANT ALL ON public.stores TO service_role;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone signed in can read stores" ON public.stores FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage stores" ON public.stores FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid())) WITH CHECK (public.is_manager_or_admin(auth.uid()));
CREATE TRIGGER stores_set_updated_at BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.employees (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone signed in can read employees" ON public.employees FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage employees" ON public.employees FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid())) WITH CHECK (public.is_manager_or_admin(auth.uid()));
CREATE TRIGGER employees_set_updated_at BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.branches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO authenticated;
GRANT ALL ON public.branches TO service_role;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone signed in can read branches" ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage branches" ON public.branches FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid())) WITH CHECK (public.is_manager_or_admin(auth.uid()));
CREATE TRIGGER branches_set_updated_at BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed with existing hardcoded values so the current UX is preserved.
INSERT INTO public.stores(code, sort_order) VALUES
  ('FD4001', 1), ('FD4002', 2), ('FD4004', 3)
  ON CONFLICT (code) DO NOTHING;
INSERT INTO public.employees(name, sort_order) VALUES
  ('Areeba Yunas', 1)
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.branches(name, sort_order) VALUES
  ('HitroTech Telecom Jauharabad', 1)
  ON CONFLICT (name) DO NOTHING;

-- Add a scope column to report_views so saved presets can be reused
-- by Orders and other pages without cross-contaminating the Reports list.
ALTER TABLE public.report_views
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'reports';
CREATE INDEX IF NOT EXISTS report_views_user_scope_idx ON public.report_views(user_id, scope);