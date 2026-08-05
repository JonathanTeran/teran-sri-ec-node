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

const documentoMinimo = {
  tipo: '01',
  infoTributaria: {
    razonSocial: 'ACME S.A.',
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
