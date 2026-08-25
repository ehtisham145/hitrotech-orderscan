CREATE TABLE public.user_recovery_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_recovery_codes_user ON public.user_recovery_codes(user_id);
CREATE UNIQUE INDEX idx_user_recovery_codes_hash ON public.user_recovery_codes(code_hash);

GRANT SELECT ON public.user_recovery_codes TO authenticated;
GRANT ALL ON public.user_recovery_codes TO service_role;

ALTER TABLE public.user_recovery_codes ENABLE ROW LEVEL SECURITY;

-- Users can see their own codes (hashed only — used to display "N remaining")
CREATE POLICY "Users can view own recovery codes"
  ON public.user_recovery_codes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
