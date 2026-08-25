#!/usr/bin/env bash
# orderscan-ocr has no database and no persistent state — there is nothing to
# migrate today. This script exists so the ops/ toolkit has a consistent
# interface (deploy.sh could call it) and so it's obvious where to add real
# migration steps if this service ever grows a database or cache to manage.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

log_info "orderscan-ocr is stateless (no database) — nothing to migrate."
exit 0
