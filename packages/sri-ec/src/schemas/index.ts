import type { z } from 'zod';

import { TipoComprobante } from '../catalogs/index.js';
import type { Comprobante } from '../documents/index.js';
import { facturaSchema } from './factura.schema.js';
import { guiaRemisionSchema } from './guia-remision.schema.js';
import { liquidacionCompraSchema } from './liquidacion-compra.schema.js';
import { notaCreditoSchema } from './nota-credito.schema.js';
import { notaDebitoSchema } from './nota-debito.schema.js';
import { retencionSchema } from './retencion.schema.js';

export * from './factura.schema.js';
export * from './guia-remision.schema.js';
export * from './liquidacion-compra.schema.js';
export * from './nota-credito.schema.js';
export * from './nota-debito.schema.js';
export * from './retencion.schema.js';
export * from './shared.schema.js';

/**
 * Devuelve el schema zod correspondiente a un `TipoComprobante`, ya listo
 * para validar el documento completo (`infoTributaria` incluida) — no solo
 * un fragmento. Punto de entrada del módulo `schemas` (Task 5), consumido
 * por `SriClient`/`BusinessValidator` (Tasks 6, 11) antes de firmar/emitir.
 */
export function schemaFor(tipo: TipoComprobante): z.ZodType<Comprobante> {
  switch (tipo) {
    case TipoComprobante.Factura:
      return facturaSchema;
    case TipoComprobante.LiquidacionCompra:
      return liquidacionCompraSchema;
    case TipoComprobante.NotaCredito:
      return notaCreditoSchema;
    case TipoComprobante.NotaDebito:
      return notaDebitoSchema;
    case TipoComprobante.GuiaRemision:
      return guiaRemisionSchema;
    case TipoComprobante.Retencion:
      return retencionSchema;
  }
}

/**
 * Aplana los `issues` de un `ZodError` a líneas `"path: mensaje"`, listas
 * para volcar en `ValidationError.errors` (`errors/index.ts`). Las issues de
 * raíz (p.ej. `unrecognized_keys` sobre el objeto completo, `path: []`) se
 * devuelven sin prefijo de ruta.
 */
export function zodIssuesToErrors(issues: readonly z.ZodIssue[]): string[] {
  return issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
