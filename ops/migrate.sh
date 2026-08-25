#!/usr/bin/env bash
# Applies pending supabase/migrations/*.sql to the external Supabase project
# (the one extractions/batches/orders live in — EXT_SUPABASE_URL).
#
# Requires the Supabase CLI and a SUPABASE_ACCESS_TOKEN (personal access
# token from https://supabase.com/dashboard/account/tokens — NOT the same
# as EXT_SUPABASE_SERVICE_ROLE_KEY). Falls back to printing manual
# instructions if either is missing, rather than failing a chained deploy.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
load_env

project_ref="$(echo "${EXT_SUPABASE_URL:-}" | sed -E 's#https?://([a-z0-9]+)\.supabase\.co.*#\1#')"

if [ -z "$project_ref" ] || [ "$project_ref" = "${EXT_SUPABASE_URL:-}" ]; then
  log_err "Could not extract a project ref from EXT_SUPABASE_URL='${EXT_SUPABASE_URL:-}'."
  exit 1
fi

if ! command -v supabase >/dev/null 2>&1; then
  log_warn "Supabase CLI not installed — can't apply migrations automatically."
  log_info "Install: https://supabase.com/docs/guides/cli/getting-started"
  log_info "Or apply supabase/migrations/*.sql manually via the SQL Editor for project $project_ref."
  exit 0
fi

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  log_warn "SUPABASE_ACCESS_TOKEN is not set — can't link non-interactively."
  log_info "Get one at https://supabase.com/dashboard/account/tokens, export it, and re-run,"
  log_info "or apply supabase/migrations/*.sql manually via the SQL Editor for project $project_ref."
  exit 0
fi

log_info "Linking to Supabase project $project_ref..."
(cd "$ROOT_DIR" && supabase link --project-ref "$project_ref")

log_info "Pushing pending migrations..."
(cd "$ROOT_DIR" && supabase db push)

log_ok "Migrations applied."
