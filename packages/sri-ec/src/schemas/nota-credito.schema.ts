import { z } from 'zod';

import { TipoComprobante } from '../catalogs/index.js';
import type { NotaCredito } from '../documents/nota-credito.js';
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
  razonSocialField,
  totalImpuestoSchema,
} from './shared.schema.js';

/**
 * Schema zod de Nota de Crédito (codDoc `04`). Añade sobre Factura los
 * campos de identificación del documento sustento (`codDocModificado`,
 * `numDocModificado`, `fechaEmisionDocSustento`); no tiene `pagos`. Espejo
 * estructural de `documents/nota-credito.ts::NotaCredito`.
 */
export const notaCreditoSchema = z
  .object({
    tipo: z.literal(TipoComprobante.NotaCredito),
    infoTributaria: infoTributariaSchema,
    fechaEmision: fechaField,
    dirEstablecimiento: dirEstablecimientoField.optional(),
    tipoIdentificacionComprador: nonEmptyString,
    razonSocialComprador: razonSocialField,
    identificacionComprador: nonEmptyString,
    contribuyenteEspecial: contribuyenteEspecialField.optional(),
    obligadoContabilidad: obligadoContabilidadField.optional(),
    rise: nonEmptyString.optional(),
    codDocModificado: nonEmptyString,
    numDocModificado: nonEmptyString,
    fechaEmisionDocSustento: fechaField,
    totalSinImpuestos: montoField,
    valorModificacion: montoField,
    moneda: nonEmptyString.optional(),
    totalConImpuestos: z.array(totalImpuestoSchema).min(1, 'debe tener al menos un total con impuestos'),
    detalles: z.array(detalleSchema).min(1, 'debe tener al menos un detalle'),
    motivo: nonEmptyString,
    infoAdicional: camposAdicionalesField.optional(),
  })
  .strict() satisfies z.ZodType<NotaCredito>;
