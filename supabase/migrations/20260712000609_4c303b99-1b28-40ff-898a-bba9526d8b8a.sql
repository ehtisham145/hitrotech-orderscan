
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  actor_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);
CREATE INDEX notifications_user_unread_idx
  ON public.notifications (user_id) WHERE read_at IS NULL;

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger: fan out audit_logs to per-user notifications for a whitelisted set of actions.
CREATE OR REPLACE FUNCTION public.fanout_audit_to_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ws_name TEXT;
  _actor_name TEXT;
  _target_uid UUID;
  _title TEXT;
  _body TEXT;
BEGIN
  IF NEW.workspace_id IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO _ws_name FROM public.workspaces WHERE id = NEW.workspace_id;
  IF NEW.user_id IS NOT NULL THEN
    SELECT COALESCE(full_name, email, 'A teammate') INTO _actor_name
      FROM public.profiles WHERE id = NEW.user_id;
  END IF;
  _actor_name := COALESCE(_actor_name, 'A teammate');
  _ws_name := COALESCE(_ws_name, 'the workspace');

  IF NEW.action = 'workspace.invite_accepted' THEN
    _title := format('%s joined %s', COALESCE(NEW.details->>'email', 'A new member'), _ws_name);
    _body := format('Role: %s', COALESCE(NEW.details->>'role', 'member'));
    INSERT INTO public.notifications (workspace_id, user_id, actor_id, action, entity_type, entity_id, title, body, data)
    SELECT NEW.workspace_id, wm.user_id, NEW.user_id, NEW.action, NEW.entity_type, NEW.entity_id, _title, _body, NEW.details
    FROM public.workspace_members wm
    WHERE wm.workspace_id = NEW.workspace_id
      AND wm.role IN ('owner','admin')
      AND wm.user_id <> COALESCE(NEW.user_id, '00000000-0000-0000-0000-000000000000'::uuid);

  ELSIF NEW.action = 'workspace.member_role_updated' THEN
    _target_uid := NULLIF(NEW.details->>'target_user_id','')::uuid;
    IF _target_uid IS NOT NULL THEN
      _title := format('Your role in %s changed', _ws_name);
      _body := format('%s changed your role to %s', _actor_name, COALESCE(NEW.details->>'to','a new role'));
      INSERT INTO public.notifications (workspace_id, user_id, actor_id, action, entity_type, entity_id, title, body, data)
      VALUES (NEW.workspace_id, _target_uid, NEW.user_id, NEW.action, NEW.entity_type, NEW.entity_id, _title, _body, NEW.details);
    END IF;

  ELSIF NEW.action = 'workspace.member_removed' THEN
    _target_uid := NULLIF(NEW.details->>'target_user_id','')::uuid;
    IF _target_uid IS NOT NULL THEN
      _title := format('You were removed from %s', _ws_name);
      _body := format('Removed by %s', _actor_name);
      INSERT INTO public.notifications (workspace_id, user_id, actor_id, action, entity_type, entity_id, title, body, data)
      VALUES (NEW.workspace_id, _target_uid, NEW.user_id, NEW.action, NEW.entity_type, NEW.entity_id, _title, _body, NEW.details);
    END IF;

  ELSIF NEW.action = 'workspace.member_left' THEN
    _title := format('%s left %s', _actor_name, _ws_name);
    _body := COALESCE(NEW.details->>'role', NULL);
    INSERT INTO public.notifications (workspace_id, user_id, actor_id, action, entity_type, entity_id, title, body, data)
    SELECT NEW.workspace_id, wm.user_id, NEW.user_id, NEW.action, NEW.entity_type, NEW.entity_id, _title, _body, NEW.details
    FROM public.workspace_members wm
    WHERE wm.workspace_id = NEW.workspace_id
      AND wm.role IN ('owner','admin')
      AND wm.user_id <> COALESCE(NEW.user_id, '00000000-0000-0000-0000-000000000000'::uuid);

  ELSIF NEW.action = 'workspace.ownership_transferred' THEN
    _title := format('Ownership of %s transferred', _ws_name);
    -- Notify new owner
    IF NULLIF(NEW.details->>'to_user_id','') IS NOT NULL THEN
      INSERT INTO public.notifications (workspace_id, user_id, actor_id, action, entity_type, entity_id, title, body, data)
      VALUES (NEW.workspace_id, (NEW.details->>'to_user_id')::uuid, NEW.user_id, NEW.action, NEW.entity_type, NEW.entity_id,
        format('You are now the owner of %s', _ws_name),
        format('Ownership transferred by %s', _actor_name),
        NEW.details);
    END IF;
    -- Notify previous owner (if different from actor)
    IF NULLIF(NEW.details->>'from_user_id','') IS NOT NULL
       AND (NEW.details->>'from_user_id')::uuid <> COALESCE(NEW.user_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO public.notifications (workspace_id, user_id, actor_id, action, entity_type, entity_id, title, body, data)
      VALUES (NEW.workspace_id, (NEW.details->>'from_user_id')::uuid, NEW.user_id, NEW.action, NEW.entity_type, NEW.entity_id,
        _title,
        format('%s is now the owner', _ws_name),
        NEW.details);
    END IF;

  ELSIF NEW.action = 'workspace.plan_updated' THEN
    _title := format('Plan updated for %s', _ws_name);
    _body := format('Now on %s (%s seats)',
      COALESCE(NEW.details->>'plan_tier','free'),
      COALESCE(NEW.details->>'seat_limit','0'));
    INSERT INTO public.notifications (workspace_id, user_id, actor_id, action, entity_type, entity_id, title, body, data)
    SELECT NEW.workspace_id, wm.user_id, NEW.user_id, NEW.action, NEW.entity_type, NEW.entity_id, _title, _body, NEW.details
    FROM public.workspace_members wm
    WHERE wm.workspace_id = NEW.workspace_id
      AND wm.role IN ('owner','admin');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_logs_fanout_notifications
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.fanout_audit_to_notifications();
