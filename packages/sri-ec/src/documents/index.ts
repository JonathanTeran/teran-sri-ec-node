/**
 * Punto de entrada del módulo `documents`: re-exporta cada comprobante y su
 * unión discriminada `Comprobante` (por `tipo`), análoga a
 * `Teran\Sri\Documents\*` en el paquete PHP.
 */
export * from './shared.js';
export * from './factura.js';
export * from './liquidacion-compra.js';
export * from './nota-credito.js';
export * from './nota-debito.js';
export * from './guia-remision.js';
export * from './retencion.js';

import type { Factura } from './factura.js';
import type { GuiaRemision } from './guia-remision.js';
import type { LiquidacionCompra } from './liquidacion-compra.js';
import type { NotaCredito } from './nota-credito.js';
import type { NotaDebito } from './nota-debito.js';
import type { Retencion } from './retencion.js';

/** Unión discriminada (por `tipo`) de los 6 comprobantes soportados. */
export type Comprobante =
  | Factura
  | LiquidacionCompra
  | NotaCredito
  | NotaDebito
  | GuiaRemision
  | Retencion;
