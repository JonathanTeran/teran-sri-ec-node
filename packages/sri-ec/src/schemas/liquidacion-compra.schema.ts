import { z } from 'zod';

import { TipoComprobante } from '../catalogs/index.js';
import type { LiquidacionCompra } from '../documents/liquidacion-compra.js';
import {
  camposAdicionalesField,
  detalleSchema,
  fechaField,
  infoTributariaSchema,
  montoField,
  nonEmptyString,
  obligadoContabilidadField,
  pagoSchema,
  razonSocialField,
  totalImpuestoSchema,
} from './shared.schema.js';

/**
 * Schema zod de Liquidación de Compra (codDoc `03`). Mismos totales que
 * {@link facturaSchema} pero con "proveedor" en vez de "comprador". Espejo
 * estructural de `documents/liquidacion-compra.ts::LiquidacionCompra`.
 */
export const liquidacionCompraSchema = z
  .object({
    tipo: z.literal(TipoComprobante.LiquidacionCompra),
    infoTributaria: infoTributariaSchema,
    fechaEmision: fechaField,
    dirEstablecimiento: nonEmptyString.optional(),
    contribuyenteEspecial: nonEmptyString.optional(),
    tipoIdentificacionProveedor: nonEmptyString,
    razonSocialProveedor: razonSocialField,
    identificacionProveedor: nonEmptyString,
    direccionProveedor: nonEmptyString.optional(),
    totalSinImpuestos: montoField,
    totalDescuento: montoField,
    importeTotal: montoField,
    moneda: nonEmptyString.optional(),
    obligadoContabilidad: obligadoContabilidadField.optional(),
    totalConImpuestos: z.array(totalImpuestoSchema).min(1, 'debe tener al menos un total con impuestos'),
    detalles: z.array(detalleSchema).min(1, 'debe tener al menos un detalle'),
    pagos: z.array(pagoSchema).min(1, 'debe tener al menos una forma de pago'),
    infoAdicional: camposAdicionalesField.optional(),
  })
  .strict() satisfies z.ZodType<LiquidacionCompra>;
