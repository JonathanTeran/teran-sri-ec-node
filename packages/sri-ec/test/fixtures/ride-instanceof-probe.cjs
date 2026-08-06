'use strict';

/**
 * Probe CommonJS para el regression test de `test/ride-dist-instanceof.test.ts`.
 * Se ejecuta como un proceso `node` totalmente aparte (no bajo vitest): así
 * la resolución de `require('sri-ec')` que hace `dist/ride/index.cjs`
 * internamente pasa por la resolución NATIVA de Node (node_modules +
 * `package.json` → `exports`), sin ningún alias de test de por medio — es
 * justo lo que vería un consumidor real en CommonJS.
 *
 * Uso: `node ride-instanceof-probe.cjs <dist/index.cjs> <dist/ride/index.cjs>`
 * Imprime `PASS`, `FAIL` o `NO_ERROR_THROWN` en stdout.
 */
const [, , coreDistPath, rideDistPath] = process.argv;

const core = require(coreDistPath);
const ride = require(rideDistPath);

// Documento mínimo para forzar `RIDE_INVALID_LOGO`: no hace falta un `Factura`
// completo (no hay detalles, ni totales, ni comprador), pero sí los campos que
// la CABECERA del Anexo 2 imprime cada uno en su propia columna — razón social
// y dirección matriz (caja del emisor) más RUC, serie, secuencial, ambiente y
// tipo de emisión (caja del comprobante). La cabecera se MIDE entera antes de
// dibujar nada, así que sin ellos el render revienta con un `TypeError` de
// pdfkit antes de llegar al logo y este probe reportaría `FAIL` por un motivo
// que nada tiene que ver con el `instanceof` que verifica.
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

async function main() {
  try {
    await ride.generarRideFactura({
      documento: documentoMinimo,
      claveAcceso: '1234567890123456789012345678901234567890123456789',
      // Bytes inválidos (no PNG/JPEG): fuerza `SriError('RIDE_INVALID_LOGO')`
      // desde dentro de `dist/ride/index.cjs` (ver `src/ride/blocks.ts`).
      logo: Buffer.from([1, 2, 3, 4, 5, 6]),
    });
    console.log('NO_ERROR_THROWN');
  } catch (err) {
    console.log(err instanceof core.SriError ? 'PASS' : 'FAIL');
  }
}

main();
