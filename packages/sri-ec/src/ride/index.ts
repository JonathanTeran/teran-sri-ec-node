import { TipoComprobante } from '../catalogs/index.js';
import type { Comprobante } from '../documents/index.js';
import { SriError } from '../errors/index.js';
import { nombreDocumento } from './blocks.js';
import { generarRideFactura } from './factura.ride.js';
import type { RideOptions } from './types.js';

/**
 * Punto de entrada público de `sri-ec/ride` (subpath aparte, ver
 * `package.json` → `exports["./ride"]`). El core de `sri-ec` (`src/index.ts`)
 * NO importa nada de este directorio: quien solo emite/firma comprobantes no
 * paga el costo de `pdfkit`/`qrcode`, que además son `optionalDependencies`
 * (ver `deps.ts`).
 *
 * Deliberadamente NO se reexporta `blocks.js`: sus `draw*` toman
 * `PDFKit.PDFDocument` como parámetro, y `@types/pdfkit` es solo
 * devDependency de este paquete — si el barrel público los reexportara,
 * `dist/ride/index.d.ts` referenciaría el namespace ambiental `PDFKit` y
 * cualquier consumidor con `skipLibCheck: false` (aunque solo use
 * `generarRide`) fallaría con `TS2503: Cannot find namespace 'PDFKit'`
 * (hallazgo confirmado del reviewer, fix round 1). Los helpers de `blocks.ts`
 * son el contrato interno que Task 2 consume por import relativo
 * (`./blocks.js`) dentro del mismo directorio `src/ride/` — no API pública.
 */
export * from './types.js';
export { generarRideFactura } from './factura.ride.js';
export { generarQr } from './qr.js';

/**
 * Genera el RIDE (PDF) del comprobante, despachando por `documento.tipo`.
 *
 * Solo Factura (codDoc `01`) está implementada en esta versión (Task 1 del
 * plan RIDE, `docs/plans/2026-08-04-ride.md`); los otros 5 tipos lanzan un
 * `SriError` claro — llegan en la Task 2.
 */
export async function generarRide(opciones: RideOptions<Comprobante>): Promise<Uint8Array> {
  switch (opciones.documento.tipo) {
    case TipoComprobante.Factura:
      return generarRideFactura({ ...opciones, documento: opciones.documento });

    case TipoComprobante.LiquidacionCompra:
    case TipoComprobante.NotaCredito:
    case TipoComprobante.NotaDebito:
    case TipoComprobante.GuiaRemision:
    case TipoComprobante.Retencion:
      throw new SriError(
        `El RIDE de ${nombreDocumento(opciones.documento.tipo)} llega en la próxima versión de sri-ec/ride.`,
        'RIDE_NOT_IMPLEMENTED',
      );

    default:
      throw new SriError('Tipo de comprobante no soportado por el RIDE.', 'RIDE_NOT_IMPLEMENTED');
  }
}
