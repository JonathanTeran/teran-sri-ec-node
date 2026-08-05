import { FormaPago } from '../catalogs/forma-pago.js';
import { TipoComprobante } from '../catalogs/index.js';
import type { Comprobante, Detalle, InfoTributaria, Pago, TotalImpuesto } from '../documents/index.js';
import type { RetencionRow } from '../documents/retencion.js';
import { ValidationError } from '../errors/index.js';
import { fromCents, isMonto, toCents } from '../utils/money.js';
import { schemaFor, zodIssuesToErrors } from './index.js';

/**
 * Validador de negocio (port de `src/Schema/BusinessValidator.php`), más las
 * "reglas mínimas" de cuadre aritmético que exige el brief de Task 6 (que el
 * PHP original no implementa como tal).
 *
 * A diferencia de `schemas/*.schema.ts` (Task 5), que valida forma/estructura
 * (regex, longitudes, "es un monto"), este módulo valida *coherencia*: que
 * las cifras declaradas por el emisor efectivamente cuadren entre sí. Toda la
 * aritmética ocurre en centavos enteros (`bigint`/`number`), nunca en
 * `number` de punto flotante, siguiendo la convención de `utils/money.ts`.
 *
 * Diseño defensivo: cada regla vuelve a comprobar que los montos/arrays que
 * necesita sean válidos/estén presentes antes de operar, y se salta en
 * silencio (sin lanzar) si no lo son — esa responsabilidad es de
 * `schemas/*.schema.ts` (Task 5) vía `assertValid`. `validateBusiness` nunca
 * lanza: siempre devuelve un array (vacío si no hay errores), incluso si se
 * invoca standalone sobre un documento que no pasó zod.
 */

// ---------------------------------------------------------------------------
// Helpers de aritmética decimal-segura (centavos vía utils/money.ts, o
// "micro-unidades" en escala 1e6 para productos que necesitan más precisión
// intermedia que el detalle de un `Detalle` individual).
// ---------------------------------------------------------------------------

/** `toCents`, pero devuelve `null` en vez de lanzar cuando `s` no es un monto válido. */
function toCentsOrNull(s: string | undefined): number | null {
  if (typeof s !== 'string' || !isMonto(s)) return null;
  return toCents(s);
}

/**
 * Convierte un monto (`isMonto`, hasta 6 decimales) a un entero en
 * "micro-unidades" (escala 1e6), sin redondear — réplica de la normalización
 * que hace `Money::of()` en PHP (`bcadd($str, '0', 6)`): como `isMonto` ya
 * garantiza como máximo 6 decimales, rellenar a 6 con ceros a la derecha es
 * una conversión exacta, no hay redondeo posible. Devuelve `null` si `s` no
 * es un monto válido.
 */
function toMicroOrNull(s: string | undefined): bigint | null {
  if (typeof s !== 'string' || !isMonto(s)) return null;
  const [intPart, fracPart = ''] = s.split('.');
  const fracPadded = fracPart.padEnd(6, '0');
  return BigInt(intPart) * 1_000_000n + BigInt(fracPadded);
}

/**
 * Redondea micro-unidades (escala 1e6) a centavos con la misma semántica
 * half-up que `toCents` (sumar medio centavo == 5_000 micro-unidades antes
 * de truncar), preservando el signo.
 */
function microToCentsHalfUp(micro: bigint): number {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const cents = (abs + 5_000n) / 10_000n;
  return Number(negative ? -cents : cents);
}

/** Suma una lista de montos a centavos enteros; `null` si alguno no es válido. */
function sumCentsOrNull(montos: readonly string[]): number | null {
  let total = 0;
  for (const monto of montos) {
    const cents = toCentsOrNull(monto);
    if (cents === null) return null;
    total += cents;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Port directo de BusinessValidator.php: validarRuc() y validarCampos().
// ---------------------------------------------------------------------------

/**
 * Port de `BusinessValidator::validarRuc()`. Valida el RUC ecuatoriano de 13
 * dígitos localmente (tercer dígito de régimen + código de establecimiento
 * distinto de "000"). El formato "13 dígitos numéricos" ya lo exige
 * `rucField` en `schemas/shared.schema.ts`; esta función cubre el resto de
 * la regla que el comentario de ese archivo delega explícitamente a
 * BusinessValidator (Task 6).
 *
 * Nota: la validación *online* contra el SRI (`RucValidator::checkOnline()`
 * en PHP) es responsabilidad de Task 11 (`SriClient`/RUC), no de este
 * módulo — aquí solo vive la parte local/síncrona.
 *
 * Exportada (no solo de uso interno de `checkRuc`) porque el futuro port de
 * `Utils/RucValidator.php` (Task 14) llama a `BusinessValidator::validarRuc()`
 * como paso local antes de la verificación online (`RucValidator.php:16`) —
 * debe reusar exactamente esta función en vez de duplicar el algoritmo.
 */
export function esRucLocalValido(ruc: string): boolean {
  if (!/^\d{13}$/.test(ruc)) return false;

  const tercerDigito = Number(ruc[2]);
  if (tercerDigito > 6 && tercerDigito !== 9) return false;

  // Código de establecimiento (últimos 3 dígitos): "000" no es válido.
  if (ruc.slice(10, 13) === '000') return false;

  return true;
}

function checkRuc(ruc: string | undefined, path: string): string[] {
  if (typeof ruc !== 'string') return [];
  if (!esRucLocalValido(ruc)) {
    return [`${path}: RUC inválido (tercer dígito de régimen o código de establecimiento incorrecto).`];
  }
  return [];
}

/**
 * Port de `BusinessValidator::validarCampos()`: longitudes máximas de campos
 * comunes de `infoTributaria` según ficha técnica SRI. `secuencial` ya está
 * acotado a exactamente 9 dígitos por `secuencialField` (zod, Task 5) y
 * `razonSocial` a 300 por `razonSocialField` — se repiten aquí para paridad
 * exacta con el PHP y para que `validateBusiness` siga siendo útil sin pasar
 * primero por zod (p.ej. sobre datos ya parseados).
 *
 * `mb_strlen` (PHP, cuenta caracteres Unicode) se replica con
 * `[...valor].length` (cuenta code points, no code units UTF-16).
 *
 * Exportada por la misma razón que {@link esRucLocalValido}: en PHP,
 * `SRI.php:239` llama a `BusinessValidator::validarCampos()` directamente
 * (fuera de la clase) antes de generar el XML — cualquier port futuro de ese
 * flujo (p.ej. un `SriClient.emit()` de Task 11+) debe poder reusar esta
 * función en vez de reimplementar las longitudes máximas.
 */
export function checkCamposLocales(info: InfoTributaria): string[] {
  const limites: ReadonlyArray<readonly [keyof InfoTributaria, number]> = [
    ['razonSocial', 300],
    ['nombreComercial', 300],
    ['dirMatriz', 300],
    ['secuencial', 9],
  ];

  const errores: string[] = [];
  for (const [campo, longitud] of limites) {
    const valor = info[campo];
    if (typeof valor === 'string' && [...valor].length > longitud) {
      errores.push(`infoTributaria.${campo}: excede la longitud máxima de ${longitud} caracteres.`);
    }
  }
  return errores;
}

// ---------------------------------------------------------------------------
// Catálogo de formas de pago (delegado explícitamente a BusinessValidator
// por el comentario de `schemas/shared.schema.ts`: "que formaPago exista en
// catalogs/forma-pago.ts es responsabilidad de BusinessValidator").
// ---------------------------------------------------------------------------

const FORMAS_PAGO_VALIDAS = new Set<string>(Object.values(FormaPago));

function checkFormaPago(formaPago: string | undefined, path: string): string[] {
  if (typeof formaPago !== 'string') return [];
  if (!FORMAS_PAGO_VALIDAS.has(formaPago)) {
    return [`${path}: código de forma de pago '${formaPago}' no está en el catálogo SRI (catalogs/forma-pago.ts).`];
  }
  return [];
}

// ---------------------------------------------------------------------------
// "Reglas mínimas" de cuadre aritmético (brief Task 6). Tolerancia ±1
// centavo SOLO en el cálculo por-detalle y en `valorRetenido` de retención
// (decisión del controlador); el resto de sumas se exige exacto.
// ---------------------------------------------------------------------------

/** `Σ detalles[].precioTotalSinImpuesto == totalSinImpuestos` (exacto). */
function checkTotalSinImpuestos(detalles: readonly Detalle[], totalSinImpuestos: string | undefined): string[] {
  const sumaCents = sumCentsOrNull(detalles.map((d) => d.precioTotalSinImpuesto));
  const totalCents = toCentsOrNull(totalSinImpuestos);
  if (sumaCents === null || totalCents === null || sumaCents === totalCents) return [];

  return [
    `totalSinImpuestos: la suma de detalles[].precioTotalSinImpuesto (${fromCents(sumaCents)}) no coincide con totalSinImpuestos (${totalSinImpuestos}).`,
  ];
}

/**
 * Por detalle: `cantidad*precioUnitario - descuento == precioTotalSinImpuesto`
 * (±1 centavo). `cantidad` y `precioUnitario` admiten hasta 6 decimales
 * (XSD SRI); el producto se calcula en "micro-unidades" (escala 1e6) y se
 * trunca de vuelta a escala 1e6 — igual que `Money::times()` en PHP
 * (`bcmul($cantidad, $precioUnitario, 6)`, que trunca el excedente de
 * decimales en vez de redondearlo) — y solo se redondea half-up al pasar a
 * centavos para la comparación final.
 */
function checkDetalleMath(detalle: Detalle, index: number): string[] {
  const cantidadMicro = toMicroOrNull(detalle.cantidad);
  const precioMicro = toMicroOrNull(detalle.precioUnitario);
  const descuentoMicro = toMicroOrNull(detalle.descuento);
  const precioTotalCents = toCentsOrNull(detalle.precioTotalSinImpuesto);

  if (cantidadMicro === null || precioMicro === null || descuentoMicro === null || precioTotalCents === null) {
    return [];
  }

  // Producto exacto en escala 1e12 (1e6 * 1e6); truncar a escala 1e6.
  const productoMicro = (cantidadMicro * precioMicro) / 1_000_000n;
  const netoMicro = productoMicro - descuentoMicro;
  const netoCents = microToCentsHalfUp(netoMicro);

  if (Math.abs(netoCents - precioTotalCents) > 1) {
    return [
      `detalles[${index}].precioTotalSinImpuesto: cantidad*precioUnitario-descuento (${fromCents(netoCents)}) no coincide con precioTotalSinImpuesto (${detalle.precioTotalSinImpuesto}) [tolerancia ±0.01].`,
    ];
  }
  return [];
}

interface ImpuestoAgg {
  baseCents: number;
  valorCents: number;
}

/** Agrupa por `codigo|codigoPorcentaje`, sumando `baseImponible` y `valor` a centavos. */
function aggregateImpuestos(
  items: ReadonlyArray<{ codigo: string; codigoPorcentaje: string; baseImponible: string; valor: string }>,
): Map<string, ImpuestoAgg> | null {
  const map = new Map<string, ImpuestoAgg>();
  for (const item of items) {
    const baseCents = toCentsOrNull(item.baseImponible);
    const valorCents = toCentsOrNull(item.valor);
    if (baseCents === null || valorCents === null) return null;

    const key = `${item.codigo}|${item.codigoPorcentaje}`;
    const prev = map.get(key) ?? { baseCents: 0, valorCents: 0 };
    map.set(key, { baseCents: prev.baseCents + baseCents, valorCents: prev.valorCents + valorCents });
  }
  return map;
}

/** `Σ detalles[].impuestos` (agrupado por codigo/codigoPorcentaje) `== totalConImpuestos` (exacto). */
function checkAgregacionImpuestos(detalles: readonly Detalle[], totalConImpuestos: readonly TotalImpuesto[]): string[] {
  const detalleAgg = aggregateImpuestos(detalles.flatMap((d) => d.impuestos));
  const totalAgg = aggregateImpuestos(totalConImpuestos);
  if (detalleAgg === null || totalAgg === null) return [];

  const errores: string[] = [];
  const keys = new Set([...detalleAgg.keys(), ...totalAgg.keys()]);
  for (const key of keys) {
    const [codigo, codigoPorcentaje] = key.split('|');
    const d = detalleAgg.get(key);
    const t = totalAgg.get(key);

    if (!d || !t) {
      const faltaEn = d ? 'totalConImpuestos' : 'detalles[].impuestos';
      errores.push(
        `totalConImpuestos: el impuesto codigo=${codigo}/codigoPorcentaje=${codigoPorcentaje} no está presente en ${faltaEn}.`,
      );
      continue;
    }

    if (d.baseCents !== t.baseCents || d.valorCents !== t.valorCents) {
      errores.push(
        `totalConImpuestos: la agregación de detalles[].impuestos (codigo=${codigo}/codigoPorcentaje=${codigoPorcentaje}) — base ${fromCents(d.baseCents)}, valor ${fromCents(d.valorCents)} — no coincide con totalConImpuestos — base ${fromCents(t.baseCents)}, valor ${fromCents(t.valorCents)}.`,
      );
    }
  }
  return errores;
}

/** `totalSinImpuestos + Σ totalConImpuestos[].valor + propina == importeTotal` (exacto). */
function checkImporteTotal(
  totalSinImpuestos: string | undefined,
  totalConImpuestos: readonly TotalImpuesto[],
  propina: string | undefined,
  importeTotal: string | undefined,
): string[] {
  const totalSinImpuestosCents = toCentsOrNull(totalSinImpuestos);
  const impuestosCents = sumCentsOrNull(totalConImpuestos.map((t) => t.valor));
  const propinaCents = propina === undefined ? 0 : toCentsOrNull(propina);
  const importeTotalCents = toCentsOrNull(importeTotal);

  if (
    totalSinImpuestosCents === null ||
    impuestosCents === null ||
    propinaCents === null ||
    importeTotalCents === null
  ) {
    return [];
  }

  const calculado = totalSinImpuestosCents + impuestosCents + propinaCents;
  if (calculado !== importeTotalCents) {
    return [
      `importeTotal: totalSinImpuestos + Σ totalConImpuestos[].valor + propina (${fromCents(calculado)}) no coincide con importeTotal (${importeTotal}).`,
    ];
  }
  return [];
}

/** `Σ pagos[].total == objetivo` (exacto). Nombra el campo objetivo (`importeTotal`/`valorTotal`) en el mensaje. */
function checkPagosSuman(pagos: readonly Pago[], objetivo: string | undefined, campoObjetivo: string): string[] {
  const sumaCents = sumCentsOrNull(pagos.map((p) => p.total));
  const objetivoCents = toCentsOrNull(objetivo);
  if (sumaCents === null || objetivoCents === null || sumaCents === objetivoCents) return [];

  return [
    `${campoObjetivo}: la suma de pagos[].total (${fromCents(sumaCents)}) no coincide con ${campoObjetivo} (${objetivo}).`,
  ];
}

/**
 * Coherencia NC/ND: `totalSinImpuestos + Σ impuestos[].valor == campoTotal`
 * (exacto). En NotaCredito, `campoTotal` es `valorModificacion` y los
 * impuestos vienen de `totalConImpuestos`; en NotaDebito es `valorTotal` con
 * los impuestos de `impuestos` — mismo cálculo, campo distinto.
 */
function checkTotalCoherente(
  totalSinImpuestos: string | undefined,
  impuestos: readonly TotalImpuesto[],
  campoTotal: string,
  valorCampoTotal: string | undefined,
): string[] {
  const baseCents = toCentsOrNull(totalSinImpuestos);
  const impuestosCents = sumCentsOrNull(impuestos.map((i) => i.valor));
  const totalCents = toCentsOrNull(valorCampoTotal);
  if (baseCents === null || impuestosCents === null || totalCents === null) return [];

  const calculado = baseCents + impuestosCents;
  if (calculado !== totalCents) {
    return [
      `${campoTotal}: totalSinImpuestos + Σ impuestos[].valor (${fromCents(calculado)}) no coincide con ${campoTotal} (${valorCampoTotal}).`,
    ];
  }
  return [];
}

/**
 * Retención: `baseImponible * porcentajeRetener / 100 == valorRetenido`
 * (±1 centavo). `porcentajeRetener` es un número de porcentaje "plano" (p.ej.
 * `'10'` significa 10%, no una fracción `0.10` — así lo confirma el fixture
 * de `test/documents.test.ts`: base 1000.00 * 10 / 100 = 100.00).
 *
 * Álgebra en micro-unidades (escala 1e6): `baseMicro * porcentajeMicro` cae
 * en escala 1e12; dividir entre `100 * 1e6` lo devuelve a escala 1e6 antes
 * de redondear half-up a centavos.
 */
function checkValorRetenido(row: RetencionRow, docIndex: number, rowIndex: number): string[] {
  const baseMicro = toMicroOrNull(row.baseImponible);
  const porcentajeMicro = toMicroOrNull(row.porcentajeRetener);
  const valorRetenidoCents = toCentsOrNull(row.valorRetenido);
  if (baseMicro === null || porcentajeMicro === null || valorRetenidoCents === null) return [];

  const esperadoMicro = (baseMicro * porcentajeMicro) / 100_000_000n;
  const esperadoCents = microToCentsHalfUp(esperadoMicro);

  if (Math.abs(esperadoCents - valorRetenidoCents) > 1) {
    return [
      `docsSustento[${docIndex}].retenciones[${rowIndex}].valorRetenido: baseImponible*porcentajeRetener/100 (${fromCents(esperadoCents)}) no coincide con valorRetenido (${row.valorRetenido}) [tolerancia ±0.01].`,
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Reglas comunes a Factura y LiquidacionCompra (mismos totales/pagos;
// LiquidacionCompra no tiene `propina`).
// ---------------------------------------------------------------------------

function checkFacturaLike(
  totalSinImpuestos: string | undefined,
  totalConImpuestos: readonly TotalImpuesto[],
  detalles: readonly Detalle[],
  pagos: readonly Pago[],
  propina: string | undefined,
  importeTotal: string | undefined,
): string[] {
  const errores: string[] = [];

  errores.push(...checkTotalSinImpuestos(detalles, totalSinImpuestos));
  detalles.forEach((detalle, index) => errores.push(...checkDetalleMath(detalle, index)));
  errores.push(...checkAgregacionImpuestos(detalles, totalConImpuestos));
  errores.push(...checkImporteTotal(totalSinImpuestos, totalConImpuestos, propina, importeTotal));
  errores.push(...checkPagosSuman(pagos, importeTotal, 'importeTotal'));
  pagos.forEach((pago, index) => errores.push(...checkFormaPago(pago.formaPago, `pagos[${index}].formaPago`)));

  return errores;
}

function checkInfoTributariaComun(info: InfoTributaria | undefined): string[] {
  if (!info) return [];
  return [...checkCamposLocales(info), ...checkRuc(info.ruc, 'infoTributaria.ruc')];
}

/**
 * Valida las reglas de negocio de `doc` (cuadre aritmético + port de
 * `BusinessValidator.php`). Nunca lanza: devuelve un array de mensajes
 * `"campo: descripción"` (vacío == sin errores de negocio). No repite
 * validación estructural/de forma (eso es `schemaFor(doc.tipo)`, Task 5) —
 * úsese junto a ella vía {@link assertValid}, o de forma independiente si
 * `doc` ya se sabe bien formado.
 */
export function validateBusiness(doc: Comprobante): string[] {
  const errores: string[] = [...checkInfoTributariaComun(doc.infoTributaria)];

  switch (doc.tipo) {
    case TipoComprobante.Factura: {
      const detalles = doc.detalles ?? [];
      const totalConImpuestos = doc.totalConImpuestos ?? [];
      const pagos = doc.pagos ?? [];
      errores.push(
        ...checkFacturaLike(
          doc.totalSinImpuestos,
          totalConImpuestos,
          detalles,
          pagos,
          doc.propina,
          doc.importeTotal,
        ),
      );
      break;
    }

    case TipoComprobante.LiquidacionCompra: {
      const detalles = doc.detalles ?? [];
      const totalConImpuestos = doc.totalConImpuestos ?? [];
      const pagos = doc.pagos ?? [];
      // LiquidacionCompra no modela `propina` (no existe en el value object PHP).
      errores.push(
        ...checkFacturaLike(doc.totalSinImpuestos, totalConImpuestos, detalles, pagos, undefined, doc.importeTotal),
      );
      break;
    }

    case TipoComprobante.NotaCredito: {
      const detalles = doc.detalles ?? [];
      const totalConImpuestos = doc.totalConImpuestos ?? [];
      errores.push(...checkTotalSinImpuestos(detalles, doc.totalSinImpuestos));
      detalles.forEach((detalle, index) => errores.push(...checkDetalleMath(detalle, index)));
      errores.push(...checkAgregacionImpuestos(detalles, totalConImpuestos));
      errores.push(
        ...checkTotalCoherente(doc.totalSinImpuestos, totalConImpuestos, 'valorModificacion', doc.valorModificacion),
      );
      break;
    }

    case TipoComprobante.NotaDebito: {
      const impuestos = doc.impuestos ?? [];
      const pagos = doc.pagos ?? [];
      errores.push(...checkTotalCoherente(doc.totalSinImpuestos, impuestos, 'valorTotal', doc.valorTotal));
      errores.push(...checkPagosSuman(pagos, doc.valorTotal, 'valorTotal'));
      pagos.forEach((pago, index) => errores.push(...checkFormaPago(pago.formaPago, `pagos[${index}].formaPago`)));
      break;
    }

    case TipoComprobante.GuiaRemision: {
      errores.push(...checkRuc(doc.rucTransportista, 'rucTransportista'));
      break;
    }

    case TipoComprobante.Retencion: {
      const docsSustento = doc.docsSustento ?? [];
      docsSustento.forEach((docSustento, docIndex) => {
        (docSustento.retenciones ?? []).forEach((row, rowIndex) => {
          errores.push(...checkValorRetenido(row, docIndex, rowIndex));
        });
        (docSustento.pagos ?? []).forEach((pago, index) => {
          errores.push(
            ...checkFormaPago(pago.formaPago, `docsSustento[${docIndex}].pagos[${index}].formaPago`),
          );
        });
      });
      break;
    }
  }

  return errores;
}

/**
 * Corre `schemaFor(doc.tipo)` (Task 5, estructura/forma) y
 * {@link validateBusiness} (este módulo, coherencia de negocio) sobre `doc`,
 * y lanza un único `ValidationError` con TODOS los errores acumulados
 * (issues de zod primero, luego los de negocio) si hay al menos uno. No
 * lanza (retorna `void`) si `doc` es válido en ambos sentidos.
 */
export function assertValid(doc: Comprobante): void {
  const schemaResult = schemaFor(doc.tipo).safeParse(doc);
  const zodErrors = schemaResult.success ? [] : zodIssuesToErrors(schemaResult.error.issues);
  const businessErrors = validateBusiness(doc);
  const allErrors = [...zodErrors, ...businessErrors];

  if (allErrors.length > 0) {
    throw new ValidationError('Comprobante inválido', allErrors);
  }
}
