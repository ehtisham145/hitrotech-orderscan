
-- Lock down SECURITY DEFINER helper functions: revoke EXECUTE from PUBLIC/anon,
-- grant only to the roles that need to call them via RLS policies or server code.

REVOKE EXECUTE ON FUNCTION public.has_workspace_role(uuid, text[], uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_workspace_role(uuid, text[], uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.workspace_seat_usage(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.workspace_seat_usage(uuid) TO authenticated, service_role;

-- Trigger-only helper; not intended to be called directly by any client role.
REVOKE EXECUTE ON FUNCTION public.trg_partner_slab_recompute() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.trg_partner_slab_recompute() TO service_role;
