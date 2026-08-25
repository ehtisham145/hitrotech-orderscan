#!/usr/bin/env bash
# Validates .env before a deploy. Exits non-zero on anything that would break
# the service; prints warnings (exit 0) for things that are merely risky.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_env_file

fail=0

# --- required secrets present & non-placeholder ---------------------------
val="$(grep -E '^OCR_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [ -z "$val" ]; then
  log_err "OCR_API_KEY is empty in .env — generate one with: openssl rand -hex 32"
  fail=1
elif [ "${#val}" -lt 20 ]; then
  log_warn "OCR_API_KEY looks short (${#val} chars) — generate a stronger one with: openssl rand -hex 32"
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
  log_err ".env is tracked by git! Run: git rm --cached ocr-service/.env"
  fail=1
fi
if [ -f "$ROOT_DIR/.gitignore" ] && ! grep -qE '^\.env$|^\.env\*' "$ROOT_DIR/.gitignore"; then
  log_warn "ocr-service/.gitignore doesn't exclude .env — add a .env line to it."
fi

# --- DOMAIN/SSL_EMAIL consistency (only relevant once the proxy is used) --
domain="$(grep -E '^DOMAIN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
email="$(grep -E '^SSL_EMAIL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [ -n "$domain" ] && [ -z "$email" ]; then
  log_warn "DOMAIN is set but SSL_EMAIL is empty — ops/ssl-renew.sh needs both."
fi

if [ "$fail" -eq 0 ]; then
  log_ok "secrets-check passed"
else
  log_err "secrets-check failed — fix the above before deploying"
fi
exit "$fail"
