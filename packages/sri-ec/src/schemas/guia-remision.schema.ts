import { z } from 'zod';

import { TipoComprobante } from '../catalogs/index.js';
import type { Destinatario, DestinatarioDetalle, GuiaRemision } from '../documents/guia-remision.js';
import {
  camposAdicionalesField,
  fechaField,
  infoTributariaSchema,
  montoField,
  nonEmptyString,
  obligadoContabilidadField,
  razonSocialField,
  rucField,
} from './shared.schema.js';

/**
 * Línea de detalle de un {@link Destinatario} (port de la estructura cruda
 * que documenta `src/Documents/Destinatario.php`).
 */
export const destinatarioDetalleSchema = z
  .object({
    codigoInterno: nonEmptyString.optional(),
    codigoAdicional: nonEmptyString.optional(),
    descripcion: nonEmptyString,
    cantidad: montoField,
    detallesAdicionales: camposAdicionalesField.optional(),
  })
  .strict() satisfies z.ZodType<DestinatarioDetalle>;

/**
 * Destinatario de una Guía de Remisión (port de `src/Documents/Destinatario.php`).
 * `detalles` no puede estar vacío: un destinatario sin ítems trasladados no
 * es representable.
 */
export const destinatarioSchema = z
  .object({
    identificacionDestinatario: nonEmptyString,
    razonSocialDestinatario: razonSocialField,
    dirDestinatario: nonEmptyString,
    motivoTraslado: nonEmptyString,
    detalles: z.array(destinatarioDetalleSchema).min(1, 'debe tener al menos un detalle'),
    docAduaneroUnico: nonEmptyString.optional(),
    codEstabDestino: nonEmptyString.optional(),
    ruta: nonEmptyString.optional(),
    codDocSustento: nonEmptyString.optional(),
    numDocSustento: nonEmptyString.optional(),
    numAutDocSustento: nonEmptyString.optional(),
    fechaEmisionDocSustento: fechaField.optional(),
  })
  .strict() satisfies z.ZodType<Destinatario>;

/**
 * Schema zod de Guía de Remisión (codDoc `06`). `dirEstablecimiento` es
 * obligatorio (a diferencia de otros comprobantes) y `destinatarios` no
 * puede estar vacío. Espejo estructural de
 * `documents/guia-remision.ts::GuiaRemision`.
 */
export const guiaRemisionSchema = z
  .object({
    tipo: z.literal(TipoComprobante.GuiaRemision),
    infoTributaria: infoTributariaSchema,
    dirEstablecimiento: nonEmptyString,
    dirPartida: nonEmptyString,
    razonSocialTransportista: razonSocialField,
    tipoIdentificacionTransportista: nonEmptyString,
    rucTransportista: rucField,
    fechaIniTransporte: fechaField,
    fechaFinTransporte: fechaField,
    placa: nonEmptyString,
    destinatarios: z.array(destinatarioSchema).min(1, 'debe tener al menos un destinatario'),
    rise: nonEmptyString.optional(),
    obligadoContabilidad: obligadoContabilidadField.optional(),
    contribuyenteEspecial: nonEmptyString.optional(),
    infoAdicional: camposAdicionalesField.optional(),
  })
  .strict() satisfies z.ZodType<GuiaRemision>;
