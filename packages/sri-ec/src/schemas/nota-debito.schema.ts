import { z } from 'zod';

import { TipoComprobante } from '../catalogs/index.js';
import type { Motivo, NotaDebito } from '../documents/nota-debito.js';
import {
  camposAdicionalesField,
  contribuyenteEspecialField,
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
 * Motivo de la Nota de Débito (port de `src/Documents/Motivo.php`).
 */
export const motivoSchema = z
  .object({
    razon: nonEmptyString,
    valor: montoField,
  })
  .strict() satisfies z.ZodType<Motivo>;

/**
 * Schema zod de Nota de Débito (codDoc `05`). `motivos` no puede estar
 * vacío: es obligatorio y no vacío en el value object PHP (ver comentario en
 * `documents/nota-debito.ts`). Espejo estructural de
 * `documents/nota-debito.ts::NotaDebito`.
 */
export const notaDebitoSchema = z
  .object({
    tipo: z.literal(TipoComprobante.NotaDebito),
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
    impuestos: z.array(totalImpuestoSchema).min(1, 'debe tener al menos un impuesto'),
    valorTotal: montoField,
    pagos: z.array(pagoSchema).min(1, 'debe tener al menos una forma de pago'),
    motivos: z.array(motivoSchema).min(1, 'debe tener al menos un motivo'),
    infoAdicional: camposAdicionalesField.optional(),
  })
  .strict() satisfies z.ZodType<NotaDebito>;
