import { z } from 'zod';

import { TipoComprobante } from '../catalogs/index.js';
import type {
  DocSustento,
  ImpuestoDocSustentoRow,
  PagoSustentoRow,
  Retencion,
  RetencionRow,
} from '../documents/retencion.js';
import {
  camposAdicionalesField,
  fechaField,
  formaPagoField,
  infoTributariaSchema,
  montoField,
  nonEmptyString,
  obligadoContabilidadField,
  razonSocialField,
} from './shared.schema.js';

/**
 * Fila de `impuestosDocSustento` (port de `DocSustento::$impuestosDocSustento`).
 * Usa `.catchall(z.string())` en vez de `.strict()`: el value object PHP no
 * fija el catálogo de campos (es un `foreach` genérico), así que cualquier
 * campo SRI adicional no listado en {@link ImpuestoDocSustentoRow} debe
 * pasar mientras sea `string` — igual que el índice `[extra: string]: string`
 * del tipo TS.
 */
export const impuestoDocSustentoRowSchema = z
  .object({
    codImpuestoDocSustento: nonEmptyString,
    codigoPorcentaje: nonEmptyString,
    baseImponible: montoField,
    tarifa: montoField,
    // `minOccurs="0"` en el XSD: opcionales, no placeholders obligatorios.
    factorProporcionalidad: montoField.optional(),
    baseImponibleModificada: montoField.optional(),
    valorImpuesto: montoField,
  })
  .catchall(z.string().optional()) satisfies z.ZodType<ImpuestoDocSustentoRow>;

/**
 * Fila de `retenciones` (port de `DocSustento::$retenciones`). Mismos
 * motivos de `.catchall` que {@link impuestoDocSustentoRowSchema}.
 */
export const retencionRowSchema = z
  .object({
    codigo: nonEmptyString,
    codigoRetencion: nonEmptyString,
    baseImponible: montoField,
    porcentajeRetener: montoField,
    valorRetenido: montoField,
  })
  .catchall(z.string()) satisfies z.ZodType<RetencionRow>;

/**
 * Fila de `pagos` dentro de un `docSustento` (port de `DocSustento::$pagos`).
 * Mismos motivos de `.catchall` que {@link impuestoDocSustentoRowSchema}.
 */
export const pagoSustentoRowSchema = z
  .object({
    formaPago: formaPagoField,
    total: montoField,
  })
  .catchall(z.string()) satisfies z.ZodType<PagoSustentoRow>;

/**
 * Documento sustento de un Comprobante de Retención (port de
 * `src/Documents/DocSustento.php`, v2.0.0). `impuestosDocSustento`,
 * `retenciones` y `pagos` no pueden estar vacíos: son la razón de ser del
 * nodo `docSustento`.
 */
export const docSustentoSchema = z
  .object({
    codSustento: nonEmptyString,
    codDocSustento: nonEmptyString,
    numDocSustento: nonEmptyString,
    fechaEmisionDocSustento: fechaField,
    totalSinImpuestos: montoField,
    importeTotal: montoField,
    impuestosDocSustento: z
      .array(impuestoDocSustentoRowSchema)
      .min(1, 'debe tener al menos un impuesto de documento sustento'),
    retenciones: z.array(retencionRowSchema).min(1, 'debe tener al menos una retención'),
    pagos: z.array(pagoSustentoRowSchema).min(1, 'debe tener al menos un pago'),
    fechaRegistroContable: fechaField.optional(),
    numAutDocSustento: nonEmptyString.optional(),
    pagoLocExt: nonEmptyString.optional(),
    tipoRegi: nonEmptyString.optional(),
    paisEfecPago: nonEmptyString.optional(),
    aplicConvDobTwordsri: nonEmptyString.optional(),
    pagExtSujRetNorLeg: nonEmptyString.optional(),
    pagoRegFis: nonEmptyString.optional(),
    totalComprobantesReembolso: montoField.optional(),
    totalBaseImponibleReembolso: montoField.optional(),
    totalImpuestoReembolso: montoField.optional(),
  })
  .strict() satisfies z.ZodType<DocSustento>;

/**
 * Schema zod de Comprobante de Retención (codDoc `07`). `dirEstablecimiento`
 * es obligatorio (igual que en Guía de Remisión) y `docsSustento` no puede
 * estar vacío. Espejo estructural de `documents/retencion.ts::Retencion`.
 */
export const retencionSchema = z
  .object({
    tipo: z.literal(TipoComprobante.Retencion),
    infoTributaria: infoTributariaSchema,
    fechaEmision: fechaField,
    dirEstablecimiento: nonEmptyString,
    tipoIdentificacionSujetoRetenido: nonEmptyString,
    razonSocialSujetoRetenido: razonSocialField,
    identificacionSujetoRetenido: nonEmptyString,
    periodoFiscal: nonEmptyString,
    docsSustento: z.array(docSustentoSchema).min(1, 'debe tener al menos un documento sustento'),
    contribuyenteEspecial: nonEmptyString.optional(),
    obligadoContabilidad: obligadoContabilidadField.optional(),
    tipoSujetoRetenido: nonEmptyString.optional(),
    parteRel: nonEmptyString.optional(),
    infoAdicional: camposAdicionalesField.optional(),
  })
  .strict() satisfies z.ZodType<Retencion>;
