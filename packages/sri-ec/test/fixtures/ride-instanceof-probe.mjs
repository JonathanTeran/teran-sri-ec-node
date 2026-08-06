/**
 * Probe ESM para el regression test de `test/ride-dist-instanceof.test.ts`.
 * Contraparte de `ride-instanceof-probe.cjs` — mismo propósito, pero para
 * `dist/index.js`/`dist/ride/index.js`. Ver la nota completa en el `.cjs`.
 *
 * Uso: `node ride-instanceof-probe.mjs <dist/index.js> <dist/ride/index.js>`
 * Imprime `PASS`, `FAIL` o `NO_ERROR_THROWN` en stdout.
 */
import { pathToFileURL } from 'node:url';

const [, , coreDistPath, rideDistPath] = process.argv;

const core = await import(pathToFileURL(coreDistPath).href);
const ride = await import(pathToFileURL(rideDistPath).href);

// Ver la nota del `.cjs`: además de razón social y dirección matriz, la
// cabecera del Anexo 2 imprime RUC, serie, secuencial, ambiente y tipo de
// emisión en columnas propias, y se mide entera antes de dibujar el logo.
const documentoMinimo = {
  tipo: '01',
  infoTributaria: {
    ambiente: '1',
    tipoEmision: '1',
    razonSocial: 'ACME S.A.',
    ruc: '1790011001001',
    estab: '001',
    ptoEmi: '001',
    secuencial: '000000001',
    dirMatriz: 'Av. Siempre Viva 123',
  },
};

try {
  await ride.generarRideFactura({
    documento: documentoMinimo,
    claveAcceso: '1234567890123456789012345678901234567890123456789',
    logo: new Uint8Array([1, 2, 3, 4, 5, 6]),
  });
  console.log('NO_ERROR_THROWN');
} catch (err) {
  console.log(err instanceof core.SriError ? 'PASS' : 'FAIL');
}
