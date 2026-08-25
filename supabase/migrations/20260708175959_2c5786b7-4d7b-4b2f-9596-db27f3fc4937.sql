
-- Audit logs table
CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own audit logs"
ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users read own audit logs"
ON public.audit_logs FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Managers and admins read all audit logs"
ON public.audit_logs FOR SELECT TO authenticated
USING (public.is_manager_or_admin(auth.uid()));

CREATE INDEX audit_logs_user_created_idx ON public.audit_logs (user_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON public.audit_logs (entity_type, entity_id);

-- Allow admins to view all profiles (for user management)
CREATE POLICY "Admins read all profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to insert/update/delete user roles
CREATE POLICY "Admins insert roles"
ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update roles"
ON public.user_roles FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete roles"
ON public.user_roles FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Trigger: auto-log when an extraction is edited (fields updated by user review)
CREATE OR REPLACE FUNCTION public.log_extraction_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed jsonb := '{}'::jsonb;
  f text;
  old_val text;
  new_val text;
  fields text[] := ARRAY['customer_name','phone_number','current_network','number_charges','paid_via','discount','email','store_id','reference','deposit','remaining_deposit','order_number','cnic','plan_price','activation_date','activation_time','employee_name','branch_name','order_status','remarks'];
BEGIN
  FOREACH f IN ARRAY fields LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', f, f) INTO old_val, new_val USING OLD, NEW;
    IF old_val IS DISTINCT FROM new_val THEN
      changed := changed || jsonb_build_object(f, jsonb_build_object('from', old_val, 'to', new_val));
    END IF;
  END LOOP;

  IF changed <> '{}'::jsonb THEN
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (auth.uid(), 'extraction.edit', 'extraction', NEW.id,
      jsonb_build_object('batch_id', NEW.batch_id, 'changes', changed));
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER extraction_edit_audit
AFTER UPDATE ON public.extractions
FOR EACH ROW EXECUTE FUNCTION public.log_extraction_edit();
