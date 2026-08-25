
ALTER TABLE public.extractions
  ADD COLUMN IF NOT EXISTS sim_type text,
  ADD COLUMN IF NOT EXISTS number_type text,
  ADD COLUMN IF NOT EXISTS package_name text;

CREATE OR REPLACE FUNCTION public.log_extraction_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed jsonb := '{}'::jsonb;
  f text;
  old_val text;
  new_val text;
  fields text[] := ARRAY['customer_name','phone_number','current_network','number_charges','paid_via','discount','email','store_id','reference','deposit','remaining_deposit','order_number','cnic','plan_price','activation_date','activation_time','employee_name','branch_name','order_status','remarks','sim_type','number_type','package_name'];
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
END; $function$;
