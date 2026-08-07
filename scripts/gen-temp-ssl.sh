#!/usr/bin/env bash
# Generates a self-signed TLS cert+key for temporary HTTPS access over the
# LAN, before a real domain (and Let's Encrypt) is available. Regenerate
# whenever the LAN IP changes or the cert expires (365 days).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$REPO_ROOT/certs"
LAN_IP="${LAN_IP:-192.168.21.193}"

mkdir -p "$CERT_DIR"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERT_DIR/localhost.key" \
  -out "$CERT_DIR/localhost.crt" \
  -days 365 \
  -subj "/CN=rada-mvp temporary/O=Rada MVP (Agatka)" \
  -addext "subjectAltName = DNS:localhost,IP:127.0.0.1,IP:${LAN_IP}"

chmod 600 "$CERT_DIR/localhost.key"

echo "Wygenerowano: $CERT_DIR/localhost.crt / localhost.key (ważny 365 dni, SAN: localhost, 127.0.0.1, ${LAN_IP})"
