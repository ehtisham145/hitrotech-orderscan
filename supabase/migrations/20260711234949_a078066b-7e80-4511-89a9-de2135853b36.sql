CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    INSERT INTO public.audit_logs (user_id, workspace_id, action, entity_type, entity_id, details)
    VALUES (
      NEW.id,
      _invite.workspace_id,
      'workspace.invite_accepted',
      'workspace_invite',
      _invite.id,
      jsonb_build_object('email', NEW.email, 'role', _invite.role, 'invited_by', _invite.invited_by)
    );

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

  INSERT INTO public.audit_logs (user_id, workspace_id, action, entity_type, entity_id, details)
  VALUES (
    NEW.id,
    _ws_id,
    'workspace.create',
    'workspace',
    _ws_id,
    jsonb_build_object('name', _ws_name, 'slug', _ws_slug, 'source', 'signup')
  );

  RETURN NEW;
END;
$function$;