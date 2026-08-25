REVOKE EXECUTE ON FUNCTION public.approve_billing_request(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_billing_request(uuid, text) FROM PUBLIC, anon;