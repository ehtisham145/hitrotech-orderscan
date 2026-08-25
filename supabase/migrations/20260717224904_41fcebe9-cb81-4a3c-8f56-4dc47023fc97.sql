
-- Super admin bypass should only apply to the workspace they have actively switched into.
-- Otherwise queries that don't explicitly filter by workspace_id return rows from every workspace.

CREATE OR REPLACE FUNCTION public.is_super_admin_for(_ws uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(_user_id)
     AND EXISTS (
       SELECT 1 FROM public.profiles
       WHERE id = _user_id AND active_workspace_id = _ws
     )
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_ws uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = _ws AND user_id = _user_id)
      OR public.is_super_admin_for(_ws, _user_id)
$$;

CREATE OR REPLACE FUNCTION public.has_workspace_role(_ws uuid, _roles text[], _user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _ws AND user_id = _user_id AND role::text = ANY(_roles)
  ) OR public.is_super_admin_for(_ws, _user_id)
$$;
