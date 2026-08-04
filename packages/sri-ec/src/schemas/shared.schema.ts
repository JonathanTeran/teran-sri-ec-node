import { z } from 'zod';

import { Ambiente, TipoEmision } from '../catalogs/index.js';
import type { Detalle, InfoTributaria, Impuesto, Pago, TotalImpuesto } from '../documents/shared.js';
import { isMonto } from '../utils/money.js';

/**
 * Bloques de validación zod reutilizados por los 6 schemas de comprobante
 * (Task 5). Espejo estructural de los tipos en `documents/shared.ts`: cada
 * schema exportado aquí debe aceptar exactamente el shape del tipo TS
 * homónimo (verificado en tiempo de compilación con `satisfies z.ZodType<T>`
 * más abajo y en cada `*.schema.ts` de comprobante).
 *
 * Reglas compartidas (brief Task 5): `ruc` `/^\d{13}$/`, `estab`/`ptoEmi`
 * `/^\d{3}$/`, `secuencial` `/^\d{9}$/`, `fecha` `/^\d{2}\/\d{2}\/\d{4}$/`,
 * montos vía `isMonto` (`utils/money.ts`), `razonSocial` 1–300 caracteres.
 * La validación de catálogo (p.ej. que `ruc` tenga un tercer dígito válido,
 * que `formaPago` exista en `catalogs/forma-pago.ts`) es responsabilidad de
 * `BusinessValidator` (Task 6) — aquí solo se valida forma/estructura.
 */

/** Cadena no vacía; base de casi todo campo `string` obligatorio del XSD. */
export const nonEmptyString = z.string().min(1, 'no puede estar vacío');

/** RUC ecuatoriano: exactamente 13 dígitos (port de `numeroRuc` en el XSD). */
export const rucField = z.string().regex(/^\d{13}$/, 'debe tener exactamente 13 dígitos numéricos');

/** Código de establecimiento/punto de emisión: exactamente 3 dígitos. */
export const estabPtoEmiField = z.string().regex(/^\d{3}$/, 'debe tener exactamente 3 dígitos numéricos');

/** Secuencial de `infoTributaria`: exactamente 9 dígitos. */
export const secuencialField = z.string().regex(/^\d{9}$/, 'debe tener exactamente 9 dígitos numéricos');

/** Fecha en formato SRI `DD/MM/YYYY`. */
export const fechaField = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "debe tener formato 'DD/MM/YYYY'");

/** Monto decimal-seguro: reusa `isMonto` (entero o hasta 6 decimales, no negativo). */
export const montoField = z.string().refine(isMonto, 'debe ser un monto numérico válido (entero o hasta 6 decimales, no negativo)');

/** `razonSocial` y cualquier campo `razonSocial*`: 1–300 caracteres (port de `razonSocial` en el XSD). */
export const razonSocialField = z.string().min(1, 'no puede estar vacío').max(300, 'excede el máximo de 300 caracteres');

/** Código de forma de pago: 2 dígitos numéricos (catálogo real en `catalogs/forma-pago.ts`, validado por BusinessValidator). */
export const formaPagoField = z.string().regex(/^\d{2}$/, 'debe ser un código numérico de 2 dígitos');

/** `infoAdicional` / `detallesAdicionales`: pares nombre/valor libres (`<campoAdicional nombre="" valor="">`). */
export const camposAdicionalesField = z.record(z.string(), z.string());

/** `obligadoContabilidad`: `'SI' | 'NO'` (port de `obligadoContabilidad` en el XSD). */
export const obligadoContabilidadField = z.enum(['SI', 'NO']);

/**
 * `infoTributaria`, común a los 6 comprobantes (port de
 * `src/Documents/InfoTributaria.php`).
 */
export const infoTributariaSchema = z
  .object({
    ambiente: z.enum(Ambiente),
    razonSocial: razonSocialField,
    ruc: rucField,
    estab: estabPtoEmiField,
    ptoEmi: estabPtoEmiField,
    secuencial: secuencialField,
    dirMatriz: nonEmptyString,
    tipoEmision: z.enum(TipoEmision).optional(),
    nombreComercial: nonEmptyString.optional(),
    contribuyenteRimpe: nonEmptyString.optional(),
    agenteRetencion: nonEmptyString.optional(),
  })
  .strict() satisfies z.ZodType<InfoTributaria>;

/**
 * Impuesto de un `detalle` (línea de ítem). Port de `src/Documents/Impuesto.php`.
 */
export const impuestoSchema = z
  .object({
    codigo: nonEmptyString,
    codigoPorcentaje: nonEmptyString,
    tarifa: montoField,
    baseImponible: montoField,
    valor: montoField,
  })
  .strict() satisfies z.ZodType<Impuesto>;

/**
 * Impuesto agregado a nivel de comprobante (`totalConImpuestos` /
 * `infoNotaDebito.impuestos`). Port de la sección homónima del XSD.
 */
export const totalImpuestoSchema = z
  .object({
    codigo: nonEmptyString,
    codigoPorcentaje: nonEmptyString,
    baseImponible: montoField,
    valor: montoField,
    descuentoAdicional: montoField.optional(),
  })
  .strict() satisfies z.ZodType<TotalImpuesto>;

/**
 * Forma de pago (port de `src/Documents/Pago.php`).
 */
export const pagoSchema = z
  .object({
    formaPago: formaPagoField,
    total: montoField,
    plazo: nonEmptyString.optional(),
    unidadTiempo: nonEmptyString.optional(),
  })
  .strict() satisfies z.ZodType<Pago>;

/**
 * Línea de detalle (port de `src/Documents/Detalle.php`). `impuestos` no
 * puede estar vacío: un detalle sin impuestos no es representable en el XSD
 * del SRI (`impuestos` es `maxOccurs="unbounded"` sin `minOccurs="0"`).
 */
export const detalleSchema = z
  .object({
    codigoPrincipal: nonEmptyString.optional(),
    codigoAuxiliar: nonEmptyString.optional(),
    descripcion: nonEmptyString,
    cantidad: montoField,
    precioUnitario: montoField,
    descuento: montoField,
    precioTotalSinImpuesto: montoField,
    impuestos: z.array(impuestoSchema).min(1, 'debe tener al menos un impuesto'),
    detallesAdicionales: camposAdicionalesField.optional(),
  })
  .strict() satisfies z.ZodType<Detalle>;
