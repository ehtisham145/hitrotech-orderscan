#!/usr/bin/env bash
# Validates .env before a deploy. Exits non-zero on anything that would break
# the app; prints warnings (exit 0) for things that are merely risky.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_env_file

fail=0

required=(
  EXT_SUPABASE_URL
  EXT_SUPABASE_PUBLISHABLE_KEY
  EXT_SUPABASE_SERVICE_ROLE_KEY
  OCR_URL
  OCR_API_KEY
)
for v in "${required[@]}"; do
  val="$(grep -E "^${v}=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d "\"'")"
  if [ -z "$val" ]; then
    log_err "$v is empty in .env — the extraction pipeline will not work without it."
    fail=1
  fi
done

if ! grep -qE '^GEMINI_API_KEY=.+' "$ENV_FILE" && ! grep -qE '^LOVABLE_API_KEY=.+' "$ENV_FILE"; then
  log_err "Both GEMINI_API_KEY and LOVABLE_API_KEY are empty — AI extraction needs at least one."
  fail=1
fi

# --- file permissions ------------------------------------------------------
if command -v stat >/dev/null 2>&1; then
  perms="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null || echo '')"
  if [ -n "$perms" ] && [ "$perms" != "600" ] && [ "$perms" != "400" ]; then
    log_warn ".env permissions are $perms — recommend: chmod 600 $ENV_FILE"
  fi
fi

# --- never let .env be committed -------------------------------------------
if git -C "$ROOT_DIR" ls-files --error-unmatch .env >/dev/null 2>&1; then
  log_err ".env is tracked by git! Run: git rm --cached .env"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  log_ok "secrets-check passed"
else
  log_err "secrets-check failed — fix the above before deploying"
fi
exit "$fail"
