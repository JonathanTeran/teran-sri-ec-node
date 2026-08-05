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
/** Código de impuesto para IRBPNR (Impuesto Redimible a las Botellas Plásticas No Retornables). */
const CODIGO_IMPUESTO_IRBPNR = '5';

/**
 * Etiqueta por `codigo` de impuesto (campo `codigo` de {@link TotalImpuesto},
 * catálogo SRI "Código de impuesto" — NO confundir con `codigoPorcentaje`,
 * que es la tarifa dentro de un mismo impuesto). Solo cubre los códigos que
 * IVA/ICE no imprimen con su propia línea fija en {@link lineasTotales}
 * (auditoría "campos fiscales omitidos", hallazgo 3: un `totalConImpuestos`
 * con un código que no fuera IVA/ICE —p.ej. IRBPNR— se descartaba entero sin
 * dejar rastro, así que el lector no podía reconciliar `importeTotal`). Un
 * código sin entrada aquí NUNCA se descarta: se imprime con una etiqueta
 * genérica que incluye el código crudo.
 */
const LABEL_IMPUESTO: Record<string, string> = {
  [CODIGO_IMPUESTO_IRBPNR]: 'IRBPNR',
};

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

/**
 * Nombre legible en Sentence case por `codDoc` CRUDO (`string`, no
 * `TipoComprobante`) — para el bloque "Comprobante que Modifica" de nota de
 * crédito y nota de débito (`codDocModificado`), donde el código viene tal
 * cual del documento y podría en teoría no ser uno de los 6 códigos válidos,
 * así que no se puede reusar {@link nombreDocumento} (que exige un
 * `TipoComprobante` y no tiene rama `default`: lanzaría en tiempo de
 * ejecución ante un código desconocido). Con fallback al código crudo — nunca
 * se descarta la línea por no reconocer el código.
 *
 * Compartido entre `nota-credito.ride.ts` y `nota-debito.ride.ts` (auditoría
 * "campos fiscales omitidos", hallazgo 2: antes solo existía dentro de
 * `nota-credito.ride.ts`, así que nota de débito no tenía de dónde tomarlo
 * para su propio bloque "Comprobante que Modifica").
 */
export function nombreDocumentoPorCodigo(codDoc: string): string {
  return NOMBRE_POR_COD_DOC[codDoc] ?? codDoc;
}

const NOMBRE_POR_COD_DOC: Record<string, string> = {
  [TipoComprobante.Factura]: 'Factura',
  [TipoComprobante.LiquidacionCompra]: 'Liquidación de Compra',
  [TipoComprobante.NotaCredito]: 'Nota de Crédito',
  [TipoComprobante.NotaDebito]: 'Nota de Débito',
  [TipoComprobante.GuiaRemision]: 'Guía de Remisión',
  [TipoComprobante.Retencion]: 'Comprobante de Retención',
};

/**
 * Etiqueta legible por código del catálogo SRI "Tipos de Identificación"
 * (`04` RUC, `05` Cédula, `06` Pasaporte, `07` Consumidor Final, `08`
 * Identificación del Exterior) — se imprime junto al número de
 * identificación en `drawComprador` cuando `CompradorRide.tipoIdentificacion`
 * viene. Con fallback al código crudo, igual que {@link LABEL_FORMA_PAGO}.
 */
const LABEL_TIPO_IDENTIFICACION: Record<string, string> = {
  '04': 'RUC',
  '05': 'Cédula de Identidad',
  '06': 'Pasaporte',
  '07': 'Consumidor Final',
  '08': 'Identificación del Exterior',
};

/**
 * Etiqueta legible por código de forma de pago (catálogo SRI "Formas de
 * Pago"). Punto de reuso explícito para `retencion.ride.ts`
 * (`DocSustento.pagos[].formaPago`, shape `PagoSustentoRow` — distinto del
 * `Pago` compartido, pero mismo catálogo de códigos) sin duplicar
 * {@link LABEL_FORMA_PAGO}.
 */
export function formaPagoLabel(codigo: string): string {
  return LABEL_FORMA_PAGO[codigo] ?? codigo;
}

/** `estab-ptoEmi-secuencial`, p.ej. `001-001-000000001` — el número de comprobante que exige el SRI en el RIDE. */
export function formatNumeroComprobante(info: Pick<InfoTributaria, 'estab' | 'ptoEmi' | 'secuencial'>): string {
  return `${info.estab}-${info.ptoEmi}-${info.secuencial}`;
}

/**
 * Si dibujar `alturaMinima` puntos más en `y` desbordaría la página, abre una
 * página nueva y devuelve el `y` de inicio (margen superior); si no, devuelve
 * `y` tal cual.
 *
 * `alturaMinima` DEBE ser el alto real del bloque que se va a dibujar
 * (`medirEmisor`, `medirTotales`, ... — nunca una constante adivinada): el
 * motor es "medir y después dibujar", y una reserva menor que el bloque real
 * era la causa raíz de que las cajas cruzaran de página. Ver
 * {@link dibujarCaja}.
 */
export function asegurarEspacio(doc: PDFKit.PDFDocument, y: number, alturaMinima: number): number {
  if (y + alturaMinima > limiteInferior(doc)) {
    doc.addPage();
    return doc.page.margins.top;
  }
  return y;
}

/** `y` máximo en el que se puede dibujar sin invadir el margen inferior de la página actual. */
function limiteInferior(doc: PDFKit.PDFDocument): number {
  return doc.page.height - doc.page.margins.bottom;
}

/** Alto útil de una página (entre el margen superior y el inferior). */
function alturaUtilPagina(doc: PDFKit.PDFDocument): number {
  return doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
}

/**
 * `true` si `v` tiene contenido real (no `undefined`, no vacío, no solo
 * espacios). Guarda contra imprimir una etiqueta sin su valor —`Razón
 * Social / Nombres:` sola, un `:` suelto en INFORMACIÓN ADICIONAL— que la
 * auditoría "campos fiscales omitidos" señaló como peor que omitir la línea
 * entera: parece un dato faltante del documento en vez de uno ausente en la
 * fuente.
 */
function noVacio(v: string | undefined): v is string {
  return v !== undefined && v.trim() !== '';
}

/**
 * `doc.text` con la paginación implícita de pdfkit DESACTIVADA.
 *
 * El `LineWrapper` de pdfkit, cuando una línea pasaría de `page.maxY()`,
 * llama solo a `continueOnNewPage()` — sin avisar a quien está dibujando. Eso
 * es lo que partía las cajas del RIDE: el bloque escribía su contenido, la
 * última línea saltaba de página por su cuenta y el borde se dibujaba después
 * con el `y` de la página nueva contra el `y` de la vieja (rectángulo de alto
 * NEGATIVO en la página equivocada, y la página anterior sin borde).
 *
 * Pasar `height` hace que `LineWrapper` use `startY + height` como `maxY` en
 * vez del final de la página; con `Infinity` ese límite no se alcanza nunca y
 * `continueOnNewPage()` no se llega a llamar. Es exactamente lo que hace
 * `doc.heightOfString` internamente, así que lo medido y lo dibujado coinciden
 * al punto. La paginación pasa a ser responsabilidad exclusiva —y explícita—
 * de {@link asegurarEspacio}, {@link dibujarCaja} y {@link drawTablaGenerica}.
 */
function escribirTexto(
  doc: PDFKit.PDFDocument,
  texto: string,
  x: number,
  y: number,
  opciones: PDFKit.Mixins.TextOptions,
): void {
  doc.text(texto, x, y, { ...opciones, height: Infinity });
}

/**
 * Parte `texto` en trozos que quepan en `altoMax` puntos al ancho `ancho`,
 * cortando solo por espacios/saltos de línea (nunca a mitad de palabra: en un
 * documento fiscal, partir un número o un código invita a leerlo mal). Solo
 * se usa para contenido que NO cabe entero en una página — la alternativa era
 * dejarlo desbordar el papel o perderlo.
 */
function partirTextoPorAltura(doc: PDFKit.PDFDocument, texto: string, ancho: number, altoMax: number): string[] {
  if (texto === '' || doc.heightOfString(texto, { width: ancho }) <= altoMax) {
    return [texto];
  }

  const trozos: string[] = [];
  let actual = '';
  for (const token of texto.split(/(\s+)/)) {
    const candidato = actual + token;
    if (actual.trim() !== '' && doc.heightOfString(candidato, { width: ancho }) > altoMax) {
      trozos.push(actual.replace(/\s+$/, ''));
      actual = token.replace(/^\s+/, '');
    } else {
      actual = candidato;
    }
  }
  if (actual.trim() !== '') {
    trozos.push(actual);
  }
  return trozos.length > 0 ? trozos : [texto];
}

/** Dibuja el borde de una caja. `alto` siempre es positivo: lo garantiza {@link dibujarCaja}. */
function dibujarBordeCaja(doc: PDFKit.PDFDocument, x: number, y: number, ancho: number, alto: number): void {
  doc.lineWidth(0.75).strokeColor(COLOR_TEXTO).rect(x, y, ancho, alto).stroke();
}

/** Ancho por defecto de la columna del valor en una línea "etiqueta ... valor". */
const ANCHO_VALOR = 75;

/**
 * Una línea del contenido de una caja con borde. `texto` y `valor` (si viene)
 * son UNA sola unidad indivisible: se dibujan en el mismo `y` y el avance es
 * el máximo de los dos altos — antes eran dos `doc.text` independientes, así
 * que una etiqueta que envolvía a dos líneas quedaba pisada por la fila
 * siguiente, y una etiqueta que provocaba salto de página dejaba su importe
 * en la página siguiente ("VALOR TOTAL" solo en una página, "112.00" en otra).
 */
interface LineaCaja {
  texto: string;
  /** Si viene, se imprime alineado a la derecha, en la MISMA línea que `texto`. */
  valor?: string;
  anchoValor?: number;
  /** Ancho de envoltura; por defecto, el ancho útil de la caja. */
  ancho?: number;
  negrita?: boolean;
  tamano?: number;
  color?: string;
  /** Hueco vertical de alto fijo: no imprime nada ni añade `ESPACIO_LINEA`. */
  espaciador?: number;
}

/** Deja `doc` con la fuente/tamaño/color de `linea`. */
function aplicarFuente(doc: PDFKit.PDFDocument, linea: LineaCaja): void {
  doc
    .font(linea.negrita ? FUENTE_NEGRITA : FUENTE_NORMAL)
    .fontSize(linea.tamano ?? TAMANO_TEXTO)
    .fillColor(linea.color ?? COLOR_TEXTO);
}

/** Alto de `linea` sin contar el `ESPACIO_LINEA` que la separa de la siguiente. */
function alturaLinea(doc: PDFKit.PDFDocument, linea: LineaCaja, anchoCaja: number): number {
  if (linea.espaciador !== undefined) {
    return linea.espaciador;
  }
  aplicarFuente(doc, linea);
  const ancho = linea.ancho ?? anchoCaja;
  if (linea.valor === undefined) {
    return doc.heightOfString(linea.texto, { width: ancho });
  }
  const anchoValor = linea.anchoValor ?? ANCHO_VALOR;
  return Math.max(
    doc.heightOfString(linea.texto, { width: ancho - anchoValor - ESPACIO_LINEA }),
    doc.heightOfString(linea.valor, { width: anchoValor }),
  );
}

/** Avance vertical total de `linea` (alto + separación con la siguiente). */
function avanceLinea(doc: PDFKit.PDFDocument, linea: LineaCaja, anchoCaja: number): number {
  return alturaLinea(doc, linea, anchoCaja) + (linea.espaciador !== undefined ? 0 : ESPACIO_LINEA);
}

/** Dibuja `linea` en `(x, y)`. No toca el `y` del llamador: el avance lo controla {@link dibujarCaja}. */
function dibujarLinea(doc: PDFKit.PDFDocument, linea: LineaCaja, x: number, y: number, anchoCaja: number): void {
  if (linea.espaciador !== undefined) {
    return;
  }
  aplicarFuente(doc, linea);
  const ancho = linea.ancho ?? anchoCaja;
  if (linea.valor === undefined) {
    escribirTexto(doc, linea.texto, x, y, { width: ancho });
    return;
  }
  const anchoValor = linea.anchoValor ?? ANCHO_VALOR;
  escribirTexto(doc, linea.texto, x, y, { width: ancho - anchoValor - ESPACIO_LINEA });
  escribirTexto(doc, linea.valor, x + ancho - anchoValor, y, { width: anchoValor, align: 'right' });
}

/** Opciones de composición de una caja con borde. */
interface OpcionesCaja {
  /**
   * Título del bloque. Si la caja no cabe en una página se cierra el borde,
   * se abre una página nueva y se reimprime como "<título> (continuación)".
   */
  titulo?: string;
  /** Alto reservado al principio del contenido para `dibujarExtra` (p.ej. el logo del emisor). */
  alturaExtra?: number;
  /** Pinta contenido no textual al principio de la caja (logo, QR). */
  dibujarExtra?: (x: number, y: number, anchoCaja: number) => void;
}

/** Línea de continuación que encabeza la caja al saltar de página. */
function lineaContinuacion(titulo: string): LineaCaja {
  return { texto: `${titulo} (continuación)`, negrita: true, tamano: TAMANO_TITULO };
}

/**
 * Alto total (borde a borde) que ocuparán `lineas` en una caja de ancho
 * `anchoArea`. Es la medida que los `*.ride.ts` pasan a
 * {@link asegurarEspacio} ANTES de dibujar.
 */
function medirCaja(
  doc: PDFKit.PDFDocument,
  lineas: LineaCaja[],
  anchoArea: number,
  alturaExtra = 0,
): number {
  const anchoCaja = anchoArea - PADDING_CAJA * 2;
  let alto = PADDING_CAJA * 2 + alturaExtra;
  for (const linea of lineas) {
    alto += avanceLinea(doc, linea, anchoCaja);
  }
  return alto;
}

/**
 * Dibuja una caja con borde: mide cada línea, la escribe con la paginación
 * implícita de pdfkit desactivada ({@link escribirTexto}) y cierra el borde
 * con un alto que SIEMPRE es positivo y en la misma página en la que lo
 * abrió.
 *
 * Si el contenido no cabe entero (una `infoAdicional` larguísima, muchas
 * formas de pago), la caja se parte DELIBERADAMENTE: cierra el borde en la
 * página actual, abre una página nueva, reimprime el título como
 * "(continuación)" y abre un borde nuevo. Nunca deja una caja sin borde ni un
 * rectángulo de alto negativo.
 */
function dibujarCaja(
  doc: PDFKit.PDFDocument,
  area: AreaRide,
  lineas: LineaCaja[],
  opciones: OpcionesCaja = {},
): number {
  const anchoCaja = area.width - PADDING_CAJA * 2;
  const x = area.x + PADDING_CAJA;
  const alturaExtra = opciones.alturaExtra ?? 0;

  // Presupuesto de alto para una línea suelta en una caja que empieza arriba
  // de una página vacía. Una línea más alta que esto no cabe en NINGUNA
  // página, así que se parte por palabras antes de empezar a dibujar.
  const altoContinuacion = opciones.titulo
    ? avanceLinea(doc, lineaContinuacion(opciones.titulo), anchoCaja)
    : 0;
  const presupuestoLinea = alturaUtilPagina(doc) - PADDING_CAJA * 2 - ESPACIO_LINEA - altoContinuacion;
  const lineasFinales = lineas.flatMap((linea) => partirLinea(doc, linea, anchoCaja, presupuestoLinea));

  let topCaja = area.y;
  let y = topCaja + PADDING_CAJA;
  if (opciones.dibujarExtra) {
    opciones.dibujarExtra(x, y, anchoCaja);
  }
  y += alturaExtra;

  let hayContenido = alturaExtra > 0;
  for (const linea of lineasFinales) {
    const alto = alturaLinea(doc, linea, anchoCaja);
    if (hayContenido && y + alto + PADDING_CAJA > limiteInferior(doc)) {
      dibujarBordeCaja(doc, area.x, topCaja, area.width, y + PADDING_CAJA - topCaja);
      doc.addPage();
      topCaja = doc.page.margins.top;
      y = topCaja + PADDING_CAJA;
      if (opciones.titulo) {
        const continuacion = lineaContinuacion(opciones.titulo);
        dibujarLinea(doc, continuacion, x, y, anchoCaja);
        y += avanceLinea(doc, continuacion, anchoCaja);
      }
    }
    dibujarLinea(doc, linea, x, y, anchoCaja);
    y += avanceLinea(doc, linea, anchoCaja);
    hayContenido = true;
  }

  const abajo = y + PADDING_CAJA;
  dibujarBordeCaja(doc, area.x, topCaja, area.width, abajo - topCaja);
  return abajo;
}

/** Parte una línea más alta que una página en varias; el `valor` se queda con el primer trozo. */
function partirLinea(doc: PDFKit.PDFDocument, linea: LineaCaja, anchoCaja: number, presupuesto: number): LineaCaja[] {
  if (linea.espaciador !== undefined || alturaLinea(doc, linea, anchoCaja) <= presupuesto) {
    return [linea];
  }
  aplicarFuente(doc, linea);
  const ancho = linea.ancho ?? anchoCaja;
  const anchoTexto = linea.valor === undefined ? ancho : ancho - (linea.anchoValor ?? ANCHO_VALOR) - ESPACIO_LINEA;
  const trozos = partirTextoPorAltura(doc, linea.texto, anchoTexto, presupuesto);
  return trozos.map((texto, i) => (i === 0 ? { ...linea, texto } : { ...linea, texto, valor: undefined }));
}

/**
 * Dibuja dos bloques en la MISMA fila (izquierda y derecha), garantizando que
 * los dos empiezan en la misma página y en el mismo `y`.
 *
 * Antes, cada `*.ride.ts` llamaba a los dos `draw*` con el mismo `y` local: si
 * el bloque de la izquierda saltaba de página, el de la derecha se dibujaba
 * en ese `y` viejo pero sobre la página NUEVA (caja fantasma a media página y
 * el bloque entero descolgado). Aquí se reserva por adelantado el alto del
 * más alto de los dos, así que ninguno necesita saltar.
 *
 * Si ni siquiera el más alto cabe en una página entera, se apilan en vez de
 * ponerse lado a lado: es la única composición que no deja una caja a medias.
 */
export function drawBloquesEnFila(
  doc: PDFKit.PDFDocument,
  y: number,
  altoIzquierda: number,
  altoDerecha: number,
  izquierda: (y: number) => number,
  derecha: (y: number) => number,
  separacion = 0,
): number {
  const alto = Math.max(altoIzquierda, altoDerecha);
  if (alto > alturaUtilPagina(doc)) {
    let yActual = asegurarEspacio(doc, y, alturaUtilPagina(doc));
    yActual = izquierda(yActual) + separacion;
    yActual = asegurarEspacio(doc, yActual, alturaUtilPagina(doc));
    return derecha(yActual);
  }
  const yFila = asegurarEspacio(doc, y, alto);
  return Math.max(izquierda(yFila), derecha(yFila));
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
  return dibujarCaja(doc, area, lineasEmisor(emisor), {
    alturaExtra: emisor.logo ? ALTURA_LOGO : 0,
    dibujarExtra: emisor.logo
      ? (x, y, anchoCaja) => {
          try {
            doc.image(Buffer.from(emisor.logo as Uint8Array), x, y, { fit: [anchoCaja, 50], align: 'center' });
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
        }
      : undefined,
  });
}

/** Alto reservado para el logo del emisor (50 pt de imagen + separación). */
const ALTURA_LOGO = 54;

/** Líneas del bloque emisor, en el orden en que se imprimen. */
function lineasEmisor(emisor: EmisorRide): LineaCaja[] {
  const lineas: LineaCaja[] = [{ texto: emisor.razonSocial, negrita: true, tamano: TAMANO_TITULO }];
  if (emisor.nombreComercial) {
    lineas.push({ texto: `Nombre Comercial: ${emisor.nombreComercial}` });
  }
  lineas.push({ texto: `Dirección Matriz: ${emisor.dirMatriz}` });
  if (emisor.dirEstablecimiento) {
    lineas.push({ texto: `Dirección Establecimiento: ${emisor.dirEstablecimiento}` });
  }
  if (emisor.obligadoContabilidad) {
    lineas.push({ texto: `Obligado a Llevar Contabilidad: ${emisor.obligadoContabilidad}` });
  }
  if (emisor.contribuyenteEspecial) {
    lineas.push({ texto: `Contribuyente Especial Nro: ${emisor.contribuyenteEspecial}` });
  }
  if (emisor.agenteRetencion) {
    lineas.push({ texto: `Agente de Retención: ${emisor.agenteRetencion}` });
  }
  if (emisor.contribuyenteRimpe) {
    lineas.push({ texto: `Contribuyente RIMPE: ${emisor.contribuyenteRimpe}` });
  }
  if (emisor.rise) {
    lineas.push({ texto: `RISE: ${emisor.rise}` });
  }
  return lineas;
}

/** Alto real que ocupará {@link drawEmisor} en `ancho`. Para `asegurarEspacio`, antes de dibujar. */
export function medirEmisor(doc: PDFKit.PDFDocument, emisor: EmisorRide, ancho: number): number {
  return medirCaja(doc, lineasEmisor(emisor), ancho, emisor.logo ? ALTURA_LOGO : 0);
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
  return dibujarCaja(doc, area, lineasComprobante(doc, comprobante, area.width, qr !== undefined), {
    dibujarExtra: qr
      ? (x, y, anchoCaja) => doc.image(qr, x + anchoCaja - QR_LADO, y, { width: QR_LADO, height: QR_LADO })
      : undefined,
  });
}

/** Lado del QR de la clave de acceso dentro del bloque comprobante. */
const QR_LADO = 85;

/**
 * Líneas del bloque comprobante. Cuando hay QR, las líneas de arriba se
 * envuelven al ancho que queda a su izquierda (`anchoTexto`) y se añade un
 * espaciador para que la clave de acceso —que va a todo el ancho— empiece
 * SIEMPRE por debajo del QR, aunque la columna de texto sea más corta que él.
 */
function lineasComprobante(
  doc: PDFKit.PDFDocument,
  comprobante: ComprobanteRide,
  anchoArea: number,
  hayQr: boolean,
): LineaCaja[] {
  const cajaAncho = anchoArea - PADDING_CAJA * 2;
  const anchoTexto = hayQr ? cajaAncho - QR_LADO - PADDING_CELDA : cajaAncho;

  // Reduce el tamaño hasta que el nombre del documento quepa en una sola
  // línea dentro de `anchoTexto` (gap de Task 2, expuesto por los nombres
  // largos de los 5 comprobantes nuevos: "LIQUIDACIÓN DE COMPRA" y
  // "COMPROBANTE DE RETENCIÓN" no caben al tamaño fijo de 11pt en la columna
  // angosta que queda junto al QR — pdfkit los envolvía a dos líneas,
  // partiendo el título a la mitad). `nombreDocumento` corto (p.ej.
  // "FACTURA") nunca dispara el bucle: ya cabe al tamaño máximo.
  const TAMANO_NOMBRE_DOC_MAX = TAMANO_TITULO + 2;
  let tamanoNombreDoc = TAMANO_NOMBRE_DOC_MAX;
  doc.font(FUENTE_NEGRITA).fontSize(tamanoNombreDoc);
  while (doc.widthOfString(comprobante.nombreDocumento) > anchoTexto && tamanoNombreDoc > TAMANO_TEXTO) {
    tamanoNombreDoc -= 0.5;
    doc.fontSize(tamanoNombreDoc);
  }

  const arriba: LineaCaja[] = [
    { texto: `R.U.C.: ${comprobante.ruc}`, negrita: true, ancho: anchoTexto },
    { texto: comprobante.nombreDocumento, negrita: true, tamano: tamanoNombreDoc, ancho: anchoTexto },
    { texto: `No. ${comprobante.numero}`, ancho: anchoTexto },
  ];

  if (comprobante.autorizacion) {
    arriba.push({ texto: `Número de Autorización: ${comprobante.autorizacion.numero}`, ancho: anchoTexto });
    arriba.push({ texto: `Fecha y Hora de Autorización: ${comprobante.autorizacion.fecha}`, ancho: anchoTexto });
  } else {
    arriba.push({
      texto: 'COMPROBANTE NO AUTORIZADO',
      negrita: true,
      color: COLOR_NO_AUTORIZADO,
      ancho: anchoTexto,
    });
  }

  arriba.push({ texto: `Ambiente: ${LABEL_AMBIENTE[comprobante.ambiente]}`, ancho: anchoTexto });
  arriba.push({ texto: `Emisión: ${LABEL_TIPO_EMISION[comprobante.tipoEmision]}`, ancho: anchoTexto });

  const lineas = [...arriba];
  if (hayQr) {
    const altoTexto = arriba.reduce((acc, linea) => acc + avanceLinea(doc, linea, cajaAncho), 0);
    const altoQr = QR_LADO + ESPACIO_LINEA;
    if (altoTexto < altoQr) {
      lineas.push({ texto: '', espaciador: altoQr - altoTexto });
    }
  }

  // La clave de acceso (49 dígitos, sin espacios donde pdfkit pueda partir la
  // línea) se imprime a todo el ancho de la caja, por debajo del QR: así
  // nunca compite por espacio horizontal con él y no hay riesgo de que se
  // corte.
  lineas.push({ texto: 'Clave de Acceso:' });
  lineas.push({ texto: comprobante.claveAcceso, tamano: TAMANO_TABLA });
  return lineas;
}

/** Alto real que ocupará {@link drawComprobante} en `ancho`. Para `asegurarEspacio`, antes de dibujar. */
export function medirComprobante(
  doc: PDFKit.PDFDocument,
  comprobante: ComprobanteRide,
  ancho: number,
  hayQr: boolean,
): number {
  return medirCaja(doc, lineasComprobante(doc, comprobante, ancho, hayQr), ancho);
}

/**
 * Bloque comprador: razón social o nombres, identificación, fecha de
 * emisión, dirección y guía de remisión (los últimos dos, si existen).
 * `etiquetaSujeto` es lo que Task 2 cambia para reutilizar este mismo bloque
 * como "Proveedor" (liquidación de compra), "Sujeto Retenido" (retención) o
 * "Destinatario" (guía de remisión).
 */
export function drawComprador(doc: PDFKit.PDFDocument, comprador: CompradorRide, area: AreaRide): number {
  return dibujarCaja(doc, area, lineasComprador(comprador), { titulo: tituloComprador(comprador) });
}

/** Título del bloque comprador, ya en mayúsculas ("COMPRADOR", "PROVEEDOR", "DESTINATARIO", ...). */
function tituloComprador(comprador: CompradorRide): string {
  return (comprador.etiquetaSujeto ?? 'Comprador').toUpperCase();
}

/** Líneas del bloque comprador, en el orden en que se imprimen. */
function lineasComprador(comprador: CompradorRide): LineaCaja[] {
  const lineas: LineaCaja[] = [{ texto: tituloComprador(comprador), negrita: true, tamano: TAMANO_TITULO }];

  // Campos "obligatorios" del value object, pero blindados contra un string
  // vacío en tiempo de ejecución (auditoría "campos fiscales omitidos": una
  // etiqueta sin su valor —`Razón Social / Nombres:` sola— es peor que no
  // imprimir la línea, porque parece un dato faltante del EMISOR en vez de
  // uno ausente en la fuente).
  if (noVacio(comprador.razonSocial)) {
    lineas.push({ texto: `Razón Social / Nombres: ${comprador.razonSocial}` });
  }
  if (noVacio(comprador.identificacion)) {
    // `tipoIdentificacion` (catálogo SRI "Tipos de Identificación") junto al
    // número: antes se leía en ningún `*.ride.ts` (hallazgo "ALSO" de la
    // auditoría) aunque los 4 documentos que modelan un
    // `tipoIdentificacionComprador`/`Proveedor`/`SujetoRetenido` lo traen.
    const tipo = comprador.tipoIdentificacion
      ? ` (${LABEL_TIPO_IDENTIFICACION[comprador.tipoIdentificacion] ?? comprador.tipoIdentificacion})`
      : '';
    lineas.push({ texto: `Identificación: ${comprador.identificacion}${tipo}` });
  }
  if (noVacio(comprador.fechaEmision)) {
    lineas.push({ texto: `Fecha Emisión: ${comprador.fechaEmision}` });
  }
  if (comprador.direccion) {
    lineas.push({ texto: `Dirección: ${comprador.direccion}` });
  }
  if (comprador.guiaRemision) {
    lineas.push({ texto: `Guía de Remisión: ${comprador.guiaRemision}` });
  }
  return lineas;
}

/** Alto real que ocupará {@link drawComprador} en `ancho`. Para `asegurarEspacio`, antes de dibujar. */
export function medirComprador(doc: PDFKit.PDFDocument, comprador: CompradorRide, ancho: number): number {
  return medirCaja(doc, lineasComprador(comprador), ancho);
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
 * crédito.
 *
 * `Cant.`: 0.12 (no 0.085 — segunda revisión de este mismo ancho, ver
 * historial: primero 0.07→0.085 cuando `Cant.` solo mostraba 2 decimales
 * fijos, luego 0.085→0.12 cuando {@link formatCantidadPrecision} (hallazgo
 * 4 de la auditoría "campos fiscales omitidos") empezó a imprimir hasta 6
 * decimales). El hueco entre ambas correcciones: a 0.085 el ancho útil en
 * A4 (usable ≈ 38pt a `TAMANO_TABLA`) alcanzaba para `999999.99` (2
 * decimales, ≈ 35.4pt) pero NO para `123.123456` (6 decimales, ≈ 39.6pt) —
 * cualquier cantidad a granel de 10+ caracteres volvía a partirse a la
 * mitad entre dos líneas, la MISMA clase de bug que 0.07→0.085 ya había
 * cerrado, solo que con la cota de caracteres movida por el propio fix de
 * precisión. A 0.12 (usable ≈ 56pt) cabe `999999.999999` (13 caracteres,
 * ≈ 52.1pt) — el mismo techo de "6 dígitos enteros" que ya documentaba el
 * comentario original de esta columna, extendido a los 6 decimales reales
 * en vez de los 2 que asumía. Se compensa restando 0.035 a `Descripción`
 * (la columna con más margen de sobra: ancho de wrap variable por diseño,
 * no un valor fijo que se pueda partir mal). Las fracciones siguen sumando
 * exactamente 1.00.
 *
 * `P. Unitario`: 0.12 sin cambios — usable ≈ 56pt, mismo techo de "6
 * dígitos enteros" (`999999.999999` ≈ 52.1pt, cabe con margen). Un
 * `precioUnitario` de 7+ dígitos enteros (≥ 1'000.000,00 por unidad) sí
 * desborda por una fracción de punto (`1234567.123456` ≈ 56.3pt > 56pt de
 * usable) — fuera del mismo techo documentado de esta tabla, no un caso
 * cubierto (ni antes ni ahora): un precio unitario de esa magnitud no es
 * realista en un comprobante SRI denominado en USD.
 */
const DETALLE_COLUMN_SPECS: Array<[string, number, 'left' | 'right']> = [
  ['Cód. Principal', 0.13, 'left'],
  ['Cód. Auxiliar', 0.11, 'left'],
  ['Cant.', 0.12, 'right'],
  ['Descripción', 0.29, 'left'],
  ['P. Unitario', 0.12, 'right'],
  ['Descuento', 0.1, 'right'],
  ['P. Total', 0.13, 'right'],
];

/**
 * Formatea `cantidad`/`precioUnitario` a la precisión que el dato
 * realmente trae (hasta 6 decimales — la escala SRI para estos dos campos,
 * ver `isMonto`/`Money.php`), recortando ceros de cola sobrantes hasta un
 * mínimo de 2 decimales.
 *
 * Auditoría "campos fiscales omitidos" (hallazgo 4): `celdasDetalle` (y
 * `celdasDestinatarioDetalle` en `guia-remision.ride.ts`) formateaban estas
 * dos columnas con `formatMonto(valor, 2)` — que REDONDEA a 2 decimales, no
 * solo los muestra. Un `precioUnitario` de `0.004500` (frecuente en
 * combustibles, agrícolas o metales preciosos vendidos a granel) se
 * imprimía como `0.00`: la fila quedaba aritméticamente imposible
 * (`cantidad × precioUnitario ≠ precioTotalSinImpuesto` a ojo del lector).
 * A diferencia de `formatMonto`, esto NUNCA redondea — solo recorta dígitos
 * que no aportan información — y por eso preserva el valor exacto sin
 * importar cuántos decimales traiga el dato de entrada.
 *
 * El mínimo de 2 decimales es deliberado (no se recorta hasta quedar un
 * entero pelado): `100.000000` imprime `100.00`, no `100`, por consistencia
 * con el resto de columnas monetarias del RIDE (todas a 2 decimales cuando
 * el valor es un entero exacto).
 */
export function formatCantidadPrecision(valor: string): string {
  const normalizado = formatMonto(valor, 6);
  const [intPart, fracPart] = normalizado.split('.');
  const fracRecortada = (fracPart ?? '').replace(/0+$/, '');
  return `${intPart}.${fracRecortada.length < 2 ? fracRecortada.padEnd(2, '0') : fracRecortada}`;
}

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
    formatCantidadPrecision(d.cantidad),
    `${d.descripcion}${extras}`,
    formatCantidadPrecision(d.precioUnitario),
    formatMonto(d.descuento, 2),
    formatMonto(d.precioTotalSinImpuesto, 2),
  ];
}

/** Deja `doc` con la fuente de una fila de tabla (el encabezado va en negrita). */
function fuenteFilaTabla(doc: PDFKit.PDFDocument, esEncabezado: boolean): void {
  doc.font(esEncabezado ? FUENTE_NEGRITA : FUENTE_NORMAL).fontSize(TAMANO_TABLA).fillColor(COLOR_TEXTO);
}

/** Altura que ocupará la fila (la celda más alta, según el wrap de cada columna) más el padding de celda. */
function alturaFilaTabla(
  doc: PDFKit.PDFDocument,
  columnas: ColumnaTabla[],
  celdas: string[],
  esEncabezado: boolean,
): number {
  fuenteFilaTabla(doc, esEncabezado);
  const alturas = columnas.map((col, i) => doc.heightOfString(celdas[i], { width: col.width - PADDING_CELDA * 2 }));
  return Math.max(...alturas) + PADDING_CELDA * 2;
}

/**
 * Dibuja una fila (encabezado o dato) con sus bordes y devuelve el `y` de su
 * borde inferior. Las celdas se escriben con {@link escribirTexto}, así que la
 * fila NUNCA se parte sola entre dos páginas: si no cabe, es
 * {@link drawTablaGenerica} quien decide dónde va. Antes, una descripción
 * larga hacía que pdfkit paginara a mitad de fila y las columnas de importes
 * (escritas después) quedaban en la página siguiente, huérfanas y fuera del
 * rectángulo de su propia fila.
 */
function dibujarFilaTabla(
  doc: PDFKit.PDFDocument,
  columnas: ColumnaTabla[],
  celdas: string[],
  x: number,
  y: number,
  esEncabezado: boolean,
): number {
  const alto = alturaFilaTabla(doc, columnas, celdas, esEncabezado);
  const anchoTotal = columnas.reduce((s, c) => s + c.width, 0);

  if (esEncabezado) {
    doc.rect(x, y, anchoTotal, alto).fillAndStroke(COLOR_ENCABEZADO_TABLA, COLOR_TEXTO);
    doc.fillColor(COLOR_TEXTO);
  }

  fuenteFilaTabla(doc, esEncabezado);
  let cx = x;
  for (let i = 0; i < columnas.length; i++) {
    escribirTexto(doc, celdas[i], cx + PADDING_CELDA, y + PADDING_CELDA, {
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
 * Fila más alta que una página entera (p.ej. una descripción de 120 líneas):
 * se parte DELIBERADAMENTE en sub-filas, cada una con su encabezado repetido
 * arriba y su propio rectángulo cerrado. El primer trozo lleva las celdas
 * cortas (cantidad, precios, totales), así que los importes van siempre en la
 * misma página que el principio de su descripción.
 */
function dibujarFilaEnVariasPaginas(
  doc: PDFKit.PDFDocument,
  columnas: ColumnaTabla[],
  encabezados: string[],
  celdas: string[],
  x: number,
  y: number,
  altoEncabezado: number,
): number {
  // Arranca en una página nueva (salvo que la actual esté recién abierta con
  // solo el encabezado): así todas las sub-filas tienen el mismo presupuesto
  // de alto y el reparto no depende de dónde venía la tabla.
  let yFila = y;
  if (yFila > doc.page.margins.top + altoEncabezado) {
    doc.addPage();
    yFila = dibujarFilaTabla(doc, columnas, encabezados, x, doc.page.margins.top, true);
  }

  const presupuesto = alturaUtilPagina(doc) - altoEncabezado - PADDING_CELDA * 2;
  fuenteFilaTabla(doc, false);
  const trozos = columnas.map((col, i) =>
    partirTextoPorAltura(doc, celdas[i], col.width - PADDING_CELDA * 2, presupuesto),
  );
  const subFilas = Math.max(...trozos.map((t) => t.length));

  for (let s = 0; s < subFilas; s++) {
    if (s > 0) {
      doc.addPage();
      yFila = dibujarFilaTabla(doc, columnas, encabezados, x, doc.page.margins.top, true);
    }
    yFila = dibujarFilaTabla(
      doc,
      columnas,
      trozos.map((t) => t[s] ?? ''),
      x,
      yFila,
      false,
    );
  }
  return yFila;
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
  const altoEncabezado = alturaFilaTabla(doc, columnas, encabezados, true);

  // A diferencia de los bloques con borde, la tabla reserva su propio espacio:
  // ya es dueña de su paginación fila a fila, así que los `*.ride.ts` no
  // necesitan (ni pueden) adivinar su alto. Reserva encabezado + primera fila
  // para no dejar nunca un encabezado solo al pie de una página.
  const altoPrimeraFila = filas.length > 0 ? alturaFilaTabla(doc, columnas, filas[0], false) : 0;
  let y = asegurarEspacio(doc, area.y, Math.min(altoEncabezado + altoPrimeraFila, alturaUtilPagina(doc)));
  y = dibujarFilaTabla(doc, columnas, encabezados, area.x, y, true);

  for (const fila of filas) {
    const alto = alturaFilaTabla(doc, columnas, fila, false);

    if (y + alto <= limiteInferior(doc)) {
      y = dibujarFilaTabla(doc, columnas, fila, area.x, y, false);
      continue;
    }

    if (altoEncabezado + alto <= alturaUtilPagina(doc)) {
      // Cabe entera en una página: salta y repite el encabezado antes de la fila.
      doc.addPage();
      y = dibujarFilaTabla(doc, columnas, encabezados, area.x, doc.page.margins.top, true);
      y = dibujarFilaTabla(doc, columnas, fila, area.x, y, false);
      continue;
    }

    y = dibujarFilaEnVariasPaginas(doc, columnas, encabezados, fila, area.x, y, altoEncabezado);
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

/**
 * Suma en centavos el `valor` de todos los impuestos, agrupado por `codigo`
 * — nunca aritmética de punto flotante — en el orden de primera aparición
 * (`Map` conserva orden de inserción). Antes de la auditoría "campos
 * fiscales omitidos" (hallazgo 3) esto era `sumarValorPorCodigo(impuestos,
 * codigo)`, llamado solo para ICE e IVA: cualquier otro código presente en
 * `totalConImpuestos` (p.ej. IRBPNR, código `5`) no se sumaba a NINGÚN lado,
 * así que ni aparecía en su propia línea ni se le podía reclamar a
 * `sumarValorPorCodigo` — se perdía en silencio y el lector no podía
 * reconciliar la suma de líneas contra `importeTotal`. Agrupar TODOS los
 * códigos de una pasada es lo que permite que {@link lineasTotales} imprima
 * una línea por cada código presente sin tener que enumerar de antemano
 * cuáles existen.
 */
function agruparValorPorCodigo(impuestos: TotalImpuesto[]): Map<string, number> {
  const grupos = new Map<string, number>();
  for (const imp of impuestos) {
    grupos.set(imp.codigo, (grupos.get(imp.codigo) ?? 0) + toCents(imp.valor));
  }
  return grupos;
}

/**
 * Bloque totales: subtotales por tarifa de IVA, subtotal sin impuestos,
 * total descuento (si viene — `NotaCredito`/`NotaDebito` no lo modelan),
 * moneda (si viene), ICE (si aplica), IVA, cualquier otro impuesto presente
 * en `totales.impuestos` (IRBPNR y cualquier código no catalogado — nunca se
 * descarta uno por no tener etiqueta conocida), propina (si viene) y valor
 * total. Toda la suma de impuestos usa `toCents`/`fromCents` — nunca
 * aritmética de punto flotante sobre los montos. Las líneas impresas SIEMPRE
 * reconcilian contra `importeTotal` (hallazgo 3 de la auditoría "campos
 * fiscales omitidos": antes, un impuesto con un código que no fuera IVA/ICE
 * se perdía entero y esa reconciliación era imposible).
 */
export function drawTotales(doc: PDFKit.PDFDocument, totales: TotalesRide, area: AreaRide): number {
  return dibujarCaja(doc, area, lineasTotales(totales), { titulo: TITULO_TOTALES });
}

const TITULO_TOTALES = 'TOTALES';

/** Líneas del bloque totales, en el orden en que se imprimen. */
function lineasTotales(totales: TotalesRide): LineaCaja[] {
  const lineas: LineaCaja[] = [{ texto: TITULO_TOTALES, negrita: true, tamano: TAMANO_TITULO }];

  for (const subtotal of subtotalesIva(totales.impuestos)) {
    lineas.push({ texto: subtotal.etiqueta, valor: formatMonto(subtotal.base, 2) });
  }

  lineas.push({ texto: 'Subtotal sin impuestos', valor: formatMonto(totales.totalSinImpuestos, 2) });

  if (totales.totalDescuento !== undefined) {
    lineas.push({ texto: 'Total descuento', valor: formatMonto(totales.totalDescuento, 2) });
  }

  const grupos = agruparValorPorCodigo(totales.impuestos);

  // ICE: línea opcional, solo si el código está presente en `impuestos`
  // (antes era "solo si la suma es > 0" — un ICE de '0.00' explícito en el
  // documento ahora también se imprime, en vez de desaparecer).
  const ice = grupos.get(CODIGO_IMPUESTO_ICE);
  if (ice !== undefined) {
    lineas.push({ texto: 'ICE', valor: fromCents(ice) });
  }

  // IVA: línea fija del layout SRI — se imprime siempre, en 0.00 si el
  // documento no trae ningún impuesto con este código.
  lineas.push({ texto: 'IVA', valor: fromCents(grupos.get(CODIGO_IMPUESTO_IVA) ?? 0) });

  // Cualquier otro código de impuesto presente (IRBPNR y cualquier código
  // futuro no catalogado): se imprime SIEMPRE que esté presente, con su
  // etiqueta conocida o, a falta de ella, una genérica que incluye el
  // código crudo — nunca se descarta.
  for (const [codigo, cents] of grupos) {
    if (codigo === CODIGO_IMPUESTO_ICE || codigo === CODIGO_IMPUESTO_IVA) continue;
    lineas.push({ texto: LABEL_IMPUESTO[codigo] ?? `Otro impuesto (código ${codigo})`, valor: fromCents(cents) });
  }

  if (totales.propina) {
    lineas.push({ texto: 'Propina', valor: formatMonto(totales.propina, 2) });
  }

  if (noVacio(totales.moneda)) {
    lineas.push({ texto: 'Moneda', valor: totales.moneda });
  }

  lineas.push({ texto: 'VALOR TOTAL', valor: formatMonto(totales.importeTotal, 2), negrita: true });
  return lineas;
}

/** Alto real que ocupará {@link drawTotales} en `ancho`. Para `asegurarEspacio`, antes de dibujar. */
export function medirTotales(doc: PDFKit.PDFDocument, totales: TotalesRide, ancho: number): number {
  return medirCaja(doc, lineasTotales(totales), ancho);
}

/** Bloque formas de pago: forma de pago, valor, plazo y unidad de tiempo (los últimos dos, si vienen). */
export function drawFormasPago(doc: PDFKit.PDFDocument, pagos: Pago[], area: AreaRide): number {
  return dibujarCaja(doc, area, lineasFormasPago(pagos), { titulo: TITULO_FORMAS_PAGO });
}

const TITULO_FORMAS_PAGO = 'FORMAS DE PAGO';

/** Líneas del bloque formas de pago, en el orden en que se imprimen. */
function lineasFormasPago(pagos: Pago[]): LineaCaja[] {
  const lineas: LineaCaja[] = [{ texto: TITULO_FORMAS_PAGO, negrita: true, tamano: TAMANO_TITULO }];
  for (const pago of pagos) {
    const partes = [LABEL_FORMA_PAGO[pago.formaPago] ?? pago.formaPago, formatMonto(pago.total, 2)];
    if (pago.plazo) partes.push(`Plazo: ${pago.plazo}`);
    if (pago.unidadTiempo) partes.push(`Unidad de Tiempo: ${pago.unidadTiempo}`);
    lineas.push({ texto: partes.join('   —   ') });
  }
  return lineas;
}

/** Alto real que ocupará {@link drawFormasPago} en `ancho`. Para `asegurarEspacio`, antes de dibujar. */
export function medirFormasPago(doc: PDFKit.PDFDocument, pagos: Pago[], ancho: number): number {
  return medirCaja(doc, lineasFormasPago(pagos), ancho);
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
  const lineas = lineasInfoAdicional(infoAdicional);
  if (lineas.length === 0) {
    return area.y;
  }
  return dibujarCaja(doc, area, lineas, { titulo: TITULO_INFO_ADICIONAL });
}

const TITULO_INFO_ADICIONAL = 'INFORMACIÓN ADICIONAL';

/**
 * Líneas del bloque información adicional; vacío (sin ni siquiera el
 * título) si no hay campos con contenido real. Descarta los campos con
 * `valor` vacío/solo espacios ANTES de decidir si hay algo que dibujar —
 * auditoría "campos fiscales omitidos": un `campoAdicional` con valor `''`
 * imprimía `Clave:` sin nada después, un `:` suelto que parece un dato
 * faltante del documento en vez de un campo vacío en la fuente.
 */
function lineasInfoAdicional(infoAdicional: Record<string, string> | undefined): LineaCaja[] {
  const entradas = infoAdicional
    ? Object.entries(infoAdicional).filter(([, valor]) => noVacio(valor))
    : [];
  if (entradas.length === 0) {
    return [];
  }
  return [
    { texto: TITULO_INFO_ADICIONAL, negrita: true, tamano: TAMANO_TITULO },
    ...entradas.map(([clave, valor]) => ({ texto: `${clave}: ${valor}` })),
  ];
}

/** Alto real que ocupará {@link drawInfoAdicional} en `ancho` (0 si no hay campos). */
export function medirInfoAdicional(
  doc: PDFKit.PDFDocument,
  infoAdicional: Record<string, string> | undefined,
  ancho: number,
): number {
  const lineas = lineasInfoAdicional(infoAdicional);
  return lineas.length === 0 ? 0 : medirCaja(doc, lineas, ancho);
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
  return dibujarCaja(doc, area, lineasBloqueTexto(titulo, lineas), { titulo });
}

/** Líneas del bloque genérico: título en negrita + una línea por cada texto. */
function lineasBloqueTexto(titulo: string, lineas: string[]): LineaCaja[] {
  return [
    { texto: titulo, negrita: true, tamano: TAMANO_TITULO },
    ...lineas.map((texto) => ({ texto })),
  ];
}

/** Alto real que ocupará {@link drawBloqueTexto} en `ancho`. Para `asegurarEspacio`, antes de dibujar. */
export function medirBloqueTexto(
  doc: PDFKit.PDFDocument,
  titulo: string,
  lineas: string[],
  ancho: number,
): number {
  return medirCaja(doc, lineasBloqueTexto(titulo, lineas), ancho);
}
