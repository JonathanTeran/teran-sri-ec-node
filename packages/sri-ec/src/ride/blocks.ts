import { Ambiente, TipoComprobante, TipoEmision } from '../catalogs/index.js';
import { FormaPago } from '../catalogs/forma-pago.js';
import type { Detalle, InfoTributaria, Pago, TotalImpuesto } from '../documents/index.js';
// `SriError` y las utilidades de `utils/money.ts` se importan por el nombre
// del propio paquete (auto-referencia, ver `tsup.config.ts` y la nota en
// `deps.ts`) en vez de `'../errors/index.js'`/`'../utils/money.js'`: este
// último también lanza `ValidationError` (subclase de `SriError`), así que
// bundlearlo localmente reintroduciría la misma duplicación de clase que
// esto corrige. Importar ambos desde `'sri-ec'` hace que el bundle de este
// subpath NO incluya ninguna copia propia de esas clases — `instanceof
// SriError`/`instanceof ValidationError` siguen siendo verdaderos para quien
// capture el error importando desde `'sri-ec'` (el core), incluso en CJS.
import { formatMonto, fromCents, SriError, toCents } from 'sri-ec';
import type { AreaRide, ComprobanteRide, CompradorRide, EmisorRide, TotalesRide } from './types.js';

/**
 * Bloques reutilizables del RIDE (los "Bloques obligatorios del RIDE" del
 * diseño original). Cada `draw*` recibe el `PDFDocument` de
 * pdfkit ya posicionado en `área.x`/`área.y`, dibuja su contenido y devuelve
 * el `y` del borde inferior de lo que dibujó — es el contrato completo que
 * Task 2 (`liquidacion-compra.ride.ts`, `nota-credito.ride.ts`, etc.)
 * consume para componer el resto de comprobantes sin reimplementar la
 * cabecera, el detalle, los totales ni las formas de pago.
 *
 * Deliberadamente NO conocen ningún tipo de `Comprobante`: reciben los tipos
 * normalizados de `types.ts` (`EmisorRide`, `ComprobanteRide`, etc.) o los
 * tipos ya compartidos de `documents/shared.ts` (`Detalle[]`, `Pago[]`), que
 * cada `*.ride.ts` arma a partir de su propio shape de documento.
 */

const FUENTE_NORMAL = 'Helvetica';
const FUENTE_NEGRITA = 'Helvetica-Bold';
const TAMANO_TITULO = 9;
const TAMANO_TEXTO = 8;
const TAMANO_TABLA = 7.5;
const COLOR_TEXTO = '#000000';
const COLOR_NO_AUTORIZADO = '#b00020';
const COLOR_ENCABEZADO_TABLA = '#e6e6e6';
const PADDING_CAJA = 6;
const PADDING_CELDA = 3;
const ESPACIO_LINEA = 2;

/** Código de impuesto (campo `codigo` de {@link TotalImpuesto}) para IVA, según el catálogo SRI. */
const CODIGO_IMPUESTO_IVA = '2';
/** Código de impuesto para ICE. */
const CODIGO_IMPUESTO_ICE = '3';

/**
 * Etiqueta de tarifa por `codigoPorcentaje` (catálogo SRI "Código Porcentaje").
 * Se usa para agrupar los subtotales de IVA en {@link drawTotales}; un código
 * sin entrada aquí se imprime tal cual (nunca se descarta un subtotal por
 * no tener etiqueta conocida).
 */
const LABEL_CODIGO_PORCENTAJE: Record<string, string> = {
  '0': '0%',
  '2': '12%',
  '3': '14%',
  '4': '15%',
  '5': '5%',
  '6': 'No objeto de IVA',
  '7': 'Exento de IVA',
  '8': 'IVA diferenciado',
  '10': '13%',
};

/** Etiqueta legible por código de forma de pago (catálogo SRI "Formas de Pago"), ver `catalogs/forma-pago.ts`. */
const LABEL_FORMA_PAGO: Record<string, string> = {
  [FormaPago.EFECTIVO]: 'Sin utilización del sistema financiero',
  [FormaPago.COMPENSACION_DEUDAS]: 'Compensación de deudas',
  [FormaPago.TARJETA_DEBITO]: 'Tarjeta de débito',
  [FormaPago.DINERO_ELECTRONICO]: 'Dinero electrónico',
  [FormaPago.TARJETA_PREPAGO]: 'Tarjeta prepago',
  [FormaPago.TARJETA_CREDITO]: 'Tarjeta de crédito',
  [FormaPago.OTROS_SISTEMA_FINANCIERO]: 'Otros con utilización del sistema financiero',
  [FormaPago.ENDOSO_TITULOS]: 'Endoso de títulos',
};

const LABEL_AMBIENTE: Record<Ambiente, string> = {
  [Ambiente.Pruebas]: 'PRUEBAS',
  [Ambiente.Produccion]: 'PRODUCCIÓN',
};

const LABEL_TIPO_EMISION: Record<TipoEmision, string> = {
  [TipoEmision.Normal]: 'NORMAL',
};

/** Nombre legible del comprobante ("FACTURA", "NOTA DE CRÉDITO", ...) a partir del `codDoc`. */
export function nombreDocumento(tipo: TipoComprobante): string {
  switch (tipo) {
    case TipoComprobante.Factura:
      return 'FACTURA';
    case TipoComprobante.LiquidacionCompra:
      return 'LIQUIDACIÓN DE COMPRA';
    case TipoComprobante.NotaCredito:
      return 'NOTA DE CRÉDITO';
    case TipoComprobante.NotaDebito:
      return 'NOTA DE DÉBITO';
    case TipoComprobante.GuiaRemision:
      return 'GUÍA DE REMISIÓN';
    case TipoComprobante.Retencion:
      return 'COMPROBANTE DE RETENCIÓN';
  }
}

/** `estab-ptoEmi-secuencial`, p.ej. `001-001-000000001` — el número de comprobante que exige el SRI en el RIDE. */
export function formatNumeroComprobante(info: Pick<InfoTributaria, 'estab' | 'ptoEmi' | 'secuencial'>): string {
  return `${info.estab}-${info.ptoEmi}-${info.secuencial}`;
}

/**
 * Si dibujar `alturaMinima` puntos más en `y` desbordaría la página, abre una
 * página nueva y devuelve el `y` de inicio (margen superior); si no, devuelve
 * `y` tal cual. Es el único mecanismo de paginación del motor — cada bloque
 * (y cada fila de {@link drawTablaDetalles}) lo usa antes de dibujar.
 */
export function asegurarEspacio(doc: PDFKit.PDFDocument, y: number, alturaMinima: number): number {
  const limite = doc.page.height - doc.page.margins.bottom;
  if (y + alturaMinima > limite) {
    doc.addPage();
    return doc.page.margins.top;
  }
  return y;
}

/** Marca el inicio del contenido interno de una "caja" con borde (ver {@link cerrarCaja}). */
function iniciarCaja(area: AreaRide): number {
  return area.y + PADDING_CAJA;
}

/** Dibuja el borde de la caja desde `área.y` hasta `y + PADDING_CAJA` y devuelve ese borde inferior. */
function cerrarCaja(doc: PDFKit.PDFDocument, area: AreaRide, y: number): number {
  const abajo = y + PADDING_CAJA;
  doc.lineWidth(0.75).strokeColor(COLOR_TEXTO).rect(area.x, area.y, area.width, abajo - area.y).stroke();
  return abajo;
}

/** Escribe una línea "etiqueta ... valor" (valor alineado a la derecha) y devuelve el `y` siguiente. */
function escribirLinea(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  etiqueta: string,
  valor: string,
  anchoValor = 75,
): number {
  doc.text(etiqueta, x, y, { width: width - anchoValor - ESPACIO_LINEA });
  doc.text(valor, x + width - anchoValor, y, { width: anchoValor, align: 'right' });
  return doc.y + ESPACIO_LINEA;
}

/**
 * Cabecera — emisor (columna izquierda del RIDE). Ver "Bloques obligatorios
 * del RIDE" en el plan: logo, razón social, nombre comercial, dirección
 * matriz, dirección del establecimiento, obligado a llevar contabilidad,
 * contribuyente especial, agente de retención, contribuyente RIMPE — todos
 * opcionales salvo razón social y dirección matriz, y solo se imprimen si
 * vienen en `emisor`.
 */
export function drawEmisor(doc: PDFKit.PDFDocument, emisor: EmisorRide, area: AreaRide): number {
  let y = iniciarCaja(area);
  const x = area.x + PADDING_CAJA;
  const width = area.width - PADDING_CAJA * 2;

  if (emisor.logo) {
    try {
      doc.image(Buffer.from(emisor.logo), x, y, { fit: [width, 50], align: 'center' });
    } catch {
      // pdfkit solo reconoce PNG/JPEG (lee la firma de bytes, no una extensión
      // de archivo) y ante cualquier otro formato o un buffer corrupto lanza
      // un `Error` genérico ("Unknown image format") sin `.code` — se envuelve
      // en un SriError con la causa probable y el remedio, igual que
      // `deps.ts` envuelve el fallo de `import()` de una dependencia opcional.
      throw new SriError(
        'El logo del emisor no se pudo procesar: formato no soportado o archivo corrupto. Usa PNG o JPG.',
        'RIDE_INVALID_LOGO',
      );
    }
    y += 54;
  }

  doc.font(FUENTE_NEGRITA).fontSize(TAMANO_TITULO).fillColor(COLOR_TEXTO);
  doc.text(emisor.razonSocial, x, y, { width });
  y = doc.y + ESPACIO_LINEA;

  doc.font(FUENTE_NORMAL).fontSize(TAMANO_TEXTO);

  if (emisor.nombreComercial) {
    doc.text(`Nombre Comercial: ${emisor.nombreComercial}`, x, y, { width });
    y = doc.y + ESPACIO_LINEA;
  }

  doc.text(`Dirección Matriz: ${emisor.dirMatriz}`, x, y, { width });
  y = doc.y + ESPACIO_LINEA;

  if (emisor.dirEstablecimiento) {
    doc.text(`Dirección Establecimiento: ${emisor.dirEstablecimiento}`, x, y, { width });
    y = doc.y + ESPACIO_LINEA;
  }

  if (emisor.obligadoContabilidad) {
    doc.text(`Obligado a Llevar Contabilidad: ${emisor.obligadoContabilidad}`, x, y, { width });
    y = doc.y + ESPACIO_LINEA;
  }

  if (emisor.contribuyenteEspecial) {
    doc.text(`Contribuyente Especial Nro: ${emisor.contribuyenteEspecial}`, x, y, { width });
    y = doc.y + ESPACIO_LINEA;
  }

  if (emisor.agenteRetencion) {
    doc.text(`Agente de Retención: ${emisor.agenteRetencion}`, x, y, { width });
    y = doc.y + ESPACIO_LINEA;
  }

  if (emisor.contribuyenteRimpe) {
    doc.text(`Contribuyente RIMPE: ${emisor.contribuyenteRimpe}`, x, y, { width });
    y = doc.y + ESPACIO_LINEA;
  }

  return cerrarCaja(doc, area, y);
}

/**
 * Cabecera — comprobante (columna derecha del RIDE): R.U.C., nombre del
 * documento, número, autorización, ambiente, emisión, clave de acceso y su
 * QR. Si `comprobante.autorizacion` no viene, el bloque se dibuja igual pero
 * marcado visiblemente como "COMPROBANTE NO AUTORIZADO" (el SRI autoriza de
 * forma asíncrona; el RIDE suele imprimirse antes de recibir la respuesta).
 *
 * `qr` es el PNG ya generado (ver `qr.ts`): este bloque no genera el QR ni
 * conoce `qrcode` — mantenerlo síncrono es lo que permite que los 7 `draw*`
 * de este módulo tengan la misma forma de firma.
 */
export function drawComprobante(
  doc: PDFKit.PDFDocument,
  comprobante: ComprobanteRide,
  area: AreaRide,
  qr?: Buffer,
): number {
  const cajaX = area.x + PADDING_CAJA;
  const cajaAncho = area.width - PADDING_CAJA * 2;
  const qrLado = 85;
  const anchoTexto = qr ? cajaAncho - qrLado - PADDING_CELDA : cajaAncho;

  let y = iniciarCaja(area);

  doc.font(FUENTE_NEGRITA).fontSize(TAMANO_TEXTO).fillColor(COLOR_TEXTO);
  doc.text(`R.U.C.: ${comprobante.ruc}`, cajaX, y, { width: anchoTexto });
  y = doc.y + ESPACIO_LINEA;

  // Reduce el tamaño hasta que el nombre del documento quepa en una sola
  // línea dentro de `anchoTexto` (gap de Task 2, expuesto por los nombres
  // largos de los 5 comprobantes nuevos: "LIQUIDACIÓN DE COMPRA" y
  // "COMPROBANTE DE RETENCIÓN" no caben al tamaño fijo de 11pt en la columna
  // angosta que queda junto al QR — pdfkit los envolvía a dos líneas,
  // partiendo el título a la mitad). `nombreDocumento` corto (p.ej.
  // "FACTURA") nunca dispara el bucle: ya cabe al tamaño máximo.
  const TAMANO_NOMBRE_DOC_MAX = TAMANO_TITULO + 2;
  let tamanoNombreDoc = TAMANO_NOMBRE_DOC_MAX;
  doc.fontSize(tamanoNombreDoc);
  while (doc.widthOfString(comprobante.nombreDocumento) > anchoTexto && tamanoNombreDoc > TAMANO_TEXTO) {
    tamanoNombreDoc -= 0.5;
    doc.fontSize(tamanoNombreDoc);
  }
  doc.text(comprobante.nombreDocumento, cajaX, y, { width: anchoTexto });
  y = doc.y + ESPACIO_LINEA;

  doc.font(FUENTE_NORMAL).fontSize(TAMANO_TEXTO);
  doc.text(`No. ${comprobante.numero}`, cajaX, y, { width: anchoTexto });
  y = doc.y + ESPACIO_LINEA;

  if (comprobante.autorizacion) {
    doc.text(`Número de Autorización: ${comprobante.autorizacion.numero}`, cajaX, y, { width: anchoTexto });
    y = doc.y + ESPACIO_LINEA;
    doc.text(`Fecha y Hora de Autorización: ${comprobante.autorizacion.fecha}`, cajaX, y, { width: anchoTexto });
    y = doc.y + ESPACIO_LINEA;
  } else {
    doc.font(FUENTE_NEGRITA).fillColor(COLOR_NO_AUTORIZADO);
    doc.text('COMPROBANTE NO AUTORIZADO', cajaX, y, { width: anchoTexto });
    doc.font(FUENTE_NORMAL).fillColor(COLOR_TEXTO);
    y = doc.y + ESPACIO_LINEA;
  }

  doc.text(`Ambiente: ${LABEL_AMBIENTE[comprobante.ambiente]}`, cajaX, y, { width: anchoTexto });
  y = doc.y + ESPACIO_LINEA;

  doc.text(`Emisión: ${LABEL_TIPO_EMISION[comprobante.tipoEmision]}`, cajaX, y, { width: anchoTexto });
  y = doc.y + ESPACIO_LINEA;

  // El QR se dibuja junto a la columna de texto de arriba; la clave de
  // acceso (49 dígitos, sin espacios donde pdfkit pueda partir la línea) se
  // imprime debajo de ambos, a todo el ancho de la caja — así nunca compite
  // por espacio horizontal con el QR y no hay riesgo de que se corte.
  if (qr) {
    const qrX = cajaX + cajaAncho - qrLado;
    const qrY = iniciarCaja(area);
    doc.image(qr, qrX, qrY, { width: qrLado, height: qrLado });
    y = Math.max(y, qrY + qrLado + ESPACIO_LINEA);
  }

  doc.font(FUENTE_NORMAL).fontSize(TAMANO_TEXTO);
  doc.text('Clave de Acceso:', cajaX, y, { width: cajaAncho });
  y = doc.y;
  doc.fontSize(TAMANO_TABLA);
  doc.text(comprobante.claveAcceso, cajaX, y, { width: cajaAncho });
  y = doc.y + ESPACIO_LINEA;

  return cerrarCaja(doc, area, y);
}

/**
 * Bloque comprador: razón social o nombres, identificación, fecha de
 * emisión, dirección y guía de remisión (los últimos dos, si existen).
 * `etiquetaSujeto` es lo que Task 2 cambia para reutilizar este mismo bloque
 * como "Proveedor" (liquidación de compra), "Sujeto Retenido" (retención) o
 * "Destinatario" (guía de remisión).
 */
export function drawComprador(doc: PDFKit.PDFDocument, comprador: CompradorRide, area: AreaRide): number {
  let y = iniciarCaja(area);
  const x = area.x + PADDING_CAJA;
  const width = area.width - PADDING_CAJA * 2;
  const etiqueta = comprador.etiquetaSujeto ?? 'Comprador';

  doc.font(FUENTE_NEGRITA).fontSize(TAMANO_TITULO).fillColor(COLOR_TEXTO);
  doc.text(etiqueta.toUpperCase(), x, y, { width });
  y = doc.y + ESPACIO_LINEA;

  doc.font(FUENTE_NORMAL).fontSize(TAMANO_TEXTO);
  doc.text(`Razón Social / Nombres: ${comprador.razonSocial}`, x, y, { width });
  y = doc.y + ESPACIO_LINEA;

  doc.text(`Identificación: ${comprador.identificacion}`, x, y, { width });
  y = doc.y + ESPACIO_LINEA;

  doc.text(`Fecha Emisión: ${comprador.fechaEmision}`, x, y, { width });
  y = doc.y + ESPACIO_LINEA;

  if (comprador.direccion) {
    doc.text(`Dirección: ${comprador.direccion}`, x, y, { width });
    y = doc.y + ESPACIO_LINEA;
  }

  if (comprador.guiaRemision) {
    doc.text(`Guía de Remisión: ${comprador.guiaRemision}`, x, y, { width });
    y = doc.y + ESPACIO_LINEA;
  }

  return cerrarCaja(doc, area, y);
}

export interface ColumnaTabla {
  header: string;
  width: number;
  align: 'left' | 'right';
}

/**
 * Reparte `anchoTotal` entre columnas según las fracciones de `specs`; la
 * última columna absorbe el redondeo. Extraído de lo que hasta Task 1 era
 * `construirColumnasDetalle` (privado, solo para las 7 columnas del
 * detalle) — ahora es el punto de reuso explícito que Task 2 consume para
 * armar las tablas propias de nota de débito (motivos), guía de remisión
 * (detalle de destinatario) y retención (documentos sustento) sin repetir
 * el cálculo de anchos por cada tipo.
 */
export function construirColumnas(
  anchoTotal: number,
  specs: Array<[string, number, 'left' | 'right']>,
): ColumnaTabla[] {
  const widths = specs.map(([, frac]) => Math.floor(anchoTotal * frac));
  const usado = widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1] += anchoTotal - usado;
  return specs.map(([header, , align], i) => ({ header, width: widths[i], align }));
}

/**
 * Columnas fijas del detalle de factura/liquidación de compra/nota de
 * crédito. `Cant.`: 0.085 (no 0.07, hallazgo confirmado del reviewer) — con
 * 0.07 el ancho útil de la columna en A4 (usable ≈ 30pt a `TAMANO_TABLA`)
 * era menor que `999999.99` (el máximo realista con 2 decimales, ≈ 35.4pt),
 * así que un `Detalle` con esa cantidad partía el número a la mitad entre
 * dos líneas ("999999." / "99") — inaceptable en un documento fiscal, donde
 * confundir el valor invita a un error de lectura. Se compensa restando
 * 0.015 a `Descripción` (la columna con más margen de sobra: ancho de wrap
 * variable por diseño, no un valor fijo que se pueda partir mal).
 */
const DETALLE_COLUMN_SPECS: Array<[string, number, 'left' | 'right']> = [
  ['Cód. Principal', 0.13, 'left'],
  ['Cód. Auxiliar', 0.11, 'left'],
  ['Cant.', 0.085, 'right'],
  ['Descripción', 0.325, 'left'],
  ['P. Unitario', 0.12, 'right'],
  ['Descuento', 0.1, 'right'],
  ['P. Total', 0.13, 'right'],
];

/** Celdas de una fila de detalle, en el mismo orden que {@link DETALLE_COLUMN_SPECS}. */
function celdasDetalle(d: Detalle): string[] {
  const extras = d.detallesAdicionales
    ? `\n${Object.entries(d.detallesAdicionales)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')}`
    : '';
  return [
    d.codigoPrincipal ?? '',
    d.codigoAuxiliar ?? '',
    formatMonto(d.cantidad, 2),
    `${d.descripcion}${extras}`,
    formatMonto(d.precioUnitario, 2),
    formatMonto(d.descuento, 2),
    formatMonto(d.precioTotalSinImpuesto, 2),
  ];
}

/** Altura que ocupará la fila (la celda más alta, según el wrap de cada columna) más el padding de celda. */
function alturaFilaTabla(doc: PDFKit.PDFDocument, columnas: ColumnaTabla[], celdas: string[]): number {
  const alturas = columnas.map((col, i) => doc.heightOfString(celdas[i], { width: col.width - PADDING_CELDA * 2 }));
  return Math.max(...alturas) + PADDING_CELDA * 2;
}

/** Dibuja una fila (encabezado o dato) con sus bordes y devuelve el `y` de su borde inferior. */
function dibujarFilaTabla(
  doc: PDFKit.PDFDocument,
  columnas: ColumnaTabla[],
  celdas: string[],
  x: number,
  y: number,
  esEncabezado: boolean,
): number {
  doc.font(esEncabezado ? FUENTE_NEGRITA : FUENTE_NORMAL).fontSize(TAMANO_TABLA);
  const alto = alturaFilaTabla(doc, columnas, celdas);
  const anchoTotal = columnas.reduce((s, c) => s + c.width, 0);

  if (esEncabezado) {
    doc.rect(x, y, anchoTotal, alto).fillAndStroke(COLOR_ENCABEZADO_TABLA, COLOR_TEXTO);
    doc.fillColor(COLOR_TEXTO);
  }

  let cx = x;
  for (let i = 0; i < columnas.length; i++) {
    doc.text(celdas[i], cx + PADDING_CELDA, y + PADDING_CELDA, {
      width: columnas[i].width - PADDING_CELDA * 2,
      align: columnas[i].align,
    });
    cx += columnas[i].width;
  }

  doc.lineWidth(0.5).strokeColor(COLOR_TEXTO);
  if (!esEncabezado) {
    doc.rect(x, y, anchoTotal, alto).stroke();
  }
  cx = x;
  for (const col of columnas.slice(0, -1)) {
    cx += col.width;
    doc.moveTo(cx, y).lineTo(cx, y + alto).stroke();
  }

  return y + alto;
}

/**
 * Tabla genérica: encabezado + filas de celdas ya formateadas (strings), con
 * paginación fila a fila (repite el encabezado al saltar de página, ver
 * {@link asegurarEspacio}). Es el motor que {@link drawTablaDetalles} usa
 * para las 7 columnas fijas del detalle, y el punto de reuso explícito para
 * Task 2: la tabla de motivos (nota de débito), la de detalle de
 * destinatario (guía de remisión) y la de documentos sustento (retención)
 * tienen columnas completamente distintas al detalle — arman su propio
 * `ColumnaTabla[]`/`string[][]` con {@link construirColumnas} y llaman a
 * esta función en vez de reimplementar bordes/paginación por cada tipo.
 */
export function drawTablaGenerica(
  doc: PDFKit.PDFDocument,
  columnas: ColumnaTabla[],
  filas: string[][],
  area: AreaRide,
): number {
  const encabezados = columnas.map((c) => c.header);
  let y = area.y;
  y = dibujarFilaTabla(doc, columnas, encabezados, area.x, y, true);

  for (const fila of filas) {
    doc.font(FUENTE_NORMAL).fontSize(TAMANO_TABLA);
    const alto = alturaFilaTabla(doc, columnas, fila);

    const paginasAntes = doc.bufferedPageRange().count;
    y = asegurarEspacio(doc, y, alto);
    if (doc.bufferedPageRange().count > paginasAntes) {
      // asegurarEspacio saltó de página: redibuja el encabezado antes de la fila.
      y = dibujarFilaTabla(doc, columnas, encabezados, area.x, y, true);
    }

    y = dibujarFilaTabla(doc, columnas, fila, area.x, y, false);
  }

  return y;
}

/**
 * Tabla de detalle: código principal, código auxiliar, cantidad,
 * descripción (con los `detallesAdicionales` como líneas extra bajo la
 * descripción), precio unitario, descuento y precio total. Delgado sobre
 * {@link drawTablaGenerica}: solo arma las 7 columnas fijas
 * ({@link DETALLE_COLUMN_SPECS}) y mapea cada {@link Detalle} a sus celdas
 * — el mecanismo de paginación vive en `drawTablaGenerica`, compartido con
 * las demás tablas de Task 2.
 */
export function drawTablaDetalles(doc: PDFKit.PDFDocument, detalles: Detalle[], area: AreaRide): number {
  const columnas = construirColumnas(area.width, DETALLE_COLUMN_SPECS);
  const filas = detalles.map(celdasDetalle);
  return drawTablaGenerica(doc, columnas, filas, area);
}

/** Agrupa los impuestos con `codigo` IVA por `codigoPorcentaje`, sumando `baseImponible` en centavos (nunca en float). */
function subtotalesIva(impuestos: TotalImpuesto[]): Array<{ etiqueta: string; base: string }> {
  const grupos = new Map<string, number>();
  for (const imp of impuestos) {
    if (imp.codigo !== CODIGO_IMPUESTO_IVA) continue;
    grupos.set(imp.codigoPorcentaje, (grupos.get(imp.codigoPorcentaje) ?? 0) + toCents(imp.baseImponible));
  }
  return [...grupos.entries()].map(([codigoPorcentaje, cents]) => ({
    etiqueta: `Subtotal ${LABEL_CODIGO_PORCENTAJE[codigoPorcentaje] ?? codigoPorcentaje}`,
    base: fromCents(cents),
  }));
}

/** Suma en centavos el `valor` de los impuestos que coinciden con `codigo` (p.ej. ICE o IVA). */
function sumarValorPorCodigo(impuestos: TotalImpuesto[], codigo: string): number {
  return impuestos.filter((imp) => imp.codigo === codigo).reduce((acc, imp) => acc + toCents(imp.valor), 0);
}

/**
 * Bloque totales: subtotales por tarifa de IVA, subtotal sin impuestos,
 * total descuento (si viene — `NotaCredito`/`NotaDebito` no lo modelan),
 * ICE (si aplica), IVA, propina (si viene) y valor total. Toda la suma de
 * impuestos usa `toCents`/`fromCents` — nunca aritmética de punto flotante
 * sobre los montos.
 */
export function drawTotales(doc: PDFKit.PDFDocument, totales: TotalesRide, area: AreaRide): number {
  let y = iniciarCaja(area);
  const x = area.x + PADDING_CAJA;
  const width = area.width - PADDING_CAJA * 2;

  doc.font(FUENTE_NEGRITA).fontSize(TAMANO_TITULO).fillColor(COLOR_TEXTO);
  doc.text('TOTALES', x, y, { width });
  y = doc.y + ESPACIO_LINEA;

  doc.font(FUENTE_NORMAL).fontSize(TAMANO_TEXTO);

  for (const subtotal of subtotalesIva(totales.impuestos)) {
    y = escribirLinea(doc, x, y, width, subtotal.etiqueta, formatMonto(subtotal.base, 2));
  }

  y = escribirLinea(doc, x, y, width, 'Subtotal sin impuestos', formatMonto(totales.totalSinImpuestos, 2));

  if (totales.totalDescuento !== undefined) {
    y = escribirLinea(doc, x, y, width, 'Total descuento', formatMonto(totales.totalDescuento, 2));
  }

  const ice = sumarValorPorCodigo(totales.impuestos, CODIGO_IMPUESTO_ICE);
  if (ice > 0) {
    y = escribirLinea(doc, x, y, width, 'ICE', fromCents(ice));
  }

  const iva = sumarValorPorCodigo(totales.impuestos, CODIGO_IMPUESTO_IVA);
  y = escribirLinea(doc, x, y, width, 'IVA', fromCents(iva));

  if (totales.propina) {
    y = escribirLinea(doc, x, y, width, 'Propina', formatMonto(totales.propina, 2));
  }

  doc.font(FUENTE_NEGRITA);
  y = escribirLinea(doc, x, y, width, 'VALOR TOTAL', formatMonto(totales.importeTotal, 2));
  doc.font(FUENTE_NORMAL);

  return cerrarCaja(doc, area, y);
}

/** Bloque formas de pago: forma de pago, valor, plazo y unidad de tiempo (los últimos dos, si vienen). */
export function drawFormasPago(doc: PDFKit.PDFDocument, pagos: Pago[], area: AreaRide): number {
  let y = iniciarCaja(area);
  const x = area.x + PADDING_CAJA;
  const width = area.width - PADDING_CAJA * 2;

  doc.font(FUENTE_NEGRITA).fontSize(TAMANO_TITULO).fillColor(COLOR_TEXTO);
  doc.text('FORMAS DE PAGO', x, y, { width });
  y = doc.y + ESPACIO_LINEA;

  doc.font(FUENTE_NORMAL).fontSize(TAMANO_TEXTO);
  for (const pago of pagos) {
    const partes = [LABEL_FORMA_PAGO[pago.formaPago] ?? pago.formaPago, formatMonto(pago.total, 2)];
    if (pago.plazo) partes.push(`Plazo: ${pago.plazo}`);
    if (pago.unidadTiempo) partes.push(`Unidad de Tiempo: ${pago.unidadTiempo}`);
    doc.text(partes.join('   —   '), x, y, { width });
    y = doc.y + ESPACIO_LINEA;
  }

  return cerrarCaja(doc, area, y);
}

/**
 * Bloque información adicional: los `campoAdicional` del documento
 * (`infoAdicional` en los tipos de `documents/`). Si no hay ninguno, no
 * dibuja nada (ni siquiera la caja vacía) y devuelve `área.y` sin cambios.
 */
export function drawInfoAdicional(
  doc: PDFKit.PDFDocument,
  infoAdicional: Record<string, string> | undefined,
  area: AreaRide,
): number {
  const entradas = infoAdicional ? Object.entries(infoAdicional) : [];
  if (entradas.length === 0) {
    return area.y;
  }

  let y = iniciarCaja(area);
  const x = area.x + PADDING_CAJA;
  const width = area.width - PADDING_CAJA * 2;

  doc.font(FUENTE_NEGRITA).fontSize(TAMANO_TITULO).fillColor(COLOR_TEXTO);
  doc.text('INFORMACIÓN ADICIONAL', x, y, { width });
  y = doc.y + ESPACIO_LINEA;

  doc.font(FUENTE_NORMAL).fontSize(TAMANO_TEXTO);
  for (const [clave, valor] of entradas) {
    doc.text(`${clave}: ${valor}`, x, y, { width });
    y = doc.y + ESPACIO_LINEA;
  }

  return cerrarCaja(doc, area, y);
}

/**
 * Bloque genérico: título en negrita + líneas de texto simple, en una caja
 * con borde — mismo estilo visual que el resto de bloques (`drawEmisor`,
 * `drawTotales`, etc., vía `iniciarCaja`/`cerrarCaja`). Punto de reuso
 * explícito para Task 2: cada `*.ride.ts` arma sus propias líneas para los
 * "extras por tipo" que no son bloques compartidos (comprobante que
 * modifica + motivo en nota de crédito; transportista y datos de traslado
 * en guía de remisión; período fiscal y total retenido en retención) sin
 * reimplementar el patrón de caja con título + líneas por cada tipo.
 */
export function drawBloqueTexto(doc: PDFKit.PDFDocument, titulo: string, lineas: string[], area: AreaRide): number {
  let y = iniciarCaja(area);
  const x = area.x + PADDING_CAJA;
  const width = area.width - PADDING_CAJA * 2;

  doc.font(FUENTE_NEGRITA).fontSize(TAMANO_TITULO).fillColor(COLOR_TEXTO);
  doc.text(titulo, x, y, { width });
  y = doc.y + ESPACIO_LINEA;

  doc.font(FUENTE_NORMAL).fontSize(TAMANO_TEXTO);
  for (const linea of lineas) {
    doc.text(linea, x, y, { width });
    y = doc.y + ESPACIO_LINEA;
  }

  return cerrarCaja(doc, area, y);
}
