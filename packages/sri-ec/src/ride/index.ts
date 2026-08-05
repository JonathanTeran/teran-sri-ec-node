import { TipoComprobante } from '../catalogs/index.js';
import type { Comprobante } from '../documents/index.js';
import { SriError } from '../errors/index.js';
import { generarRideFactura } from './factura.ride.js';
import { generarRideGuiaRemision } from './guia-remision.ride.js';
import { generarRideLiquidacionCompra } from './liquidacion-compra.ride.js';
import { generarRideNotaCredito } from './nota-credito.ride.js';
import { generarRideNotaDebito } from './nota-debito.ride.js';
import { generarRideRetencion } from './retencion.ride.js';
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
 * son el contrato interno que cada `*.ride.ts` consume por import relativo
 * (`./blocks.js`) dentro del mismo directorio `src/ride/` — no API pública.
 */
export * from './types.js';
export { generarRideFactura } from './factura.ride.js';
export { generarRideLiquidacionCompra } from './liquidacion-compra.ride.js';
export { generarRideNotaCredito } from './nota-credito.ride.js';
export { generarRideNotaDebito } from './nota-debito.ride.js';
export { generarRideGuiaRemision } from './guia-remision.ride.js';
export { generarRideRetencion } from './retencion.ride.js';
export { generarQr } from './qr.js';

/**
 * Genera el RIDE (PDF) del comprobante, despachando por `documento.tipo`.
 * Cubre los 6 tipos de comprobante del catálogo SRI (Task 1: factura;
 * Task 2: liquidación de compra, nota de crédito, nota de débito, guía de
 * remisión, retención — ver `docs/plans/2026-08-04-ride.md`).
 *
 * El `default` es una salvaguarda inalcanzable en tiempo de compilación
 * (`documento.tipo` es una unión discriminada exhaustiva sobre los 6 casos
 * de arriba): protege en runtime contra un `Comprobante` construido sin
 * pasar por el sistema de tipos (p.ej. `JSON.parse` de un payload externo
 * con un `tipo` inválido).
 */
export async function generarRide(opciones: RideOptions<Comprobante>): Promise<Uint8Array> {
  switch (opciones.documento.tipo) {
    case TipoComprobante.Factura:
      return generarRideFactura({ ...opciones, documento: opciones.documento });

    case TipoComprobante.LiquidacionCompra:
      return generarRideLiquidacionCompra({ ...opciones, documento: opciones.documento });

    case TipoComprobante.NotaCredito:
      return generarRideNotaCredito({ ...opciones, documento: opciones.documento });

    case TipoComprobante.NotaDebito:
      return generarRideNotaDebito({ ...opciones, documento: opciones.documento });

    case TipoComprobante.GuiaRemision:
      return generarRideGuiaRemision({ ...opciones, documento: opciones.documento });

    case TipoComprobante.Retencion:
      return generarRideRetencion({ ...opciones, documento: opciones.documento });

    default:
      throw new SriError('Tipo de comprobante no soportado por el RIDE.', 'RIDE_NOT_IMPLEMENTED');
  }
}
