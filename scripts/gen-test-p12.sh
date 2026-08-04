#!/usr/bin/env bash
set -euo pipefail

# Genera los fixtures .p12 de prueba para packages/sri-ec/test/certificate.test.ts:
#
#   - test-cert.p12        p12 "moderno" (cifrado por defecto de OpenSSL 3.x:
#                           AES-256-CBC + PBKDF2).
#   - test-cert-legacy.p12 p12 "legacy" (RC2-40/3DES, formato pre-OpenSSL-3,
#                           generado con `openssl pkcs12 -export -legacy`).
#
# Ambos contienen el MISMO certificado autofirmado RSA 2048 sin valor real
# (solo para pruebas — no es un certificado de firma electrónica válido).
# Password de ambos: "test1234".
#
# Requiere un binario openssl >= 3.0 (soporte del flag `-legacy`, necesario
# para el proveedor legacy de algoritmos RC2/3DES). Re-ejecutable: sobrescribe
# los fixtures existentes.

PASSWORD="test1234"

# Resuelve un openssl >= 3.0 (el `openssl` del PATH puede ser 1.1, que no
# entiende `-legacy` porque en 1.1 esos algoritmos ya vienen incluidos).
resolve_openssl() {
  local candidates=(
    "/opt/homebrew/opt/openssl@3/bin/openssl"
    "/usr/local/opt/openssl@3/bin/openssl"
    "openssl"
  )
  for candidate in "${candidates[@]}"; do
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" pkcs12 -help 2>&1 | grep -q -- '-legacy'; then
        echo "$candidate"
        return 0
      fi
    fi
  done
  return 1
}

OPENSSL_BIN="$(resolve_openssl)" || {
  echo "ERROR: no se encontró un binario openssl >= 3.0 con soporte de -legacy." >&2
  echo "Instale OpenSSL 3.x (p.ej. 'brew install openssl@3') y reintente." >&2
  exit 1
}
echo "Usando openssl: $OPENSSL_BIN ($("$OPENSSL_BIN" version))"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES_DIR="$ROOT_DIR/packages/sri-ec/test/fixtures"
mkdir -p "$FIXTURES_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Certificado autofirmado RSA 2048, sin valor real, solo para pruebas.
"$OPENSSL_BIN" req -x509 -newkey rsa:2048 -nodes -sha256 \
  -keyout "$TMP_DIR/key.pem" -out "$TMP_DIR/cert.pem" -days 3650 \
  -subj "/C=EC/O=Amephia Test/CN=sri-ec-test" \
  -addext "keyUsage=critical,digitalSignature,nonRepudiation" \
  -addext "basicConstraints=critical,CA:FALSE"

# p12 moderno: cifrado por defecto de OpenSSL 3.x (AES-256-CBC + PBKDF2).
"$OPENSSL_BIN" pkcs12 -export \
  -in "$TMP_DIR/cert.pem" -inkey "$TMP_DIR/key.pem" \
  -out "$FIXTURES_DIR/test-cert.p12" \
  -passout "pass:$PASSWORD" \
  -name "sri-ec-test"

# p12 legacy: fuerza RC2-40/3DES vía el proveedor legacy (equivalente al
# comportamiento por defecto de OpenSSL 1.0.x, que node-forge también sabe
# descifrar de forma nativa).
"$OPENSSL_BIN" pkcs12 -export -legacy \
  -in "$TMP_DIR/cert.pem" -inkey "$TMP_DIR/key.pem" \
  -out "$FIXTURES_DIR/test-cert-legacy.p12" \
  -passout "pass:$PASSWORD" \
  -name "sri-ec-test"

echo "Generados:"
echo "  $FIXTURES_DIR/test-cert.p12"
echo "  $FIXTURES_DIR/test-cert-legacy.p12"
