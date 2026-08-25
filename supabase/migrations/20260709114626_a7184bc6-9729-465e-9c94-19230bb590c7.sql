-- Restrict SECURITY DEFINER function execution to only the callers that need it.
-- Trigger functions never need direct EXECUTE from anon/authenticated.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_extraction_edit() FROM PUBLIC, anon, authenticated;

-- Role-check helpers are used inside RLS policies for signed-in users.
-- Remove blanket PUBLIC/anon access; keep EXECUTE for authenticated so RLS still works.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_manager_or_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager_or_admin(uuid) TO authenticated;