#!/usr/bin/env bash
set -euo pipefail

# Verifica en runtime la propiedad de aislamiento del fix "optionalDependencies
# instala pdfkit/qrcode para todos" (ver README.md → RIDE, packages/sri-ec/
# package.json): un `npm install sri-ec` SIN flags no debe instalar
# pdfkit/qrcode/fontkit — son `peerDependencies` opcionales
# (`peerDependenciesMeta.optional`), no `optionalDependencies` (que npm sí
# instala por defecto, solo tolerando el fallo si faltan). Ese campo se quitó
# deliberadamente; este script existe para que si algún día alguien lo vuelve
# a agregar (o agrega cualquier otra dependencia real por accidente al core),
# la regresión se note en CI en vez de descubrirse en el próximo `npm install
# sri-ec` de un usuario.
#
# Empaqueta el tarball REAL de packages/sri-ec (requiere `npm run build`
# antes: se empaqueta lo que haya en dist/), lo instala en un proyecto
# descartable con un `npm install` liso y llano, y comprueba:
#
#   1. pdfkit/qrcode/fontkit/linebreak/png-js NO están en node_modules tras
#      el install (fontkit/linebreak/png-js son dependencias transitivas de
#      pdfkit — si pdfkit se instaló, ellas también).
#   2. `require('sri-ec')`/`import('sri-ec')` funcionan (el core es
#      usable sin esas dependencias).
#   3. `sri-ec/ride` también resuelve (import/require, ambos formatos) y
#      `generarRideFactura(...)` rechaza con el `SriError` documentado
#      (`code: 'RIDE_MISSING_DEPENDENCY'`), no con un `MODULE_NOT_FOUND`
#      crudo — y ese `SriError` es `instanceof` el `SriError` que exporta
#      `require('sri-ec')`/`import('sri-ec')` (regresión del fix de
#      `instanceof` entre CJS y ESM).
#
# Uso: scripts/verify-optional-isolation.sh

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRI_EC_DIR="$REPO_ROOT/packages/sri-ec"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> Empaquetando sri-ec (npm pack) desde $SRI_EC_DIR"
TARBALL_NAME="$(cd "$SRI_EC_DIR" && npm pack --pack-destination "$WORKDIR" --silent)"
TARBALL_PATH="$WORKDIR/$TARBALL_NAME"
echo "    tarball: $TARBALL_PATH"

PROJECT_DIR="$WORKDIR/consumer"
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"
cat > package.json <<'EOF'
{ "name": "consumer-scratch", "private": true, "version": "0.0.0", "type": "module" }
EOF

echo "==> npm install \"$TARBALL_PATH\" (sin flags — el default de un consumidor real)"
npm install "$TARBALL_PATH" --no-audit --no-fund >/dev/null

echo "==> Verificando que pdfkit/qrcode/fontkit/linebreak/png-js NO se instalaron"
fallo=0
for paquete in pdfkit qrcode fontkit linebreak png-js; do
  if [ -d "node_modules/$paquete" ]; then
    echo "    FALLO: node_modules/$paquete existe (no debería) — optionalDependencies puede haber vuelto a packages/sri-ec/package.json"
    fallo=1
  fi
done
if [ "$fallo" -ne 0 ]; then
  echo "    node_modules instalados: $(ls node_modules | tr '\n' ' ')"
  exit 1
fi
echo "    OK: ninguna de pdfkit/qrcode/fontkit/linebreak/png-js está instalada"

cat > probe.mjs <<'EOF'
// Probe ESM: import('sri-ec') + import('sri-ec/ride') sin pdfkit/qrcode instalados.
import * as core from 'sri-ec';

if (typeof core.SriError !== 'function') {
  throw new Error('import("sri-ec") no expone SriError — ¿regresó el core a importar algo de ride?');
}

const { generarRideFactura } = await import('sri-ec/ride');
const documentoMinimo = {
  tipo: '01',
  infoTributaria: { razonSocial: 'ACME S.A.', dirMatriz: 'Av. Siempre Viva 123' },
};

try {
  await generarRideFactura({ documento: documentoMinimo, claveAcceso: '1'.repeat(49) });
  throw new Error('generarRideFactura() no lanzó — se esperaba RIDE_MISSING_DEPENDENCY (pdfkit no está instalado)');
} catch (err) {
  if (err.code !== 'RIDE_MISSING_DEPENDENCY') throw err;
  if (!(err instanceof core.SriError)) {
    throw new Error('el error de sri-ec/ride NO es instanceof el SriError de sri-ec (ESM)');
  }
}

console.log('PROBE_ESM_OK');
EOF

cat > probe.cjs <<'EOF'
// Probe CJS: require('sri-ec') + require('sri-ec/ride') sin pdfkit/qrcode instalados.
const core = require('sri-ec');

if (typeof core.SriError !== 'function') {
  throw new Error('require("sri-ec") no expone SriError — ¿regresó el core a importar algo de ride?');
}

const ride = require('sri-ec/ride');
const documentoMinimo = {
  tipo: '01',
  infoTributaria: { razonSocial: 'ACME S.A.', dirMatriz: 'Av. Siempre Viva 123' },
};

ride
  .generarRideFactura({ documento: documentoMinimo, claveAcceso: '1'.repeat(49) })
  .then(() => {
    throw new Error('generarRideFactura() no lanzó — se esperaba RIDE_MISSING_DEPENDENCY (pdfkit no está instalado)');
  })
  .catch((err) => {
    if (err.code !== 'RIDE_MISSING_DEPENDENCY') throw err;
    if (!(err instanceof core.SriError)) {
      throw new Error('el error de sri-ec/ride NO es instanceof el SriError de sri-ec (CJS)');
    }
    console.log('PROBE_CJS_OK');
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
EOF

echo "==> Ejecutando probe ESM"
node probe.mjs

echo "==> Ejecutando probe CJS"
node probe.cjs

echo "==> OK: sri-ec se instala e importa (CJS y ESM) sin pdfkit/qrcode, y sri-ec/ride reporta RIDE_MISSING_DEPENDENCY con instanceof correcto"
