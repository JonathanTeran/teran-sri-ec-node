import { z } from 'zod';

import { TipoComprobante } from '../catalogs/index.js';
import type { Factura } from '../documents/factura.js';
import {
  camposAdicionalesField,
  contribuyenteEspecialField,
  detalleSchema,
  dirEstablecimientoField,
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
 * Schema zod de Factura (codDoc `01`). Valida el documento completo, no solo
 * `infoTributaria`. Espejo estructural de `documents/factura.ts::Factura`
 * (`satisfies z.ZodType<Factura>` rompe el build si diverge).
 */
export const facturaSchema = z
  .object({
    tipo: z.literal(TipoComprobante.Factura),
    infoTributaria: infoTributariaSchema,
    fechaEmision: fechaField,
    dirEstablecimiento: dirEstablecimientoField.optional(),
    contribuyenteEspecial: contribuyenteEspecialField.optional(),
    tipoIdentificacionComprador: nonEmptyString,
    razonSocialComprador: razonSocialField,
    identificacionComprador: nonEmptyString,
    direccionComprador: nonEmptyString.optional(),
    guiaRemision: nonEmptyString.optional(),
    totalSinImpuestos: montoField,
    totalDescuento: montoField,
    propina: montoField.optional(),
    importeTotal: montoField,
    moneda: nonEmptyString.optional(),
    obligadoContabilidad: obligadoContabilidadField.optional(),
    totalConImpuestos: z.array(totalImpuestoSchema).min(1, 'debe tener al menos un total con impuestos'),
    detalles: z.array(detalleSchema).min(1, 'debe tener al menos un detalle'),
    pagos: z.array(pagoSchema).min(1, 'debe tener al menos una forma de pago'),
    infoAdicional: camposAdicionalesField.optional(),
  })
  .strict() satisfies z.ZodType<Factura>;
