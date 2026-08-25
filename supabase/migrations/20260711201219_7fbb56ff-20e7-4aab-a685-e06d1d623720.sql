
-- 1) Extend app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'partner';

-- 2) Link partners <-> auth users
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS partners_user_id_unique ON public.partners(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS partners_invited_email_idx ON public.partners(lower(invited_email));

-- 3) Helper: current partner id (security definer to bypass RLS)
CREATE OR REPLACE FUNCTION public.current_partner_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.partners WHERE user_id = auth.uid() LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_partner_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_partner_id() TO authenticated;

-- 4) RLS: partners can read their own row
DROP POLICY IF EXISTS "Partners can view own record" ON public.partners;
CREATE POLICY "Partners can view own record" ON public.partners
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 5) RLS: partners can view their own payouts
DROP POLICY IF EXISTS "Partners can view own payouts" ON public.partner_payouts;
CREATE POLICY "Partners can view own payouts" ON public.partner_payouts
  FOR SELECT TO authenticated
  USING (partner_id = public.current_partner_id());

-- 6) RLS: partners can view their own extractions
DROP POLICY IF EXISTS "Partners can view own extractions" ON public.extractions;
CREATE POLICY "Partners can view own extractions" ON public.extractions
  FOR SELECT TO authenticated
  USING (partner_id IS NOT NULL AND partner_id = public.current_partner_id());

-- 7) RLS: partners can view active commission slabs (for their role)
DROP POLICY IF EXISTS "Partners can view commission slabs" ON public.commission_slabs;
CREATE POLICY "Partners can view commission slabs" ON public.commission_slabs
  FOR SELECT TO authenticated
  USING (
    active = true AND role IN (SELECT role FROM public.partners WHERE user_id = auth.uid())
  );

-- 8) Auto-link on signup: if the new user's email matches an invited partner,
--    assign 'partner' role and link, INSTEAD of the default 'employee' role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _partner_id UUID;
BEGIN
  INSERT INTO public.profiles(id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);

  -- Try to link to a partner invitation by email
  SELECT id INTO _partner_id
  FROM public.partners
  WHERE user_id IS NULL
    AND invited_email IS NOT NULL
    AND lower(invited_email) = lower(NEW.email)
  ORDER BY created_at ASC
  LIMIT 1;

  IF _partner_id IS NOT NULL THEN
    UPDATE public.partners SET user_id = NEW.id WHERE id = _partner_id;
    INSERT INTO public.user_roles(user_id, role)
    VALUES (NEW.id, 'partner')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    INSERT INTO public.user_roles(user_id, role)
    VALUES (NEW.id, 'employee')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
