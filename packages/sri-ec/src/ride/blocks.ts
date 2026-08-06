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
import { dibujarCode128 } from './code128.js';
import type {
  AreaRide,
  ComprobanteRide,
  CompradorRide,
  EmisorRide,
  EtiquetasTotales,
  TotalesRide,
} from './types.js';

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
const COLOR_ENCABEZADO_TABLA = '#ffffff';
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
 * Tamaño mínimo al que {@link tamanoQueCabe} puede encoger un token
 * indivisible antes de rendirse y dejar que pdfkit lo envuelva. Por debajo de
 * esto el dígito deja de ser legible en papel, así que preferimos el mal menor
 * (envolver) al ilegible.
 */
const TAMANO_MINIMO_AJUSTE = 4.5;

/**
 * Tamaño de fuente al que `texto` cabe en UNA línea de `ancho` puntos,
 * encogiendo desde `base` en pasos de 0.25.
 *
 * Solo actúa sobre tokens INDIVISIBLES (sin espacios): un número. La
 * alternativa —ensanchar la columna— dejó de estar disponible al adoptar el
 * Anexo 2, que fija 12 columnas en el detalle de la factura: ninguna reparte
 * lo suficiente para `999999.999999` (≈ 52pt a 7.5pt de fuente). Encoger la
 * celda preserva la garantía que costó dos rondas de revisión —`cantidad` y
 * `precioUnitario` se imprimen a hasta 6 decimales sin partirse a la mitad
 * ("123.12345" / "6" en dos líneas)— y además es independiente del ancho de
 * columna, así que no vuelve a romperse la próxima vez que el layout cambie.
 *
 * Un texto CON espacios se devuelve al tamaño base: ahí envolver es correcto
 * (una descripción larga debe ocupar varias líneas, no imprimirse diminuta).
 */
function tamanoQueCabe(doc: PDFKit.PDFDocument, texto: string, ancho: number, base: number): number {
  if (texto === '' || /\s/.test(texto)) return base;
  doc.fontSize(base);
  if (doc.widthOfString(texto) <= ancho) return base;

  let tamano = base;
  while (tamano > TAMANO_MINIMO_AJUSTE) {
    tamano = Math.max(TAMANO_MINIMO_AJUSTE, tamano - 0.25);
    doc.fontSize(tamano);
    if (doc.widthOfString(texto) <= ancho) return tamano;
  }
  return TAMANO_MINIMO_AJUSTE;
}

/**
 * Una columna dentro de una línea de caja. Las maquetas del Anexo 2 están
 * llenas de filas de dos y cuatro columnas (`Dirección Matriz:` | valor;
 * `Razón Social...` | valor | `Identificación:` | valor), donde la etiqueta va
 * en negrita a la izquierda y el valor en su propia columna — no un solo
 * `"etiqueta: valor"` concatenado, que es lo que dibujaba el RIDE v0.2.0.
 */
interface ColumnaLinea {
  texto: string;
  /** Ancho en puntos de esta columna. */
  ancho: number;
  negrita?: boolean;
  tamano?: number;
  color?: string;
  alineacion?: 'left' | 'center' | 'right';
  /** Espaciado extra entre caracteres, para el nombre del documento (`F A C T U R A`). */
  espaciadoCaracteres?: number;
  /** Encoge la fuente hasta que el texto quepa en una línea. Ver {@link tamanoQueCabe}. */
  ajustar?: boolean;
}

/**
 * Una línea del contenido de una caja con borde. `texto` y `valor` (si viene)
 * —o todas las `columnas`, si vienen— son UNA sola unidad indivisible: se
 * dibujan en el mismo `y` y el avance es el máximo de los altos — antes eran
 * dos `doc.text` independientes, así que una etiqueta que envolvía a dos
 * líneas quedaba pisada por la fila siguiente, y una etiqueta que provocaba
 * salto de página dejaba su importe en la página siguiente ("VALOR TOTAL"
 * solo en una página, "112.00" en otra).
 */
interface LineaCaja {
  texto: string;
  /**
   * Varias columnas en la MISMA línea (misma unidad indivisible que
   * `texto`+`valor`). Si viene, `texto`/`valor` se ignoran.
   */
  columnas?: ColumnaLinea[];
  /** Si viene, se imprime alineado a la derecha, en la MISMA línea que `texto`. */
  valor?: string;
  anchoValor?: number;
  /** Ancho de envoltura; por defecto, el ancho útil de la caja. */
  ancho?: number;
  negrita?: boolean;
  tamano?: number;
  color?: string;
  alineacion?: 'left' | 'center' | 'right';
  espaciadoCaracteres?: number;
  ajustar?: boolean;
  /** Hueco vertical de alto fijo: no imprime nada ni añade `ESPACIO_LINEA`. */
  espaciador?: number;
  /**
   * Pinta contenido no textual (el código de barras, el QR) en el hueco que
   * reserva `espaciador`. Se llama con el `y` REAL en el que quedó la línea,
   * así que sigue siendo correcto aunque la caja haya saltado de página antes.
   */
  dibujar?: (x: number, y: number, ancho: number) => void;
}

/** Deja `doc` con la fuente/tamaño/color de `linea`. */
function aplicarFuente(doc: PDFKit.PDFDocument, linea: LineaCaja): void {
  doc
    .font(linea.negrita ? FUENTE_NEGRITA : FUENTE_NORMAL)
    .fontSize(linea.tamano ?? TAMANO_TEXTO)
    .fillColor(linea.color ?? COLOR_TEXTO);
}

/** Deja `doc` con la fuente de `columna` y devuelve el tamaño efectivo (ya ajustado si toca). */
function aplicarFuenteColumna(doc: PDFKit.PDFDocument, columna: ColumnaLinea): number {
  doc.font(columna.negrita ? FUENTE_NEGRITA : FUENTE_NORMAL).fillColor(columna.color ?? COLOR_TEXTO);
  const base = columna.tamano ?? TAMANO_TEXTO;
  const tamano = columna.ajustar ? tamanoQueCabe(doc, columna.texto, columna.ancho, base) : base;
  doc.fontSize(tamano);
  return tamano;
}

/** Opciones de `doc.text`/`heightOfString` de una columna. */
function opcionesColumna(columna: ColumnaLinea): PDFKit.Mixins.TextOptions {
  return {
    width: columna.ancho,
    align: columna.alineacion ?? 'left',
    characterSpacing: columna.espaciadoCaracteres,
  };
}

/** Alto de `linea` sin contar el `ESPACIO_LINEA` que la separa de la siguiente. */
function alturaLinea(doc: PDFKit.PDFDocument, linea: LineaCaja, anchoCaja: number): number {
  if (linea.espaciador !== undefined) {
    return linea.espaciador;
  }
  if (linea.columnas) {
    return Math.max(
      ...linea.columnas.map((columna) => {
        aplicarFuenteColumna(doc, columna);
        return doc.heightOfString(columna.texto, opcionesColumna(columna));
      }),
    );
  }
  aplicarFuente(doc, linea);
  const ancho = linea.ancho ?? anchoCaja;
  if (linea.valor === undefined) {
    return doc.heightOfString(linea.texto, opcionesLinea(doc, linea, ancho));
  }
  const anchoValor = linea.anchoValor ?? ANCHO_VALOR;
  return Math.max(
    doc.heightOfString(linea.texto, opcionesLinea(doc, linea, ancho - anchoValor - ESPACIO_LINEA)),
    doc.heightOfString(linea.valor, { width: anchoValor }),
  );
}

/** Opciones de `doc.text` de una línea simple, aplicando el ajuste de tamaño si lo pide. */
function opcionesLinea(doc: PDFKit.PDFDocument, linea: LineaCaja, ancho: number): PDFKit.Mixins.TextOptions {
  if (linea.ajustar) {
    doc.fontSize(tamanoQueCabe(doc, linea.texto, ancho, linea.tamano ?? TAMANO_TEXTO));
  }
  return { width: ancho, align: linea.alineacion ?? 'left', characterSpacing: linea.espaciadoCaracteres };
}

/** Avance vertical total de `linea` (alto + separación con la siguiente). */
function avanceLinea(doc: PDFKit.PDFDocument, linea: LineaCaja, anchoCaja: number): number {
  return alturaLinea(doc, linea, anchoCaja) + (linea.espaciador !== undefined ? 0 : ESPACIO_LINEA);
}

/** Dibuja `linea` en `(x, y)`. No toca el `y` del llamador: el avance lo controla {@link dibujarCaja}. */
function dibujarLinea(doc: PDFKit.PDFDocument, linea: LineaCaja, x: number, y: number, anchoCaja: number): void {
  if (linea.espaciador !== undefined) {
    linea.dibujar?.(x, y, anchoCaja);
    return;
  }
  if (linea.columnas) {
    let cx = x;
    for (const columna of linea.columnas) {
      aplicarFuenteColumna(doc, columna);
      escribirTexto(doc, columna.texto, cx, y, opcionesColumna(columna));
      cx += columna.ancho;
    }
    return;
  }
  aplicarFuente(doc, linea);
  const ancho = linea.ancho ?? anchoCaja;
  if (linea.valor === undefined) {
    escribirTexto(doc, linea.texto, x, y, opcionesLinea(doc, linea, ancho));
    return;
  }
  const anchoValor = linea.anchoValor ?? ANCHO_VALOR;
  escribirTexto(doc, linea.texto, x, y, opcionesLinea(doc, linea, ancho - anchoValor - ESPACIO_LINEA));
  aplicarFuente(doc, linea);
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
  /**
   * Alto mínimo del borde. Lo usa {@link drawCabecera} para que las dos
   * columnas de la cabecera cierren a la MISMA altura, como en la maqueta del
   * Anexo 2 — sin esto, la caja del emisor y la del comprobante terminan a
   * alturas distintas según cuántos campos traiga cada documento. Solo
   * agranda: nunca recorta el contenido (el borde se dibuja con
   * `max(altoReal, altoMinimo)`, así que sigue siendo positivo).
   */
  altoMinimo?: number;
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

  // `altoMinimo` se recorta al margen inferior de la página: estirar una caja
  // para igualar la altura de la columna de al lado NUNCA puede sacar su borde
  // del papel. Sin este recorte, un pie cuya columna derecha ocupa varias
  // páginas (`drawBloquesEnFila` las apila en vez de ponerlas en fila) pedía
  // una caja de ~2960pt en una página de 842 — un rectángulo fuera del papel,
  // justo lo que vigila `esperarRectangulosSanos`.
  const abajo = Math.max(y + PADDING_CAJA, Math.min(topCaja + (opciones.altoMinimo ?? 0), limiteInferior(doc)));
  dibujarBordeCaja(doc, area.x, topCaja, area.width, abajo - topCaja);
  return abajo;
}

/** Parte una línea más alta que una página en varias; el `valor` se queda con el primer trozo. */
function partirLinea(doc: PDFKit.PDFDocument, linea: LineaCaja, anchoCaja: number, presupuesto: number): LineaCaja[] {
  if (linea.espaciador !== undefined || alturaLinea(doc, linea, anchoCaja) <= presupuesto) {
    return [linea];
  }

  // Una línea de columnas más alta que una página entera: se degrada a texto
  // plano y se parte por palabras. No debería ocurrir (las filas de columnas
  // del Anexo 2 son etiquetas de una o dos líneas), pero si ocurriera, dejarla
  // pasar dibujaría una caja MÁS ALTA QUE EL PAPEL — exactamente el rectángulo
  // fuera de página que `esperarRectangulosSanos` vigila.
  if (linea.columnas) {
    const plano: LineaCaja = { texto: linea.columnas.map((c) => c.texto).join(' '), negrita: linea.columnas[0]?.negrita };
    return partirLinea(doc, plano, anchoCaja, presupuesto);
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
 * Cabecera — emisor (columna IZQUIERDA de la maqueta del Anexo 2, página 56):
 * el logo arriba, ocupando una banda amplia SIN borde, y debajo una caja con
 * borde con razón social, nombre comercial, `Dirección Matriz:`, `Dirección
 * Sucursal:`, `Contribuyente Especial Nro` (valor a la derecha) y `OBLIGADO A
 * LLEVAR CONTABILIDAD` + `SI`/`NO`.
 *
 * Las etiquetas van en su propia columna, en negrita, y el valor en la de al
 * lado — como en la maqueta, no concatenadas en un `"etiqueta: valor"` suelto
 * (que es lo que dibujaba el RIDE v0.2.0).
 *
 * `agenteRetencion`, `contribuyenteRimpe` y `rise` no salen en la maqueta de
 * 2017 (son posteriores) pero SÍ se imprimen, con el mismo formato de fila,
 * detrás de `OBLIGADO A LLEVAR CONTABILIDAD`: la auditoría "campos fiscales
 * omitidos" los añadió y quitarlos ahora sería perder datos del emisor.
 */
export function drawEmisor(
  doc: PDFKit.PDFDocument,
  emisor: EmisorRide,
  area: AreaRide,
  altoMinimo?: number,
): number {
  let y = area.y;
  if (emisor.logo) {
    dibujarLogo(doc, emisor.logo, area.x, y, area.width);
    y += ALTURA_LOGO;
  }
  return dibujarCaja(doc, { ...area, y }, lineasEmisor(emisor, area.width), {
    altoMinimo: altoMinimo !== undefined ? altoMinimo - (y - area.y) : undefined,
  });
}

/**
 * Alto de la banda del logo (imagen + separación con la caja de abajo). En la
 * maqueta el logo ocupa una franja notablemente más alta que una línea de
 * texto — es lo primero que se ve del RIDE.
 */
const ALTURA_IMAGEN_LOGO = 62;
const ALTURA_LOGO = ALTURA_IMAGEN_LOGO + 6;

/** Pinta el logo del emisor centrado en su banda, sin borde (como en la maqueta). */
function dibujarLogo(doc: PDFKit.PDFDocument, logo: Uint8Array, x: number, y: number, ancho: number): void {
  try {
    doc.image(Buffer.from(logo), x, y, { fit: [ancho, ALTURA_IMAGEN_LOGO], align: 'center', valign: 'center' });
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

/** Fracción del ancho de la caja que ocupa la columna de etiqueta en las filas `Dirección ...`. */
const FRACCION_ETIQUETA_DIRECCION = 0.3;
/** Fracción que ocupa la etiqueta en las filas de etiqueta larga + valor corto (`OBLIGADO A ...`). */
const FRACCION_ETIQUETA_ANCHA = 0.68;

/** Fila de dos columnas: etiqueta en negrita + valor. */
function filaEtiquetaValor(
  anchoCaja: number,
  etiqueta: string,
  valor: string,
  fraccionEtiqueta: number,
  opciones: { alinearValorDerecha?: boolean; tamano?: number } = {},
): LineaCaja {
  const anchoEtiqueta = Math.floor(anchoCaja * fraccionEtiqueta);
  return {
    texto: etiqueta,
    columnas: [
      { texto: etiqueta, ancho: anchoEtiqueta, negrita: true, tamano: opciones.tamano },
      {
        texto: valor,
        ancho: anchoCaja - anchoEtiqueta,
        tamano: opciones.tamano,
        alineacion: opciones.alinearValorDerecha ? 'right' : 'left',
        ajustar: true,
      },
    ],
  };
}

/** Líneas del bloque emisor, en el orden en que las imprime la maqueta. */
function lineasEmisor(emisor: EmisorRide, anchoArea: number): LineaCaja[] {
  const anchoCaja = anchoArea - PADDING_CAJA * 2;
  const lineas: LineaCaja[] = [{ texto: emisor.razonSocial, negrita: true, tamano: TAMANO_TITULO }];
  if (emisor.nombreComercial) {
    lineas.push({ texto: emisor.nombreComercial, tamano: TAMANO_TABLA });
  }
  lineas.push({ texto: '', espaciador: ESPACIO_LINEA * 2 });

  lineas.push(filaEtiquetaValor(anchoCaja, 'Dirección Matriz:', emisor.dirMatriz, FRACCION_ETIQUETA_DIRECCION));
  if (noVacio(emisor.dirEstablecimiento)) {
    lineas.push(
      filaEtiquetaValor(anchoCaja, 'Dirección Sucursal:', emisor.dirEstablecimiento, FRACCION_ETIQUETA_DIRECCION),
    );
  }
  if (noVacio(emisor.contribuyenteEspecial)) {
    lineas.push(
      filaEtiquetaValor(anchoCaja, 'Contribuyente Especial Nro', emisor.contribuyenteEspecial, FRACCION_ETIQUETA_ANCHA, {
        alinearValorDerecha: true,
      }),
    );
  }
  if (emisor.obligadoContabilidad) {
    lineas.push(
      filaEtiquetaValor(anchoCaja, 'OBLIGADO A LLEVAR CONTABILIDAD', emisor.obligadoContabilidad, FRACCION_ETIQUETA_ANCHA, {
        alinearValorDerecha: true,
      }),
    );
  }
  // Campos posteriores a la maqueta de 2017 (los añadió la auditoría "campos
  // fiscales omitidos"): etiqueta y valor a partes iguales y alineados a la
  // izquierda — sus valores son texto libre, no un `SI`/`NO` ni un número,
  // así que en la columna estrecha de las filas de arriba se partirían en
  // cuatro o cinco líneas.
  for (const [etiqueta, valor] of [
    ['Agente de Retención:', emisor.agenteRetencion],
    ['Contribuyente Régimen RIMPE:', emisor.contribuyenteRimpe],
    ['RISE:', emisor.rise],
  ] as const) {
    if (noVacio(valor)) {
      lineas.push(filaEtiquetaValor(anchoCaja, etiqueta, valor, 0.45));
    }
  }
  return lineas;
}

/** Alto real que ocupará {@link drawEmisor} en `ancho`. Para `asegurarEspacio`, antes de dibujar. */
export function medirEmisor(doc: PDFKit.PDFDocument, emisor: EmisorRide, ancho: number): number {
  return medirCaja(doc, lineasEmisor(emisor, ancho), ancho) + (emisor.logo ? ALTURA_LOGO : 0);
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
  codigoBarras = true,
  altoMinimo?: number,
): number {
  return dibujarCaja(doc, area, lineasComprobante(doc, comprobante, area.width, qr, codigoBarras), { altoMinimo });
}

/** Lado del QR de la clave de acceso dentro del bloque comprobante. */
const QR_LADO = 85;

/**
 * Alto de las barras del Code 128. La maqueta lo dibuja como una banda baja y
 * ancha, a todo el ancho útil de la caja del comprobante.
 */
const ALTURA_CODIGO_BARRAS = 34;

/**
 * Líneas del bloque comprobante, en el orden EXACTO de la maqueta del Anexo 2
 * (página 56): `R.U.C.:`, el nombre del documento con espaciado entre letras
 * (`F A C T U R A`), `No.` + `estab-ptoEmi-secuencial`, `NÚMERO DE
 * AUTORIZACIÓN` con el número en la línea de abajo, `FECHA Y HORA DE
 * AUTORIZACIÓN`, `AMBIENTE:`, `EMISIÓN:`, y por último `CLAVE DE ACCESO` con
 * el código de barras y los 49 dígitos debajo.
 *
 * El nombre del documento usa `characterSpacing` en vez de intercalar espacios
 * en la cadena: el PDF se ve igual que la maqueta, pero el texto extraíble
 * sigue siendo `FACTURA` (copiable, y comprobable en los tests) en vez de
 * `F A C T U R A`.
 */
function lineasComprobante(
  doc: PDFKit.PDFDocument,
  comprobante: ComprobanteRide,
  anchoArea: number,
  qr: Buffer | undefined,
  codigoBarras: boolean,
): LineaCaja[] {
  const anchoCaja = anchoArea - PADDING_CAJA * 2;

  // Reduce el tamaño hasta que el nombre del documento quepa en una sola
  // línea (gap de Task 2, expuesto por los nombres largos de los otros 5
  // comprobantes: "LIQUIDACIÓN DE COMPRA DE BIENES Y PRESTACIÓN DE SERVICIOS"
  // no cabe al tamaño máximo). El espaciado entre letras se reduce a la vez:
  // en un nombre largo, mantenerlo lo obligaría a encoger mucho más.
  const TAMANO_NOMBRE_DOC_MAX = TAMANO_TITULO + 3;
  let tamanoNombreDoc = TAMANO_NOMBRE_DOC_MAX;
  let espaciadoNombreDoc = 2.5;
  doc.font(FUENTE_NEGRITA).fontSize(tamanoNombreDoc);
  while (
    doc.widthOfString(comprobante.nombreDocumento, { characterSpacing: espaciadoNombreDoc }) > anchoCaja &&
    tamanoNombreDoc > TAMANO_TABLA
  ) {
    tamanoNombreDoc -= 0.5;
    espaciadoNombreDoc = Math.max(0, espaciadoNombreDoc - 0.35);
    doc.fontSize(tamanoNombreDoc);
  }

  const lineas: LineaCaja[] = [
    filaEtiquetaValor(anchoCaja, 'R.U.C.:', comprobante.ruc, 0.3, { tamano: TAMANO_TITULO }),
    {
      texto: comprobante.nombreDocumento,
      negrita: true,
      tamano: tamanoNombreDoc,
      espaciadoCaracteres: espaciadoNombreDoc,
    },
    filaEtiquetaValor(anchoCaja, 'No.', comprobante.numero, 0.15, { tamano: TAMANO_TITULO }),
    { texto: 'NÚMERO DE AUTORIZACIÓN', tamano: TAMANO_TABLA },
  ];

  if (comprobante.autorizacion) {
    lineas.push({ texto: comprobante.autorizacion.numero, negrita: true, tamano: TAMANO_TABLA, ajustar: true });
    lineas.push(
      filaEtiquetaValor(anchoCaja, 'FECHA Y HORA DE AUTORIZACIÓN', comprobante.autorizacion.fecha, 0.5, {
        tamano: TAMANO_TABLA,
      }),
    );
  } else {
    lineas.push({ texto: 'COMPROBANTE NO AUTORIZADO', negrita: true, color: COLOR_NO_AUTORIZADO });
  }

  lineas.push(filaEtiquetaValor(anchoCaja, 'AMBIENTE:', LABEL_AMBIENTE[comprobante.ambiente], 0.35));
  lineas.push(filaEtiquetaValor(anchoCaja, 'EMISIÓN:', LABEL_TIPO_EMISION[comprobante.tipoEmision], 0.35));
  lineas.push({ texto: 'CLAVE DE ACCESO', tamano: TAMANO_TITULO });

  // Código de barras Code 128 (lo que imprime la maqueta) y/o QR (alternativa
  // heredada de v0.2.0, ver `OpcionesFormatoRide.incluirQr`). Ambos van en un
  // `espaciador` con `dibujar`: reservan su alto en la MEDIDA de la caja, así
  // que `medirComprobante` sigue devolviendo el alto real y `asegurarEspacio`
  // no puede quedarse corto.
  if (codigoBarras) {
    lineas.push({
      texto: '',
      espaciador: ALTURA_CODIGO_BARRAS + ESPACIO_LINEA,
      dibujar: (x, y, ancho) =>
        dibujarCode128(doc, comprobante.claveAcceso, { x, y, ancho, alto: ALTURA_CODIGO_BARRAS }),
    });
  }
  if (qr) {
    lineas.push({
      texto: '',
      espaciador: QR_LADO + ESPACIO_LINEA,
      dibujar: (x, y, ancho) =>
        doc.image(qr, x + (ancho - QR_LADO) / 2, y, { width: QR_LADO, height: QR_LADO }),
    });
  }

  // Los 49 dígitos, centrados bajo el código de barras. `ajustar` impide que
  // pdfkit los parta en dos líneas cuando la columna es angosta: no hay
  // espacios donde cortar, así que se encoge la fuente en vez de romper el
  // número (misma garantía que en la columna `Cant.` del detalle).
  lineas.push({ texto: comprobante.claveAcceso, tamano: TAMANO_TABLA, alineacion: 'center', ajustar: true });
  return lineas;
}

/** Alto real que ocupará {@link drawComprobante} en `ancho`. Para `asegurarEspacio`, antes de dibujar. */
export function medirComprobante(
  doc: PDFKit.PDFDocument,
  comprobante: ComprobanteRide,
  ancho: number,
  hayQr: boolean,
  codigoBarras = true,
): number {
  return medirCaja(doc, lineasComprobante(doc, comprobante, ancho, hayQr ? FALSO_QR : undefined, codigoBarras), ancho);
}

/**
 * Buffer vacío que representa "hay QR" al MEDIR: `lineasComprobante` solo
 * necesita saber si reservar el hueco, no el PNG. Evita que `medirComprobante`
 * tenga que recibir el buffer real (los 5 renderizadores de Task 2 le pasan un
 * booleano) manteniendo una sola función que genera las líneas — medir y
 * dibujar no pueden divergir.
 */
const FALSO_QR = Buffer.alloc(0);

/** Separación horizontal entre las dos columnas de la cabecera. */
const SEPARACION_COLUMNAS = 8;

/** Contenido de la cabecera de dos columnas del Anexo 2. */
export interface CabeceraRide {
  emisor: EmisorRide;
  comprobante: ComprobanteRide;
  /** PNG del QR ya generado (ver `qr.ts`), si el consumidor pidió `incluirQr`. */
  qr?: Buffer;
  /** Si se dibuja el código de barras Code 128 de la clave de acceso. @default true */
  codigoBarras?: boolean;
}

/**
 * Cabecera completa del RIDE: columna izquierda (logo + caja del emisor) y
 * columna derecha (caja del comprobante con el código de barras), a la MISMA
 * altura, tal como la maqueta del Anexo 2.
 *
 * Es el bloque que los 6 `*.ride.ts` consumen: reparte el ancho en dos mitades
 * iguales, mide las dos columnas ANTES de dibujar, reserva el máximo con
 * {@link asegurarEspacio} y pasa ese máximo como `altoMinimo` a ambas cajas
 * para que cierren su borde al mismo `y`. Sin esto, cada `*.ride.ts` tenía que
 * repetir el reparto y las dos cajas terminaban a alturas distintas según
 * cuántos campos opcionales trajera el documento.
 */
export function drawCabecera(doc: PDFKit.PDFDocument, cabecera: CabeceraRide, area: AreaRide): number {
  const { anchoIzquierda, anchoDerecha } = anchosCabecera(area.width);
  const codigoBarras = cabecera.codigoBarras ?? true;

  const altoIzquierda = medirEmisor(doc, cabecera.emisor, anchoIzquierda);
  const altoDerecha = medirComprobante(doc, cabecera.comprobante, anchoDerecha, cabecera.qr !== undefined, codigoBarras);
  const alto = Math.max(altoIzquierda, altoDerecha);

  const y = asegurarEspacio(doc, area.y, alto);
  const abajoIzquierda = drawEmisor(doc, cabecera.emisor, { x: area.x, y, width: anchoIzquierda }, alto);
  const abajoDerecha = drawComprobante(
    doc,
    cabecera.comprobante,
    { x: area.x + anchoIzquierda + SEPARACION_COLUMNAS, y, width: anchoDerecha },
    cabecera.qr,
    codigoBarras,
    alto,
  );
  return Math.max(abajoIzquierda, abajoDerecha);
}

/** Alto real que ocupará {@link drawCabecera} en `ancho`. Para `asegurarEspacio`, antes de dibujar. */
export function medirCabecera(doc: PDFKit.PDFDocument, cabecera: CabeceraRide, ancho: number): number {
  const { anchoIzquierda, anchoDerecha } = anchosCabecera(ancho);
  return Math.max(
    medirEmisor(doc, cabecera.emisor, anchoIzquierda),
    medirComprobante(doc, cabecera.comprobante, anchoDerecha, cabecera.qr !== undefined, cabecera.codigoBarras ?? true),
  );
}

/** Reparto en dos mitades iguales del ancho de la cabecera, descontando la separación. */
function anchosCabecera(ancho: number): { anchoIzquierda: number; anchoDerecha: number } {
  const anchoIzquierda = Math.floor((ancho - SEPARACION_COLUMNAS) / 2);
  return { anchoIzquierda, anchoDerecha: ancho - anchoIzquierda - SEPARACION_COLUMNAS };
}

/**
 * Bloque comprador: razón social o nombres, identificación, fecha de
 * emisión, dirección y guía de remisión (los últimos dos, si existen).
 * `etiquetaSujeto` es lo que Task 2 cambia para reutilizar este mismo bloque
 * como "Proveedor" (liquidación de compra), "Sujeto Retenido" (retención) o
 * "Destinatario" (guía de remisión).
 */
export function drawComprador(doc: PDFKit.PDFDocument, comprador: CompradorRide, area: AreaRide): number {
  return drawBandaSujeto(doc, filasComprador(comprador), area, tituloComprador(comprador));
}

/**
 * Título del bloque, ya en mayúsculas ("PROVEEDOR", "DESTINATARIO", ...), o
 * `undefined` para la factura: la banda del comprador de la maqueta (página
 * 56) NO lleva título — arranca directamente en `Razón Social / Nombres y
 * Apellidos:`. Los otros comprobantes sí lo pasan explícitamente para
 * distinguir a quién describe la banda.
 */
function tituloComprador(comprador: CompradorRide): string | undefined {
  return comprador.etiquetaSujeto?.toUpperCase();
}

/** Un par etiqueta (negrita) + valor dentro de la banda del sujeto. */
export interface ParBanda {
  etiqueta: string;
  valor: string;
}

/** Una fila de la banda: hasta dos pares, izquierda y derecha. */
export interface FilaBanda {
  izquierda: ParBanda;
  derecha?: ParBanda;
}

/** Reparto horizontal de las 4 columnas de una fila de banda (etiqueta/valor × izquierda/derecha). */
const FRACCIONES_BANDA = [0.32, 0.3, 0.14, 0.24] as const;

/**
 * Banda del sujeto: caja con borde a TODO EL ANCHO, con filas de hasta dos
 * pares `etiqueta` (negrita) + `valor`, como la maqueta del Anexo 2. Cada fila
 * es una unidad indivisible (una sola `LineaCaja` con 4 columnas), así que una
 * etiqueta nunca se separa de su valor ni queda pisada por la fila siguiente.
 *
 * Punto de reuso para Task 2: nota de crédito (`Comprobante que se modifica`),
 * liquidación de compra (`Nombres y Apellidos:` / `Identificación:` /
 * `Fecha Emision:` / `Dirección:`) y guía de remisión arman sus propias
 * `FilaBanda[]` con las etiquetas literales de SU maqueta.
 */
export function drawBandaSujeto(
  doc: PDFKit.PDFDocument,
  filas: FilaBanda[],
  area: AreaRide,
  titulo?: string,
): number {
  return dibujarCaja(doc, area, lineasBanda(filas, area.width, titulo), { titulo });
}

/** Alto real que ocupará {@link drawBandaSujeto} en `ancho`. Para `asegurarEspacio`, antes de dibujar. */
export function medirBandaSujeto(
  doc: PDFKit.PDFDocument,
  filas: FilaBanda[],
  ancho: number,
  titulo?: string,
): number {
  return medirCaja(doc, lineasBanda(filas, ancho, titulo), ancho);
}

/** Convierte las filas de la banda en `LineaCaja` de 4 columnas. */
function lineasBanda(filas: FilaBanda[], anchoArea: number, titulo?: string): LineaCaja[] {
  const anchoCaja = anchoArea - PADDING_CAJA * 2;
  const anchos = FRACCIONES_BANDA.map((f) => Math.floor(anchoCaja * f));
  anchos[3] = anchoCaja - anchos[0] - anchos[1] - anchos[2];

  const lineas: LineaCaja[] = titulo ? [{ texto: titulo, negrita: true, tamano: TAMANO_TITULO }] : [];
  for (const fila of filas) {
    lineas.push({
      texto: fila.izquierda.etiqueta,
      columnas: [
        { texto: fila.izquierda.etiqueta, ancho: anchos[0], negrita: true },
        { texto: fila.izquierda.valor, ancho: anchos[1], ajustar: true },
        { texto: fila.derecha?.etiqueta ?? '', ancho: anchos[2], negrita: true },
        { texto: fila.derecha?.valor ?? '', ancho: anchos[3], ajustar: true },
      ],
    });
  }
  return lineas;
}

/**
 * Filas de la banda del comprador, con las etiquetas literales de la maqueta
 * de la factura.
 *
 * Los campos "obligatorios" del value object siguen blindados contra un string
 * vacío en tiempo de ejecución (auditoría "campos fiscales omitidos": una
 * etiqueta sin su valor —`Razón Social / Nombres y Apellidos:` sola— es peor
 * que no imprimir la línea, porque parece un dato faltante del documento en
 * vez de uno ausente en la fuente): un par sin valor no se emite, y una fila
 * sin ningún par se descarta entera.
 */
function filasComprador(comprador: CompradorRide): FilaBanda[] {
  // `tipoIdentificacion` (catálogo SRI "Tipos de Identificación") junto al
  // número: antes no lo leía ningún `*.ride.ts` (hallazgo "ALSO" de la
  // auditoría) aunque los 4 documentos que modelan un
  // `tipoIdentificacionComprador`/`Proveedor`/`SujetoRetenido` lo traen.
  const tipo = comprador.tipoIdentificacion
    ? ` (${LABEL_TIPO_IDENTIFICACION[comprador.tipoIdentificacion] ?? comprador.tipoIdentificacion})`
    : '';

  const pares: Array<[string, string | undefined]> = [
    ['Razón Social / Nombres y Apellidos:', noVacio(comprador.razonSocial) ? comprador.razonSocial : undefined],
    ['Identificación:', noVacio(comprador.identificacion) ? `${comprador.identificacion}${tipo}` : undefined],
    ['Fecha Emisión:', noVacio(comprador.fechaEmision) ? comprador.fechaEmision : undefined],
    ['Guía Remisión:', noVacio(comprador.guiaRemision) ? comprador.guiaRemision : undefined],
    ['Dirección:', noVacio(comprador.direccion) ? comprador.direccion : undefined],
  ];

  return emparejarFilas(pares);
}

/**
 * Reparte pares `[etiqueta, valor]` en filas de dos columnas, saltándose los
 * que no tienen valor. Devuelve una fila por cada dos pares presentes; el
 * último puede quedar solo en la columna izquierda.
 */
function emparejarFilas(pares: Array<[string, string | undefined]>): FilaBanda[] {
  const presentes = pares
    .filter((par): par is [string, string] => par[1] !== undefined)
    .map(([etiqueta, valor]) => ({ etiqueta, valor }));

  const filas: FilaBanda[] = [];
  for (let i = 0; i < presentes.length; i += 2) {
    filas.push({ izquierda: presentes[i], derecha: presentes[i + 1] });
  }
  return filas;
}

/** Alto real que ocupará {@link drawComprador} en `ancho`. Para `asegurarEspacio`, antes de dibujar. */
export function medirComprador(doc: PDFKit.PDFDocument, comprador: CompradorRide, ancho: number): number {
  return medirBandaSujeto(doc, filasComprador(comprador), ancho, tituloComprador(comprador));
}

export interface ColumnaTabla {
  header: string;
  width: number;
  align: 'left' | 'center' | 'right';
}

/** Opciones de composición de una tabla con borde. */
export interface OpcionesTabla {
  /**
   * Si se dibuja la fila de encabezado. `false` en las tablas de la maqueta
   * que no llevan cabecera (los totales del Anexo 2 son filas
   * `etiqueta | importe` a secas). @default true
   */
  conEncabezado?: boolean;
  /** Tamaño de fuente de las celdas. @default {@link TAMANO_TABLA} */
  tamano?: number;
  /** Si se dibujan las líneas verticales entre columnas. @default true */
  divisores?: boolean;
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
  specs: Array<[string, number, 'left' | 'center' | 'right']>,
): ColumnaTabla[] {
  // Los pesos se normalizan, así que no hace falta que sumen exactamente 1:
  // el detalle de la factura arma sus 12 columnas en tiempo de ejecución
  // (0 a 3 columnas `Detalle Adicional`, con o sin las de subsidio, según el
  // comprobante) y exigir que cada combinación sumara 1.00 a mano habría sido
  // una fuente de errores de redondeo silenciosos.
  const total = specs.reduce((s, [, peso]) => s + peso, 0);
  const widths = specs.map(([, peso]) => Math.floor((anchoTotal * peso) / total));
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
function especificacionDetalle(opciones: OpcionesTablaDetalles): Array<[string, number, 'left' | 'center' | 'right']> {
  const columnasExtra = opciones.detallesAdicionales ?? MAX_DETALLES_ADICIONALES;
  const specs: Array<[string, number, 'left' | 'center' | 'right']> = [
    ['Cod. Principal', 8.5, 'left'],
    ['Cod. Auxiliar', 7.5, 'left'],
    ['Cant', 6.5, 'right'],
    ['Descripción', 18.5, 'left'],
  ];
  for (let i = 0; i < columnasExtra; i++) {
    // 7 (y no menos): a menor peso, "Adicional" no cabe en el ancho útil de la
    // columna y pdfkit parte el encabezado a la mitad ("Adicion" / "al").
    specs.push(['Detalle Adicional', 7, 'left']);
  }
  specs.push(['Precio Unitario', 8, 'right']);
  if (opciones.subsidio !== false) {
    specs.push(['Subsidio', 6.5, 'right'], ['Precio Sin Subsidio', 7.5, 'right']);
  }
  specs.push(['Descuento', 7, 'right'], ['Precio Total', 9, 'right']);
  return specs;
}

/** Columnas `Detalle Adicional` de la maqueta de la factura (página 56). */
const MAX_DETALLES_ADICIONALES = 3;

/**
 * Tamaño de fuente del detalle. La maqueta imprime esta tabla notablemente más
 * pequeña que el resto del RIDE — con 12 columnas en A4 no hay alternativa —, y
 * {@link tamanoQueCabe} encoge además cada celda numérica que no quepa en una
 * línea, así que un importe nunca se parte por estrechez de columna.
 */
const TAMANO_DETALLE = 6.5;

/** Ajustes del detalle por tipo de comprobante (ver las maquetas del Anexo 2). */
export interface OpcionesTablaDetalles {
  /**
   * Cuántas columnas `Detalle Adicional` se dibujan. La factura y las notas
   * llevan 3 (páginas 56-58); la liquidación de compra, 1 (página 61).
   * @default 3
   */
  detallesAdicionales?: number;
  /**
   * Si se dibujan las columnas `Subsidio` y `Precio Sin Subsidio`. Presentes en
   * factura y liquidación de compra; ausentes en las notas de crédito/débito.
   * @default true
   */
  subsidio?: boolean;
}

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

/**
 * Celdas de una fila de detalle, en el mismo orden que
 * {@link especificacionDetalle}.
 *
 * Los `detallesAdicionales` van cada uno en su propia columna `Detalle
 * Adicional` (como en la maqueta) hasta agotar las columnas disponibles; los
 * que sobren se siguen imprimiendo bajo la descripción, en vez de perderse —
 * la Ficha Técnica permite hasta 3, pero el tipo `Detalle` acepta un
 * `Record<string, string>` de cualquier tamaño y descartar un dato del
 * documento no es una opción.
 *
 * `Subsidio` y `Precio Sin Subsidio`: los tipos de `documents/` no modelan
 * subsidios (no hay de dónde sacarlos), así que se imprime el único valor
 * aritméticamente correcto en su ausencia — subsidio `0.00` y precio sin
 * subsidio igual al precio total. No es un dato inventado: es la fila que
 * describe un detalle sin subsidio.
 */
function celdasDetalle(d: Detalle, opciones: OpcionesTablaDetalles): string[] {
  const columnasExtra = opciones.detallesAdicionales ?? MAX_DETALLES_ADICIONALES;
  const extras = Object.entries(d.detallesAdicionales ?? {}).map(([k, v]) => `${k}: ${v}`);
  const enColumnas = extras.slice(0, columnasExtra);
  const sobrantes = extras.slice(columnasExtra);

  const celdas = [
    d.codigoPrincipal ?? '',
    d.codigoAuxiliar ?? '',
    formatCantidadPrecision(d.cantidad),
    [d.descripcion, ...sobrantes].join('\n'),
    ...Array.from({ length: columnasExtra }, (_, i) => enColumnas[i] ?? ''),
    formatCantidadPrecision(d.precioUnitario),
  ];
  if (opciones.subsidio !== false) {
    celdas.push('0.00', formatMonto(d.precioTotalSinImpuesto, 2));
  }
  celdas.push(formatMonto(d.descuento, 2), formatMonto(d.precioTotalSinImpuesto, 2));
  return celdas;
}

/** Deja `doc` con la fuente de una fila de tabla (el encabezado va en negrita). */
function fuenteFilaTabla(doc: PDFKit.PDFDocument, esEncabezado: boolean, tamano: number): void {
  doc.font(esEncabezado ? FUENTE_NEGRITA : FUENTE_NORMAL).fontSize(tamano).fillColor(COLOR_TEXTO);
}

/**
 * Tamaño de fuente efectivo de cada celda: el base, salvo que la celda sea un
 * token indivisible (un importe, una cantidad a granel) más ancho que su
 * columna — entonces se encoge hasta que quepa en UNA línea.
 *
 * Es la garantía de "`cantidad`/`precioUnitario` a 6 decimales no se parten a
 * la mitad" trasladada del ancho de columna al tamaño de fuente: la maqueta
 * del Anexo 2 fija 12 columnas en el detalle de la factura y ninguna reparte
 * los ≈ 52pt que `999999.999999` necesita a 7.5pt. Ver {@link tamanoQueCabe}.
 */
function tamanosCelda(
  doc: PDFKit.PDFDocument,
  columnas: ColumnaTabla[],
  celdas: string[],
  esEncabezado: boolean,
  base: number,
): number[] {
  fuenteFilaTabla(doc, esEncabezado, base);
  return columnas.map((col, i) => tamanoQueCabe(doc, celdas[i], col.width - PADDING_CELDA * 2, base));
}

/** Altura que ocupará la fila (la celda más alta, según el wrap de cada columna) más el padding de celda. */
function alturaFilaTabla(
  doc: PDFKit.PDFDocument,
  columnas: ColumnaTabla[],
  celdas: string[],
  esEncabezado: boolean,
  base: number,
): number {
  const tamanos = tamanosCelda(doc, columnas, celdas, esEncabezado, base);
  const alturas = columnas.map((col, i) => {
    doc.fontSize(tamanos[i]);
    return doc.heightOfString(celdas[i], { width: col.width - PADDING_CELDA * 2 });
  });
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
  opciones: OpcionesTabla = {},
): number {
  const base = opciones.tamano ?? TAMANO_TABLA;
  const alto = alturaFilaTabla(doc, columnas, celdas, esEncabezado, base);
  const anchoTotal = columnas.reduce((s, c) => s + c.width, 0);

  if (esEncabezado) {
    // La maqueta del Anexo 2 imprime el encabezado en blanco (solo borde y
    // negrita centrada), no sobre un fondo gris.
    doc.rect(x, y, anchoTotal, alto).fillAndStroke(COLOR_ENCABEZADO_TABLA, COLOR_TEXTO);
    doc.fillColor(COLOR_TEXTO);
  }

  const tamanos = tamanosCelda(doc, columnas, celdas, esEncabezado, base);
  let cx = x;
  for (let i = 0; i < columnas.length; i++) {
    fuenteFilaTabla(doc, esEncabezado, tamanos[i]);
    escribirTexto(doc, celdas[i], cx + PADDING_CELDA, y + PADDING_CELDA, {
      width: columnas[i].width - PADDING_CELDA * 2,
      // Los encabezados van centrados en la maqueta del Anexo 2, sea cual sea
      // la alineación de los datos de esa columna.
      align: esEncabezado ? 'center' : columnas[i].align,
    });
    cx += columnas[i].width;
  }

  doc.lineWidth(0.5).strokeColor(COLOR_TEXTO);
  if (!esEncabezado) {
    doc.rect(x, y, anchoTotal, alto).stroke();
  }
  if (opciones.divisores !== false) {
    cx = x;
    for (const col of columnas.slice(0, -1)) {
      cx += col.width;
      doc.moveTo(cx, y).lineTo(cx, y + alto).stroke();
    }
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
  opciones: OpcionesTabla,
): number {
  const base = opciones.tamano ?? TAMANO_TABLA;
  const conEncabezado = opciones.conEncabezado !== false;

  /** Reabre la tabla al principio de una página nueva, repitiendo el encabezado si lo hay. */
  const abrirPagina = (): number => {
    doc.addPage();
    const yTop = doc.page.margins.top;
    return conEncabezado ? dibujarFilaTabla(doc, columnas, encabezados, x, yTop, true, opciones) : yTop;
  };

  // Arranca en una página nueva (salvo que la actual esté recién abierta con
  // solo el encabezado): así todas las sub-filas tienen el mismo presupuesto
  // de alto y el reparto no depende de dónde venía la tabla.
  let yFila = y;
  if (yFila > doc.page.margins.top + altoEncabezado) {
    yFila = abrirPagina();
  }

  const presupuesto = alturaUtilPagina(doc) - altoEncabezado - PADDING_CELDA * 2;
  fuenteFilaTabla(doc, false, base);
  const trozos = columnas.map((col, i) =>
    partirTextoPorAltura(doc, celdas[i], col.width - PADDING_CELDA * 2, presupuesto),
  );
  const subFilas = Math.max(...trozos.map((t) => t.length));

  for (let s = 0; s < subFilas; s++) {
    if (s > 0) {
      yFila = abrirPagina();
    }
    yFila = dibujarFilaTabla(
      doc,
      columnas,
      trozos.map((t) => t[s] ?? ''),
      x,
      yFila,
      false,
      opciones,
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
  opciones: OpcionesTabla = {},
): number {
  const base = opciones.tamano ?? TAMANO_TABLA;
  const conEncabezado = opciones.conEncabezado !== false;
  const encabezados = columnas.map((c) => c.header);
  const altoEncabezado = conEncabezado ? alturaFilaTabla(doc, columnas, encabezados, true, base) : 0;

  // A diferencia de los bloques con borde, la tabla reserva su propio espacio:
  // ya es dueña de su paginación fila a fila, así que los `*.ride.ts` no
  // necesitan (ni pueden) adivinar su alto. Reserva encabezado + primera fila
  // para no dejar nunca un encabezado solo al pie de una página.
  const altoPrimeraFila = filas.length > 0 ? alturaFilaTabla(doc, columnas, filas[0], false, base) : 0;
  let y = asegurarEspacio(doc, area.y, Math.min(altoEncabezado + altoPrimeraFila, alturaUtilPagina(doc)));
  if (conEncabezado) {
    y = dibujarFilaTabla(doc, columnas, encabezados, area.x, y, true, opciones);
  }

  for (const fila of filas) {
    const alto = alturaFilaTabla(doc, columnas, fila, false, base);

    if (y + alto <= limiteInferior(doc)) {
      y = dibujarFilaTabla(doc, columnas, fila, area.x, y, false, opciones);
      continue;
    }

    if (altoEncabezado + alto <= alturaUtilPagina(doc)) {
      // Cabe entera en una página: salta y repite el encabezado antes de la fila.
      doc.addPage();
      y = doc.page.margins.top;
      if (conEncabezado) {
        y = dibujarFilaTabla(doc, columnas, encabezados, area.x, y, true, opciones);
      }
      y = dibujarFilaTabla(doc, columnas, fila, area.x, y, false, opciones);
      continue;
    }

    y = dibujarFilaEnVariasPaginas(doc, columnas, encabezados, fila, area.x, y, altoEncabezado, opciones);
  }

  return y;
}

/**
 * Alto que ocupará {@link drawTablaGenerica} si cabe entera en la página. Lo
 * necesita {@link drawPie} para reservar el alto de sus dos columnas ANTES de
 * dibujar ninguna de las dos — la tabla sabe paginarse sola, pero si lo hace a
 * media columna, la columna de al lado se dibujaría en la página nueva con el
 * `y` de la vieja (la "caja fantasma" que documenta {@link drawBloquesEnFila}).
 */
export function medirTablaGenerica(
  doc: PDFKit.PDFDocument,
  columnas: ColumnaTabla[],
  filas: string[][],
  opciones: OpcionesTabla = {},
): number {
  const base = opciones.tamano ?? TAMANO_TABLA;
  const conEncabezado = opciones.conEncabezado !== false;
  let alto = conEncabezado ? alturaFilaTabla(doc, columnas, columnas.map((c) => c.header), true, base) : 0;
  for (const fila of filas) {
    alto += alturaFilaTabla(doc, columnas, fila, false, base);
  }
  return alto;
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
export function drawTablaDetalles(
  doc: PDFKit.PDFDocument,
  detalles: Detalle[],
  area: AreaRide,
  opciones: OpcionesTablaDetalles = {},
): number {
  const columnas = construirColumnas(area.width, especificacionDetalle(opciones));
  const filas = detalles.map((d) => celdasDetalle(d, opciones));
  return drawTablaGenerica(doc, columnas, filas, area, { tamano: TAMANO_DETALLE });
}

/** Agrupa los impuestos con `codigo` IVA por `codigoPorcentaje`, sumando `baseImponible` en centavos (nunca en float). */
function basesPorCodigoPorcentaje(impuestos: TotalImpuesto[]): Map<string, number> {
  const grupos = new Map<string, number>();
  for (const imp of impuestos) {
    if (imp.codigo !== CODIGO_IMPUESTO_IVA) continue;
    grupos.set(imp.codigoPorcentaje, (grupos.get(imp.codigoPorcentaje) ?? 0) + toCents(imp.baseImponible));
  }
  return grupos;
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
  const columnas = columnasTotales(area.width);
  let y = drawTablaGenerica(doc, columnas, filasTotales(totales), area, OPCIONES_TABLA_TOTALES);

  const subsidio = filasSubsidio(totales);
  if (subsidio.length > 0) {
    y += SEPARACION_SUBSIDIO;
    y = drawTablaGenerica(doc, columnasTotales(area.width), subsidio, { ...area, y }, OPCIONES_TABLA_SUBSIDIO);
  }
  return y;
}

/** La tabla de totales del Anexo 2 no lleva fila de encabezado: son filas `etiqueta | importe`. */
const OPCIONES_TABLA_TOTALES: OpcionesTabla = { conEncabezado: false, tamano: TAMANO_TABLA };

/**
 * El recuadro de subsidios va aparte, separado de la tabla de totales, en
 * negrita y a mayor tamaño, y SIN línea vertical entre etiqueta e importe
 * (maqueta de la página 56).
 */
const OPCIONES_TABLA_SUBSIDIO: OpcionesTabla = { conEncabezado: false, tamano: TAMANO_TEXTO, divisores: false };

/** Separación vertical entre la tabla de totales y el recuadro de subsidios. */
const SEPARACION_SUBSIDIO = 6;

/** Reparto etiqueta/importe de la tabla de totales. */
function columnasTotales(ancho: number): ColumnaTabla[] {
  return construirColumnas(ancho, [
    ['', 0.72, 'left'],
    ['', 0.28, 'right'],
  ]);
}

/** Etiquetas por defecto: las de la maqueta de la factura. */
const ETIQUETAS_TOTALES_FACTURA: EtiquetasTotales = {
  subtotalCero: 'SUBTOTAL IVA 0%',
  subtotalNoObjeto: 'SUBTOTAL NO OBJETO IVA',
  subtotalExento: 'SUBTOTAL EXENTO IVA',
  subtotalSinImpuestos: 'SUBTOTAL SIN IMPUESTOS',
  descuento: 'DESCUENTO',
  valorTotal: 'VALOR TOTAL',
};

/** `codigoPorcentaje` de las tarifas que tienen su propia fila fija en la maqueta. */
const CODIGO_PORCENTAJE_CERO = '0';
const CODIGO_PORCENTAJE_NO_OBJETO = '6';
const CODIGO_PORCENTAJE_EXENTO = '7';

/**
 * Filas de la tabla de totales, en el orden EXACTO de la maqueta del Anexo 2.
 *
 * Las cuatro filas de subtotal por tarifa (`SUBTOTAL 15%`, `SUBTOTAL IVA 0%`,
 * `SUBTOTAL NO OBJETO IVA`, `SUBTOTAL EXENTO IVA`) son fijas: si el documento
 * no trae esa tarifa, se imprime `0.00` en vez de omitir la fila — es lo que
 * hace la maqueta, y lo mismo que ya hacía la línea de IVA.
 *
 * El porcentaje NO está escrito a fuego: sale del `codigoPorcentaje` del propio
 * documento (las maquetas son de 2017 y dicen 12%; el IVA vigente es del 15%).
 */
function filasTotales(totales: TotalesRide): string[][] {
  const etiquetas = { ...ETIQUETAS_TOTALES_FACTURA, ...totales.etiquetas };
  const bases = basesPorCodigoPorcentaje(totales.impuestos);
  const filas: string[][] = [];

  /** Consume la base de `codigoPorcentaje` (0.00 si no viene) y emite su fila. */
  const filaSubtotal = (etiqueta: string, codigoPorcentaje: string): void => {
    const cents = bases.get(codigoPorcentaje);
    bases.delete(codigoPorcentaje);
    filas.push([etiqueta, fromCents(cents ?? 0)]);
  };

  // Tarifas con porcentaje (12%, 14%, 15%, ...): una fila por cada una
  // presente; si no hay ninguna, una fila `SUBTOTAL <tarifa vigente>` en 0.00
  // sería inventarse una tarifa, así que en ese caso no se emite ninguna y el
  // subtotal vive en las tres filas fijas de abajo.
  for (const [codigoPorcentaje, cents] of [...bases]) {
    if (
      codigoPorcentaje === CODIGO_PORCENTAJE_CERO ||
      codigoPorcentaje === CODIGO_PORCENTAJE_NO_OBJETO ||
      codigoPorcentaje === CODIGO_PORCENTAJE_EXENTO
    ) {
      continue;
    }
    bases.delete(codigoPorcentaje);
    filas.push([`SUBTOTAL ${LABEL_CODIGO_PORCENTAJE[codigoPorcentaje] ?? codigoPorcentaje}`, fromCents(cents)]);
  }

  filaSubtotal(etiquetas.subtotalCero, CODIGO_PORCENTAJE_CERO);
  filaSubtotal(etiquetas.subtotalNoObjeto, CODIGO_PORCENTAJE_NO_OBJETO);
  filaSubtotal(etiquetas.subtotalExento, CODIGO_PORCENTAJE_EXENTO);

  filas.push([etiquetas.subtotalSinImpuestos, formatMonto(totales.totalSinImpuestos, 2)]);

  if (totales.totalDescuento !== undefined) {
    filas.push([etiquetas.descuento, formatMonto(totales.totalDescuento, 2)]);
  }

  const grupos = agruparValorPorCodigo(totales.impuestos);

  // ICE: línea opcional, solo si el código está presente en `impuestos`
  // (antes era "solo si la suma es > 0" — un ICE de '0.00' explícito en el
  // documento ahora también se imprime, en vez de desaparecer).
  const ice = grupos.get(CODIGO_IMPUESTO_ICE);
  if (ice !== undefined) {
    filas.push(['ICE', fromCents(ice)]);
  }

  // IVA: línea fija del layout SRI — se imprime siempre, en 0.00 si el
  // documento no trae ningún impuesto con este código. La tarifa del rótulo
  // sale del documento; con varias tarifas distintas en el mismo comprobante
  // no hay una sola que poner, así que se deja `IVA` a secas.
  filas.push([`IVA${sufijoTarifaIva(totales.impuestos)}`, fromCents(grupos.get(CODIGO_IMPUESTO_IVA) ?? 0)]);

  // Cualquier otro código de impuesto presente (IRBPNR y cualquier código
  // futuro no catalogado): se imprime SIEMPRE que esté presente, con su
  // etiqueta conocida o, a falta de ella, una genérica que incluye el
  // código crudo — nunca se descarta.
  for (const [codigo, cents] of grupos) {
    if (codigo === CODIGO_IMPUESTO_ICE || codigo === CODIGO_IMPUESTO_IVA) continue;
    filas.push([LABEL_IMPUESTO[codigo] ?? `OTRO IMPUESTO (CÓDIGO ${codigo})`, fromCents(cents)]);
  }

  // `PROPINA` es fila fija de la maqueta de la factura; los comprobantes que
  // no la contemplan (notas, liquidación) no ponen `conPropina`.
  if (totales.conPropina) {
    filas.push(['PROPINA', formatMonto(totales.propina ?? '0.00', 2)]);
  } else if (totales.propina) {
    filas.push(['PROPINA', formatMonto(totales.propina, 2)]);
  }

  if (noVacio(totales.moneda)) {
    filas.push(['MONEDA', totales.moneda]);
  }

  filas.push([etiquetas.valorTotal, formatMonto(totales.importeTotal, 2)]);
  return filas;
}

/**
 * Filas del recuadro de subsidios (solo factura). Sin subsidios en el
 * documento, `VALOR TOTAL SIN SUBSIDIO` coincide con el importe total y el
 * ahorro es 0.00 — igual que las columnas `Subsidio`/`Precio Sin Subsidio` del
 * detalle, no es un dato inventado sino la lectura correcta de un comprobante
 * sin subsidio.
 */
function filasSubsidio(totales: TotalesRide): string[][] {
  if (!totales.conSubsidio) return [];
  return [
    ['VALOR TOTAL SIN SUBSIDIO', formatMonto(totales.importeTotal, 2)],
    ['AHORRO POR SUBSIDIO (incluye IVA cuando corresponda)', '0.00'],
  ];
}

/** `" 15%"` si todos los impuestos de IVA con tarifa comparten porcentaje; `""` si hay varias o ninguna. */
function sufijoTarifaIva(impuestos: TotalImpuesto[]): string {
  const tarifas = new Set(
    impuestos
      .filter(
        (imp) =>
          imp.codigo === CODIGO_IMPUESTO_IVA &&
          imp.codigoPorcentaje !== CODIGO_PORCENTAJE_CERO &&
          imp.codigoPorcentaje !== CODIGO_PORCENTAJE_NO_OBJETO &&
          imp.codigoPorcentaje !== CODIGO_PORCENTAJE_EXENTO,
      )
      .map((imp) => LABEL_CODIGO_PORCENTAJE[imp.codigoPorcentaje] ?? imp.codigoPorcentaje),
  );
  return tarifas.size === 1 ? ` ${[...tarifas][0]}` : '';
}

/** Alto real que ocupará {@link drawTotales} en `ancho`. Para `asegurarEspacio`, antes de dibujar. */
export function medirTotales(doc: PDFKit.PDFDocument, totales: TotalesRide, ancho: number): number {
  const columnas = columnasTotales(ancho);
  let alto = medirTablaGenerica(doc, columnas, filasTotales(totales), OPCIONES_TABLA_TOTALES);
  const subsidio = filasSubsidio(totales);
  if (subsidio.length > 0) {
    alto += SEPARACION_SUBSIDIO + medirTablaGenerica(doc, columnas, subsidio, OPCIONES_TABLA_SUBSIDIO);
  }
  return alto;
}

/**
 * Bloque formas de pago: la tabla `Forma de Pago | Valor` de la maqueta, con
 * encabezado propio. `plazo` y `unidadTiempo` se anexan a la descripción de la
 * forma de pago (la maqueta no les da columna, pero son datos del documento).
 */
export function drawFormasPago(doc: PDFKit.PDFDocument, pagos: Pago[], area: AreaRide): number {
  return drawTablaGenerica(doc, columnasFormasPago(area.width), filasFormasPago(pagos), area);
}

/** Reparto `Forma de Pago | Valor` de la tabla de pagos. */
function columnasFormasPago(ancho: number): ColumnaTabla[] {
  return construirColumnas(ancho, [
    ['Forma de Pago', 0.72, 'left'],
    ['Valor', 0.28, 'right'],
  ]);
}

/** Filas de la tabla de formas de pago. */
function filasFormasPago(pagos: Pago[]): string[][] {
  return pagos.map((pago) => {
    const partes = [LABEL_FORMA_PAGO[pago.formaPago] ?? pago.formaPago];
    if (pago.plazo) partes.push(`Plazo: ${pago.plazo}`);
    if (pago.unidadTiempo) partes.push(`Unidad de Tiempo: ${pago.unidadTiempo}`);
    return [partes.join(' — '), formatMonto(pago.total, 2)];
  });
}

/** Alto real que ocupará {@link drawFormasPago} en `ancho`. Para `asegurarEspacio`, antes de dibujar. */
export function medirFormasPago(doc: PDFKit.PDFDocument, pagos: Pago[], ancho: number): number {
  return medirTablaGenerica(doc, columnasFormasPago(ancho), filasFormasPago(pagos));
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
  altoMinimo?: number,
): number {
  const lineas = lineasInfoAdicional(infoAdicional, area.width);
  if (lineas.length === 0) {
    return area.y;
  }
  return dibujarCaja(doc, area, lineas, { titulo: TITULO_INFO_ADICIONAL, altoMinimo });
}

const TITULO_INFO_ADICIONAL = 'Información Adicional';

/**
 * Líneas del bloque información adicional; vacío (sin ni siquiera el
 * título) si no hay campos con contenido real. Descarta los campos con
 * `valor` vacío/solo espacios ANTES de decidir si hay algo que dibujar —
 * auditoría "campos fiscales omitidos": un `campoAdicional` con valor `''`
 * imprimía `Clave:` sin nada después, un `:` suelto que parece un dato
 * faltante del documento en vez de un campo vacío en la fuente.
 */
function lineasInfoAdicional(infoAdicional: Record<string, string> | undefined, anchoArea: number): LineaCaja[] {
  const entradas = infoAdicional
    ? Object.entries(infoAdicional).filter(([, valor]) => noVacio(valor))
    : [];
  if (entradas.length === 0) {
    return [];
  }
  const anchoCaja = anchoArea - PADDING_CAJA * 2;
  const anchoClave = Math.floor(anchoCaja * 0.4);
  return [
    { texto: TITULO_INFO_ADICIONAL, negrita: true, tamano: TAMANO_TITULO },
    { texto: '', espaciador: ESPACIO_LINEA * 2 },
    // Clave y valor en dos columnas, como en la maqueta (`Dirección` /
    // `Salinas y Santiago 123456789`), no concatenados con dos puntos.
    ...entradas.map(([clave, valor]) => ({
      texto: `${clave}: ${valor}`,
      columnas: [
        { texto: clave, ancho: anchoClave },
        { texto: valor, ancho: anchoCaja - anchoClave },
      ],
    })),
  ];
}

/** Alto real que ocupará {@link drawInfoAdicional} en `ancho` (0 si no hay campos). */
export function medirInfoAdicional(
  doc: PDFKit.PDFDocument,
  infoAdicional: Record<string, string> | undefined,
  ancho: number,
): number {
  const lineas = lineasInfoAdicional(infoAdicional, ancho);
  return lineas.length === 0 ? 0 : medirCaja(doc, lineas, ancho);
}

/** Contenido del pie de dos columnas del Anexo 2. */
export interface ContenidoPie {
  /** Caja `Información Adicional` (columna izquierda, arriba). */
  infoAdicional?: Record<string, string>;
  /** Tabla `Forma de Pago | Valor` (columna izquierda, abajo). */
  pagos?: Pago[];
  /** Tabla de totales y recuadro de subsidios (columna derecha). */
  totales?: TotalesRide;
}

/** Fracción del ancho que ocupa la columna izquierda del pie (info adicional + formas de pago). */
const FRACCION_PIE_IZQUIERDA = 0.6;
/** Separación vertical entre la caja de información adicional y la tabla de formas de pago. */
const SEPARACION_PIE = 8;

/**
 * Pie del RIDE en DOS columnas, como la maqueta del Anexo 2: a la izquierda la
 * caja `Información Adicional` con la tabla `Forma de Pago | Valor` debajo; a
 * la derecha la tabla de totales. Hasta v0.2.0 estos tres bloques se apilaban a
 * lo ancho, que es la diferencia visual más evidente contra un RIDE real.
 *
 * Las dos columnas se miden ANTES de dibujar y se reserva el máximo con
 * {@link drawBloquesEnFila}: si el pie no cabe en lo que queda de página, las
 * dos columnas saltan JUNTAS. Sin eso, la tabla de totales (que sabe paginarse
 * sola, fila a fila) podría saltar a media columna y dejar la de la izquierda
 * dibujándose en la página nueva con el `y` de la vieja.
 */
export function drawPie(doc: PDFKit.PDFDocument, contenido: ContenidoPie, area: AreaRide): number {
  const { anchoIzquierda, anchoDerecha } = anchosPie(area.width);
  const xDerecha = area.x + anchoIzquierda + SEPARACION_COLUMNAS;

  const altoInfo = medirInfoAdicional(doc, contenido.infoAdicional, anchoIzquierda);
  const altoPagos = contenido.pagos?.length ? medirFormasPago(doc, contenido.pagos, anchoIzquierda) : 0;
  const altoIzquierda = altoInfo + (altoInfo > 0 && altoPagos > 0 ? SEPARACION_PIE : 0) + altoPagos;
  const altoDerecha = contenido.totales ? medirTotales(doc, contenido.totales, anchoDerecha) : 0;

  return drawBloquesEnFila(
    doc,
    area.y,
    altoIzquierda,
    altoDerecha,
    (yFila) => {
      let y = yFila;
      if (altoInfo > 0) {
        // La caja de información adicional absorbe el hueco que le sobra a la
        // columna izquierda: en la maqueta queda deliberadamente alta y medio
        // vacía, y su borde inferior casi toca la tabla de formas de pago, que
        // a su vez termina a la altura del recuadro de subsidios. Sin esto, el
        // pie deja un vacío evidente bajo la columna izquierda.
        const altoCaja = altoInfo + Math.max(0, altoDerecha - altoIzquierda);
        y = drawInfoAdicional(doc, contenido.infoAdicional, { x: area.x, y, width: anchoIzquierda }, altoCaja);
        if (altoPagos > 0) y += SEPARACION_PIE;
      }
      if (altoPagos > 0) {
        y = drawFormasPago(doc, contenido.pagos as Pago[], { x: area.x, y, width: anchoIzquierda });
      }
      return y;
    },
    (yFila) =>
      contenido.totales
        ? drawTotales(doc, contenido.totales, { x: xDerecha, y: yFila, width: anchoDerecha })
        : yFila,
    SEPARACION_PIE,
  );
}

/** Alto real que ocupará {@link drawPie} en `ancho`. Para `asegurarEspacio`, antes de dibujar. */
export function medirPie(doc: PDFKit.PDFDocument, contenido: ContenidoPie, ancho: number): number {
  const { anchoIzquierda, anchoDerecha } = anchosPie(ancho);
  const altoInfo = medirInfoAdicional(doc, contenido.infoAdicional, anchoIzquierda);
  const altoPagos = contenido.pagos?.length ? medirFormasPago(doc, contenido.pagos, anchoIzquierda) : 0;
  return Math.max(
    altoInfo + (altoInfo > 0 && altoPagos > 0 ? SEPARACION_PIE : 0) + altoPagos,
    contenido.totales ? medirTotales(doc, contenido.totales, anchoDerecha) : 0,
  );
}

/** Reparto 60/40 del ancho del pie, descontando la separación entre columnas. */
function anchosPie(ancho: number): { anchoIzquierda: number; anchoDerecha: number } {
  const anchoIzquierda = Math.floor((ancho - SEPARACION_COLUMNAS) * FRACCION_PIE_IZQUIERDA);
  return { anchoIzquierda, anchoDerecha: ancho - anchoIzquierda - SEPARACION_COLUMNAS };
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
