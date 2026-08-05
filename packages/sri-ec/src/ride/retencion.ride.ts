import { TipoEmision } from '../catalogs/index.js';
import type { DocSustento, Retencion } from '../documents/index.js';
// Desde `'sri-ec'` (no `'../utils/money.js'`), ver la nota en `blocks.ts`.
import { formatMonto, fromCents, toCents } from 'sri-ec';
import {
  asegurarEspacio,
  construirColumnas,
  drawBloqueTexto,
  drawBloquesEnFila,
  drawComprador,
  drawComprobante,
  drawEmisor,
  drawInfoAdicional,
  drawTablaGenerica,
  formaPagoLabel,
  formatNumeroComprobante,
  medirBloqueTexto,
  medirComprador,
  medirComprobante,
  medirEmisor,
  medirInfoAdicional,
  nombreDocumento,
} from './blocks.js';
import { crearDocumentoRide } from './pdf-doc.js';
import { generarQr } from './qr.js';
import type { ComprobanteRide, CompradorRide, EmisorRide, RideOptions } from './types.js';

/** Separación vertical entre bloques apilados. */
const ESPACIADO_BLOQUE = 10;
/** Proporción del ancho útil que ocupa la columna del emisor en la cabecera (el resto es "comprobante"). */
const PROPORCION_EMISOR = 0.55;

/**
 * Columnas de la tabla de documentos sustento: una fila de tabla por cada
 * `RetencionRow` dentro de cada `DocSustento`.
 *
 * `Comprobante` (0.115, no 0.1) y `Fecha Emisión` (0.125, no 0.11): hallazgo
 * confirmado del reviewer — con las fracciones originales, el ancho útil de
 * ambas columnas en A4 (a `TAMANO_TABLA` en negrita, el encabezado) era
 * menor que el texto del propio encabezado (`"Comprobante"` ≈ 48.6pt vs
 * ≈ 46pt útiles; `"Fecha Emisión"` ≈ 52.9pt vs ≈ 51pt útiles), así que
 * pdfkit partía el encabezado en dos líneas ("Comprobant" / "e"). Se
 * compensa restando de `Impuesto` (0.09), `Código` (0.08) y `%` (0.065) —
 * las tres tienen de sobra frente a su contenido real (`RENTA`/`IVA`/`ISD`,
 * códigos cortos, porcentajes de pocos dígitos).
 */
/** Título del bloque propio del comprobante de retención (período fiscal + total retenido). */
const TITULO_RETENCION = 'RETENCIÓN';

const DOC_SUSTENTO_COLUMN_SPECS: Array<[string, number, 'left' | 'right']> = [
  ['Comprobante', 0.115, 'left'],
  ['Número', 0.16, 'left'],
  ['Fecha Emisión', 0.125, 'left'],
  ['Impuesto', 0.09, 'left'],
  ['Código', 0.08, 'left'],
  ['Base Imponible', 0.14, 'right'],
  ['%', 0.065, 'right'],
  ['Valor Retenido', 0.225, 'right'],
];

/**
 * Etiqueta legible del tipo de impuesto retenido, por `RetencionRow.codigo`
 * — catálogo SRI del nodo `<impuesto>` dentro de cada `<retencion>` de un
 * comprobante de retención: `1` = RENTA, `2` = IVA, `6` = ISD. NO confundir
 * con `RetencionRow.codigoRetencion` (p.ej. `'303'`), que es el código del
 * concepto de retención de la Tabla 19 (Retenciones Impuesto a la Renta) o
 * la Tabla 21 (Retenciones IVA) del SRI — ese va en su propia columna
 * "Código", no en "Impuesto" (hallazgo confirmado de la revisión: antes
 * `codigoRetencion` se imprimía bajo el encabezado "Impuesto", mezclando
 * ambos catálogos). Local a este renderer (no en `catalogs/`) porque es
 * puramente una etiqueta de presentación del RIDE, igual que
 * `LABEL_FORMA_PAGO` en `blocks.ts` — los códigos en sí no tienen un tipo
 * nominal público hoy (`RetencionRow.codigo` se modela como `string` suelto
 * en `documents/retencion.ts`).
 */
const LABEL_IMPUESTO_RETENCION: Record<string, string> = {
  '1': 'RENTA',
  '2': 'IVA',
  '6': 'ISD',
};

/**
 * Aplana `docsSustento[].retenciones[]` a una fila de tabla por cada
 * retención, con los datos del `DocSustento` que la contiene (tipo,
 * número, fecha de emisión) repetidos por fila — un `DocSustento` puede
 * traer varias `retenciones` (p.ej. IVA y renta sobre el mismo comprobante
 * sustento). La columna "Impuesto" muestra el tipo de impuesto decodificado
 * (`LABEL_IMPUESTO_RETENCION`, con fallback al código crudo si no está en
 * el mapa); "Código" muestra el código de retención tal cual
 * (`codigoRetencion`) — son dos catálogos SRI distintos, cada uno en su
 * propia columna.
 *
 * Un `docSustento` con `retenciones: []` (nada retenido sobre ese
 * comprobante sustento en particular, pero el documento sí lo referencia)
 * emite una fila placeholder con solo sus 3 columnas identificadoras —
 * auditoría "campos fiscales omitidos", hallazgo 7: antes, sin ninguna
 * `retencion` de donde generar una fila, el `docSustento` entero
 * desaparecía del PDF; su `numDocSustento` no aparecía en ningún lado aunque
 * el documento sí lo trajera.
 */
function filasDocsSustento(docsSustento: DocSustento[]): string[][] {
  const filas: string[][] = [];
  for (const docSustento of docsSustento) {
    if (docSustento.retenciones.length === 0) {
      filas.push([
        docSustento.codDocSustento,
        docSustento.numDocSustento,
        docSustento.fechaEmisionDocSustento,
        '',
        '',
        '',
        '',
        '',
      ]);
      continue;
    }
    for (const retencion of docSustento.retenciones) {
      filas.push([
        docSustento.codDocSustento,
        docSustento.numDocSustento,
        docSustento.fechaEmisionDocSustento,
        LABEL_IMPUESTO_RETENCION[retencion.codigo] ?? retencion.codigo,
        retencion.codigoRetencion,
        formatMonto(retencion.baseImponible, 2),
        `${retencion.porcentajeRetener}%`,
        formatMonto(retencion.valorRetenido, 2),
      ]);
    }
  }
  return filas;
}

/** Suma en centavos `valorRetenido` de todas las filas `retenciones` de todos los `docsSustento` (nunca aritmética de punto flotante). */
function totalRetenido(docsSustento: DocSustento[]): string {
  let cents = 0;
  for (const docSustento of docsSustento) {
    for (const retencion of docSustento.retenciones) {
      cents += toCents(retencion.valorRetenido);
    }
  }
  return fromCents(cents);
}

/** Título del bloque "Detalle de Documentos Sustento" (ver {@link lineasDocumentosSustentoDetalle}). */
const TITULO_DOC_SUSTENTO_DETALLE = 'DETALLE DE DOCUMENTOS SUSTENTO';

/**
 * Líneas del bloque "Detalle de Documentos Sustento": por cada `docSustento`,
 * su código de sustento, sus totales y CADA fila de `impuestosDocSustento`/
 * `pagos` — nada se resume ni se descarta.
 *
 * Auditoría "campos fiscales omitidos", hallazgo 9: `codSustento`,
 * `importeTotal`, `impuestosDocSustento[]` y `pagos[]` no se leían en
 * ningún lado de este archivo. El comentario original en el encabezado del
 * módulo documentaba la omisión de `pagos` como una decisión de alcance
 * ("no está en el listado de bloques obligatorios del plan") — pero deja de
 * imprimir un dato real de un documento fiscal, sea por decisión de alcance
 * o por descuido, y el efecto es el mismo: el lector no puede verificar esos
 * valores contra el comprobante sustento original.
 *
 * Deliberadamente NO se fusiona con {@link filasDocsSustento} (la tabla de
 * retenciones): esa tabla tiene sus fracciones de columna ya afinadas contra
 * un hallazgo de wrapping de una revisión anterior (ver el comentario de
 * `DOC_SUSTENTO_COLUMN_SPECS`) — reabrir ese cálculo para meter columnas
 * nuevas arriesgaba reintroducir ese mismo bug. Este bloque es texto libre
 * vía `drawBloqueTexto`/`medirBloqueTexto`, que ya saben paginar contenido
 * arbitrariamente largo (incluida la marca "(continuación)").
 */
function lineasDocumentosSustentoDetalle(docsSustento: DocSustento[]): string[] {
  const lineas: string[] = [];
  for (const docSustento of docsSustento) {
    lineas.push(
      `Documento Sustento: ${docSustento.codDocSustento} - ${docSustento.numDocSustento}` +
        ` (Código de Sustento: ${docSustento.codSustento})`,
    );
    lineas.push(`Total sin Impuestos: ${docSustento.totalSinImpuestos}`);
    lineas.push(`Importe Total: ${docSustento.importeTotal}`);

    for (const imp of docSustento.impuestosDocSustento) {
      let linea =
        `Impuesto: código ${imp.codImpuestoDocSustento}, % ${imp.codigoPorcentaje}, ` +
        `base imponible ${imp.baseImponible}, tarifa ${imp.tarifa}%, valor ${imp.valorImpuesto}`;
      if (imp.factorProporcionalidad) {
        linea += `, factor de proporcionalidad ${imp.factorProporcionalidad}`;
      }
      if (imp.baseImponibleModificada) {
        linea += `, base imponible modificada ${imp.baseImponibleModificada}`;
      }
      lineas.push(linea);
    }

    for (const pago of docSustento.pagos) {
      lineas.push(`Pago: ${formaPagoLabel(pago.formaPago)} - ${pago.total}`);
    }
  }
  return lineas;
}

/**
 * RIDE de Comprobante de Retención (codDoc `07`). Otro comprobante sin
 * `detalles`/`totalConImpuestos`/`pagos` a nivel documento: el cuerpo es la
 * tabla de `docsSustento`, aplanada a una fila por cada `retenciones[]`, más
 * el bloque "Detalle de Documentos Sustento" (`codSustento`, totales,
 * `impuestosDocSustento[]` y `pagos[]` de cada `docSustento` — ver
 * {@link lineasDocumentosSustentoDetalle}). El "sujeto" de `drawComprador`
 * es el sujeto retenido (`etiquetaSujeto: 'Sujeto Retenido'`).
 */
export async function generarRideRetencion(opciones: RideOptions<Retencion>): Promise<Uint8Array> {
  const { documento, claveAcceso, autorizacion, logo } = opciones;
  const incluirQr = opciones.opciones?.incluirQr ?? true;
  const tamano = opciones.opciones?.tamano ?? 'A4';

  const { doc, finalizar } = await crearDocumentoRide(tamano);
  const qr = incluirQr ? await generarQr(claveAcceso) : undefined;

  const margenX = doc.page.margins.left;
  const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  let y = doc.page.margins.top;

  // Cabecera: emisor (izquierda) + comprobante con QR (derecha), misma fila.
  const anchoEmisor = Math.floor(anchoUtil * PROPORCION_EMISOR);
  const anchoComprobante = anchoUtil - anchoEmisor;

  const emisor: EmisorRide = {
    logo,
    razonSocial: documento.infoTributaria.razonSocial,
    nombreComercial: documento.infoTributaria.nombreComercial,
    dirMatriz: documento.infoTributaria.dirMatriz,
    dirEstablecimiento: documento.dirEstablecimiento,
    obligadoContabilidad: documento.obligadoContabilidad,
    contribuyenteEspecial: documento.contribuyenteEspecial,
    agenteRetencion: documento.infoTributaria.agenteRetencion,
    contribuyenteRimpe: documento.infoTributaria.contribuyenteRimpe,
  };
  const comprobante: ComprobanteRide = {
    ruc: documento.infoTributaria.ruc,
    nombreDocumento: nombreDocumento(documento.tipo),
    numero: formatNumeroComprobante(documento.infoTributaria),
    ambiente: documento.infoTributaria.ambiente,
    tipoEmision: documento.infoTributaria.tipoEmision ?? TipoEmision.Normal,
    claveAcceso,
    autorizacion,
  };
  y =
    drawBloquesEnFila(
      doc,
      y,
      medirEmisor(doc, emisor, anchoEmisor),
      medirComprobante(doc, comprobante, anchoComprobante, qr !== undefined),
      (yFila) => drawEmisor(doc, emisor, { x: margenX, y: yFila, width: anchoEmisor }),
      (yFila) =>
        drawComprobante(doc, comprobante, { x: margenX + anchoEmisor, y: yFila, width: anchoComprobante }, qr),
      ESPACIADO_BLOQUE,
    ) + ESPACIADO_BLOQUE;

  // Sujeto retenido: mismo bloque "comprador", etiqueta cambiada.
  const sujetoRetenido: CompradorRide = {
    etiquetaSujeto: 'Sujeto Retenido',
    razonSocial: documento.razonSocialSujetoRetenido,
    identificacion: documento.identificacionSujetoRetenido,
    tipoIdentificacion: documento.tipoIdentificacionSujetoRetenido,
    fechaEmision: documento.fechaEmision,
  };
  y = asegurarEspacio(doc, y, medirComprador(doc, sujetoRetenido, anchoUtil));
  y = drawComprador(doc, sujetoRetenido, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Período fiscal + total retenido + tipo de sujeto retenido/parte
  // relacionada (si vienen — auditoría "campos fiscales omitidos": antes
  // ningún `*.ride.ts` leía `tipoSujetoRetenido`/`parteRel`).
  const lineasRetencion = [
    `Período Fiscal: ${documento.periodoFiscal}`,
    `Total Retenido: ${totalRetenido(documento.docsSustento)}`,
  ];
  if (documento.tipoSujetoRetenido) {
    lineasRetencion.push(`Tipo de Sujeto Retenido: ${documento.tipoSujetoRetenido}`);
  }
  if (documento.parteRel) {
    lineasRetencion.push(`Parte Relacionada: ${documento.parteRel}`);
  }
  y = asegurarEspacio(doc, y, medirBloqueTexto(doc, TITULO_RETENCION, lineasRetencion, anchoUtil));
  y = drawBloqueTexto(doc, TITULO_RETENCION, lineasRetencion, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Documentos sustento (una fila de tabla por cada `retenciones[]`).
  // `drawTablaGenerica` reserva su propio espacio: es dueña de su paginación fila a fila.
  const columnas = construirColumnas(anchoUtil, DOC_SUSTENTO_COLUMN_SPECS);
  const filas = filasDocsSustento(documento.docsSustento);
  y = drawTablaGenerica(doc, columnas, filas, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Detalle de documentos sustento: código de sustento, totales, impuestos y
  // pagos de CADA `docSustento` (hallazgo 9 — ver
  // `lineasDocumentosSustentoDetalle`).
  const lineasDetalleSustento = lineasDocumentosSustentoDetalle(documento.docsSustento);
  if (lineasDetalleSustento.length > 0) {
    y = asegurarEspacio(doc, y, medirBloqueTexto(doc, TITULO_DOC_SUSTENTO_DETALLE, lineasDetalleSustento, anchoUtil));
    y =
      drawBloqueTexto(doc, TITULO_DOC_SUSTENTO_DETALLE, lineasDetalleSustento, { x: margenX, y, width: anchoUtil }) +
      ESPACIADO_BLOQUE;
  }

  // Información adicional.
  y = asegurarEspacio(doc, y, medirInfoAdicional(doc, documento.infoAdicional, anchoUtil));
  drawInfoAdicional(doc, documento.infoAdicional, { x: margenX, y, width: anchoUtil });

  return finalizar();
}
