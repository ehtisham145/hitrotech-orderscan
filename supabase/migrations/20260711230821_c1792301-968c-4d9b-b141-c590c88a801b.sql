-- 1) WIPE TENANT DATA
TRUNCATE TABLE
  public.extractions, public.batches, public.partner_payouts,
  public.commission_slabs, public.partners, public.month_locks,
  public.audit_logs, public.generated_reports, public.scheduled_reports,
  public.report_views, public.stores, public.employees, public.branches
RESTART IDENTITY CASCADE;

DELETE FROM public.user_roles;

-- 2) WORKSPACES
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;

CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, role)
);
CREATE INDEX workspace_members_user_idx ON public.workspace_members(user_id);
CREATE INDEX workspace_members_ws_idx ON public.workspace_members(workspace_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;

CREATE TABLE public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.app_role NOT NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_invites_email_idx ON public.workspace_invites(lower(email));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_invites TO authenticated;
GRANT ALL ON public.workspace_invites TO service_role;

-- 3) HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = 'super_admin')
$fn$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_ws uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = _ws AND user_id = _user_id)
      OR public.is_super_admin(_user_id)
$fn$;

CREATE OR REPLACE FUNCTION public.has_workspace_role(_ws uuid, _roles text[], _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _ws AND user_id = _user_id AND role::text = ANY(_roles)
  ) OR public.is_super_admin(_user_id)
$fn$;

-- 4) ADD workspace_id COLUMNS
ALTER TABLE public.batches            ADD COLUMN workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.extractions        ADD COLUMN workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.partners           ADD COLUMN workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.commission_slabs   ADD COLUMN workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.partner_payouts    ADD COLUMN workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.month_locks        ADD COLUMN workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.stores             ADD COLUMN workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.employees          ADD COLUMN workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.branches           ADD COLUMN workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.generated_reports  ADD COLUMN workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.scheduled_reports  ADD COLUMN workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.report_views       ADD COLUMN workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.audit_logs         ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX batches_ws_idx           ON public.batches(workspace_id);
CREATE INDEX extractions_ws_idx       ON public.extractions(workspace_id);
CREATE INDEX partners_ws_idx          ON public.partners(workspace_id);
CREATE INDEX commission_slabs_ws_idx  ON public.commission_slabs(workspace_id);
CREATE INDEX partner_payouts_ws_idx   ON public.partner_payouts(workspace_id);
CREATE INDEX month_locks_ws_idx       ON public.month_locks(workspace_id);
CREATE INDEX stores_ws_idx            ON public.stores(workspace_id);
CREATE INDEX employees_ws_idx         ON public.employees(workspace_id);
CREATE INDEX branches_ws_idx          ON public.branches(workspace_id);
CREATE INDEX generated_reports_ws_idx ON public.generated_reports(workspace_id);
CREATE INDEX scheduled_reports_ws_idx ON public.scheduled_reports(workspace_id);
CREATE INDEX report_views_ws_idx      ON public.report_views(workspace_id);
CREATE INDEX audit_logs_ws_idx        ON public.audit_logs(workspace_id);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL;

-- 5) RLS on new tables
ALTER TABLE public.workspaces        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their workspaces" ON public.workspaces
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(id) OR public.is_super_admin());
CREATE POLICY "Any signed-in user can create a workspace" ON public.workspaces
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners update workspace" ON public.workspaces
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_super_admin())
  WITH CHECK (owner_id = auth.uid() OR public.is_super_admin());
CREATE POLICY "Owners delete workspace" ON public.workspaces
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.is_super_admin());

CREATE POLICY "View own memberships" ON public.workspace_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_workspace_role(workspace_id, ARRAY['owner','admin'])
    OR public.is_super_admin()
  );
CREATE POLICY "Owners/admins add members" ON public.workspace_members
  FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']) OR public.is_super_admin());
CREATE POLICY "Owners/admins update members" ON public.workspace_members
  FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']) OR public.is_super_admin())
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']) OR public.is_super_admin());
CREATE POLICY "Owners/admins remove members" ON public.workspace_members
  FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']) OR public.is_super_admin());

CREATE POLICY "Owners/admins view invites" ON public.workspace_invites
  FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']) OR public.is_super_admin());
CREATE POLICY "Owners/admins create invites" ON public.workspace_invites
  FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']) OR public.is_super_admin());
CREATE POLICY "Owners/admins update invites" ON public.workspace_invites
  FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']) OR public.is_super_admin())
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']) OR public.is_super_admin());
CREATE POLICY "Owners/admins delete invites" ON public.workspace_invites
  FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']) OR public.is_super_admin());

-- 6) Drop old tenant-table policies
DROP POLICY IF EXISTS "Users manage own batches" ON public.batches;
DROP POLICY IF EXISTS "Partners can view own extractions" ON public.extractions;
DROP POLICY IF EXISTS "Users can create own extractions" ON public.extractions;
DROP POLICY IF EXISTS "Users can delete own extractions or managers can delete all" ON public.extractions;
DROP POLICY IF EXISTS "Users can update own extractions or managers can update all" ON public.extractions;
DROP POLICY IF EXISTS "Users can view own extractions or managers all" ON public.extractions;
DROP POLICY IF EXISTS "Managers/admins can view partners" ON public.partners;
DROP POLICY IF EXISTS "Partners can view own record" ON public.partners;
DROP POLICY IF EXISTS "partners_delete_admin" ON public.partners;
DROP POLICY IF EXISTS "partners_insert_admin_manager" ON public.partners;
DROP POLICY IF EXISTS "partners_update_admin_manager" ON public.partners;
DROP POLICY IF EXISTS "Partners can view commission slabs" ON public.commission_slabs;
DROP POLICY IF EXISTS "slabs_delete_admin" ON public.commission_slabs;
DROP POLICY IF EXISTS "slabs_insert_admin" ON public.commission_slabs;
DROP POLICY IF EXISTS "slabs_select_manager_admin" ON public.commission_slabs;
DROP POLICY IF EXISTS "slabs_update_admin" ON public.commission_slabs;
DROP POLICY IF EXISTS "Admins can delete payouts" ON public.partner_payouts;
DROP POLICY IF EXISTS "Managers/admins can insert payouts" ON public.partner_payouts;
DROP POLICY IF EXISTS "Managers/admins can update payouts" ON public.partner_payouts;
DROP POLICY IF EXISTS "Managers/admins can view payouts" ON public.partner_payouts;
DROP POLICY IF EXISTS "Partners can view own payouts" ON public.partner_payouts;
DROP POLICY IF EXISTS "Admins can annotate month locks" ON public.month_locks;
DROP POLICY IF EXISTS "Admins can lock months" ON public.month_locks;
DROP POLICY IF EXISTS "Admins can unlock months" ON public.month_locks;
DROP POLICY IF EXISTS "Managers/admins can view month locks" ON public.month_locks;
DROP POLICY IF EXISTS "Admins manage stores" ON public.stores;
DROP POLICY IF EXISTS "Anyone signed in can read stores" ON public.stores;
DROP POLICY IF EXISTS "Admins manage employees" ON public.employees;
DROP POLICY IF EXISTS "Anyone signed in can read employees" ON public.employees;
DROP POLICY IF EXISTS "Admins manage branches" ON public.branches;
DROP POLICY IF EXISTS "Anyone signed in can read branches" ON public.branches;
DROP POLICY IF EXISTS "Managers view all generated" ON public.generated_reports;
DROP POLICY IF EXISTS "Owners delete own generated" ON public.generated_reports;
DROP POLICY IF EXISTS "Owners see own generated reports" ON public.generated_reports;
DROP POLICY IF EXISTS "Managers view all schedules" ON public.scheduled_reports;
DROP POLICY IF EXISTS "Owners manage own schedules" ON public.scheduled_reports;
DROP POLICY IF EXISTS "Managers and admins can view all" ON public.report_views;
DROP POLICY IF EXISTS "Owners manage their views" ON public.report_views;
DROP POLICY IF EXISTS "Managers and admins read all audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Users insert own audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Users read own audit logs" ON public.audit_logs;

-- 7) NEW WORKSPACE-SCOPED POLICIES

-- batches (owner column: created_by)
CREATE POLICY "ws read batches" ON public.batches
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "staff insert batches" ON public.batches
  FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager','employee']) AND created_by = auth.uid());
CREATE POLICY "own or mgmt update batches" ON public.batches
  FOR UPDATE TO authenticated
  USING ((created_by = auth.uid() AND public.is_workspace_member(workspace_id))
         OR public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']))
  WITH CHECK ((created_by = auth.uid() AND public.is_workspace_member(workspace_id))
              OR public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']));
CREATE POLICY "own or mgmt delete batches" ON public.batches
  FOR DELETE TO authenticated
  USING ((created_by = auth.uid() AND public.is_workspace_member(workspace_id))
         OR public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']));

-- extractions (owner column: created_by)
CREATE POLICY "ws read extractions" ON public.extractions
  FOR SELECT TO authenticated
  USING (
    public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager','employee'])
    OR (public.is_workspace_member(workspace_id) AND partner_id IS NOT NULL AND partner_id = public.current_partner_id())
  );
CREATE POLICY "staff insert extractions" ON public.extractions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager','employee']) AND created_by = auth.uid());
CREATE POLICY "own or mgmt update extractions" ON public.extractions
  FOR UPDATE TO authenticated
  USING ((created_by = auth.uid() AND public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager','employee']))
         OR public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']))
  WITH CHECK ((created_by = auth.uid() AND public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager','employee']))
              OR public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']));
CREATE POLICY "own or mgmt delete extractions" ON public.extractions
  FOR DELETE TO authenticated
  USING ((created_by = auth.uid() AND public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager','employee']))
         OR public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']));

-- partners
CREATE POLICY "mgmt or self read partners" ON public.partners
  FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager'])
         OR (user_id = auth.uid() AND public.is_workspace_member(workspace_id)));
CREATE POLICY "admin+ insert partners" ON public.partners
  FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']));
CREATE POLICY "admin+ update partners" ON public.partners
  FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']));
CREATE POLICY "admin+ delete partners" ON public.partners
  FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']));

-- commission_slabs
CREATE POLICY "mgmt read slabs" ON public.commission_slabs
  FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager'])
         OR (partner_id = public.current_partner_id() AND public.is_workspace_member(workspace_id)));
CREATE POLICY "admin+ write slabs" ON public.commission_slabs
  FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']));

-- partner_payouts
CREATE POLICY "mgmt or self read payouts" ON public.partner_payouts
  FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager'])
         OR (partner_id = public.current_partner_id() AND public.is_workspace_member(workspace_id)));
CREATE POLICY "mgmt insert payouts" ON public.partner_payouts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']));
CREATE POLICY "mgmt update payouts" ON public.partner_payouts
  FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']));
CREATE POLICY "admin+ delete payouts" ON public.partner_payouts
  FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']));

-- month_locks
CREATE POLICY "mgmt read month_locks" ON public.month_locks
  FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']));
CREATE POLICY "admin+ write month_locks" ON public.month_locks
  FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']));

-- stores/employees/branches
CREATE POLICY "members read stores" ON public.stores
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admin+ write stores" ON public.stores
  FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']));

CREATE POLICY "members read employees" ON public.employees
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admin+ write employees" ON public.employees
  FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']));

CREATE POLICY "members read branches" ON public.branches
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admin+ write branches" ON public.branches
  FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']));

-- generated_reports / scheduled_reports / report_views (owner column: user_id)
CREATE POLICY "self or mgmt read generated" ON public.generated_reports
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']));
CREATE POLICY "members write generated" ON public.generated_reports
  FOR ALL TO authenticated
  USING ((user_id = auth.uid() AND public.is_workspace_member(workspace_id))
         OR public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']))
  WITH CHECK ((user_id = auth.uid() AND public.is_workspace_member(workspace_id))
              OR public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']));

CREATE POLICY "self or mgmt read schedules" ON public.scheduled_reports
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']));
CREATE POLICY "self write schedules" ON public.scheduled_reports
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id))
  WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(workspace_id));

CREATE POLICY "self or mgmt read views" ON public.report_views
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']));
CREATE POLICY "self write views" ON public.report_views
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id))
  WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(workspace_id));

-- audit_logs
CREATE POLICY "self or mgmt read audit" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR (workspace_id IS NOT NULL AND public.has_workspace_role(workspace_id, ARRAY['owner','admin','manager']))
         OR public.is_super_admin());
CREATE POLICY "self insert audit" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 8) NEW HANDLE_NEW_USER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _invite RECORD;
  _ws_id uuid;
  _ws_name text;
  _ws_slug text;
BEGIN
  INSERT INTO public.profiles(id, email, full_name)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name',
             NEW.raw_user_meta_data->>'name',
             split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);

  SELECT * INTO _invite
  FROM public.workspace_invites
  WHERE lower(email) = lower(NEW.email)
    AND accepted_at IS NULL AND expires_at > now()
  ORDER BY created_at ASC LIMIT 1;

  IF _invite IS NOT NULL THEN
    INSERT INTO public.workspace_members(workspace_id, user_id, role, invited_by)
    VALUES (_invite.workspace_id, NEW.id, _invite.role, _invite.invited_by)
    ON CONFLICT DO NOTHING;
    UPDATE public.workspace_invites SET accepted_at = now() WHERE id = _invite.id;
    UPDATE public.profiles SET active_workspace_id = _invite.workspace_id WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  _ws_name := split_part(NEW.email, '@', 1) || '''s Workspace';
  _ws_slug := regexp_replace(lower(split_part(NEW.email, '@', 1)), '[^a-z0-9]+', '-', 'g')
              || '-' || substr(replace(NEW.id::text, '-', ''), 1, 6);

  INSERT INTO public.workspaces(name, slug, owner_id)
  VALUES (_ws_name, _ws_slug, NEW.id)
  RETURNING id INTO _ws_id;

  INSERT INTO public.workspace_members(workspace_id, user_id, role)
  VALUES (_ws_id, NEW.id, 'owner');

  UPDATE public.profiles SET active_workspace_id = _ws_id WHERE id = NEW.id;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 9) Automatch trigger scoped by workspace
CREATE OR REPLACE FUNCTION public.trg_extractions_automatch_partner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _match_id UUID; _month DATE;
BEGIN
  IF NEW.status <> 'success' OR NEW.is_duplicate = true OR NEW.partner_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT id INTO _match_id
  FROM public.partners
  WHERE active = true AND workspace_id = NEW.workspace_id
    AND (
      (NEW.employee_name IS NOT NULL AND lower(NEW.employee_name) = ANY(SELECT lower(k) FROM unnest(match_keys) AS k))
      OR (NEW.reference IS NOT NULL AND lower(NEW.reference) = ANY(SELECT lower(k) FROM unnest(match_keys) AS k))
      OR (NEW.branch_name IS NOT NULL AND lower(NEW.branch_name) = ANY(SELECT lower(k) FROM unnest(match_keys) AS k))
    )
  ORDER BY created_at ASC LIMIT 1;
  IF _match_id IS NOT NULL THEN
    _month := date_trunc('month', COALESCE(NEW.activation_date_parsed, CURRENT_DATE))::date;
    NEW.partner_id := _match_id;
    NEW.commission_month := _month;
  END IF;
  RETURN NEW;
END;
$fn$;

-- 10) Anomaly trigger scoped by workspace
CREATE OR REPLACE FUNCTION public.compute_extraction_anomalies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE a TEXT[] := '{}'; known BOOLEAN;
BEGIN
  IF NEW.status = 'success' AND NEW.is_duplicate = false THEN
    IF NEW.activation_date_parsed IS NOT NULL
       AND NEW.activation_date_parsed > (CURRENT_DATE + INTERVAL '1 day')::date THEN
      a := array_append(a, 'future_activation_date');
    END IF;
    IF NEW.store_id IS NOT NULL AND btrim(NEW.store_id) <> '' THEN
      SELECT EXISTS(SELECT 1 FROM public.stores
                    WHERE workspace_id = NEW.workspace_id AND upper(code) = upper(NEW.store_id)) INTO known;
      IF NOT known THEN a := array_append(a, 'unknown_store_id'); END IF;
    END IF;
    IF NEW.phone_number IS NULL OR btrim(NEW.phone_number) = '' THEN
      a := array_append(a, 'missing_phone');
    ELSIF length(regexp_replace(NEW.phone_number, '\D', '', 'g')) < 10 THEN
      a := array_append(a, 'malformed_phone');
    END IF;
    IF NEW.order_number IS NULL OR btrim(NEW.order_number) = '' THEN
      a := array_append(a, 'missing_order_number');
    END IF;
  END IF;
  NEW.anomalies := a;
  RETURN NEW;
END;
$fn$;

-- 11) Grant super_admin to masood@hitrotech.com
INSERT INTO public.user_roles(user_id, role)
SELECT id, 'super_admin'::public.app_role
FROM auth.users
WHERE lower(email) = 'masood@hitrotech.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- 12) updated_at trigger for workspaces
DROP TRIGGER IF EXISTS trg_workspaces_updated ON public.workspaces;
CREATE TRIGGER trg_workspaces_updated
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();