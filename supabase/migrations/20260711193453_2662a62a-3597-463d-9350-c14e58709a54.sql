
REVOKE EXECUTE ON FUNCTION public.recompute_partner_commission(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_extractions_recompute_commission() FROM PUBLIC, anon, authenticated;
