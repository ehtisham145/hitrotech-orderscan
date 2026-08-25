#!/usr/bin/env bash
# Issues (first run) or renews (subsequent runs) a Let's Encrypt cert for
# DOMAIN via the "proxy" compose profile, then reloads nginx.
#
# No-op if DOMAIN isn't set yet.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
load_env

if [ -z "${DOMAIN:-}" ]; then
  log_info "DOMAIN is not set in .env — nothing to do yet."
  log_info "Once DNS for your domain points at this VPS, set DOMAIN and SSL_EMAIL in .env,"
  log_info "run 'bash ops/deploy.sh --with-proxy', then re-run this script to issue the cert."
  exit 0
fi
if [ -z "${SSL_EMAIL:-}" ]; then
  log_err "DOMAIN is set but SSL_EMAIL is empty in .env — required by Let's Encrypt."
  exit 1
fi

cert_path="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
if compose --profile proxy run --rm certbot test -f "$cert_path" >/dev/null 2>&1; then
  log_info "Existing certificate found for $DOMAIN — renewing if due..."
  compose --profile proxy run --rm certbot renew --webroot -w /var/www/certbot
else
  log_info "No certificate yet for $DOMAIN — issuing a new one..."
  compose --profile proxy run --rm certbot certonly \
    --webroot -w /var/www/certbot \
    -d "$DOMAIN" \
    --email "$SSL_EMAIL" --agree-tos --non-interactive
  log_warn "Cert issued. Now uncomment/add the HTTPS server block in ops/nginx.conf"
  log_warn "(same template as ocr-service/ops/nginx.conf) and redeploy with --with-proxy."
fi

if compose --profile proxy ps nginx 2>/dev/null | grep -q Up; then
  log_info "Reloading nginx..."
  compose --profile proxy exec nginx nginx -s reload
  log_ok "nginx reloaded"
else
  log_warn "nginx isn't running — start it with: bash ops/deploy.sh --with-proxy"
fi
