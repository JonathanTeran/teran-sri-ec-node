import { TipoEmision } from '../catalogs/index.js';
import type { DocSustento, Retencion } from '../documents/index.js';
// Desde `'sri-ec'` (no `'../utils/money.js'`), ver la nota en `blocks.ts`.
import { formatMonto, fromCents, toCents } from 'sri-ec';
import {
  asegurarEspacio,
  construirColumnas,
  drawBloqueTexto,
  drawCabecera,
  drawComprador,
  drawPie,
  drawTablaGenerica,
  formaPagoLabel,
  formatNumeroComprobante,
  medirBloqueTexto,
  medirCabecera,
  medirComprador,
  medirPie,
  nombreDocumento,
  nombreDocumentoPorCodigo,
} from './blocks.js';
import { crearDocumentoRide } from './pdf-doc.js';
import { generarQr } from './qr.js';
import type { ComprobanteRide, CompradorRide, EmisorRide, RideOptions } from './types.js';

/** Separación vertical entre bloques apilados. */
const ESPACIADO_BLOQUE = 10;

/**
 * Columnas de la tabla de retenciones, con los encabezados LITERALES de la
 * maqueta de la **página 59** (`Comprobante`, `Número`, `Fecha Emisión`,
 * `Ejercicio Fiscal`, `Base Imponible para la Retención`, `IMPUESTO`,
 * `Porcentaje Retención`, `Valor Retenido`) y en ese orden. Una fila por cada
 * `retenciones[]` de cada `docsSustento[]`.
 *
 * Los pesos siguen la proporción de la maqueta (`Base Imponible para la
 * Retención` es la más ancha porque su encabezado ocupa tres palabras largas;
 * `Comprobante`, `IMPUESTO` y `Porcentaje Retención` van holgadas frente a su
 * contenido real: `FACTURA`/`IVA`/`RENTA` y porcentajes de pocos dígitos).
 * Los encabezados se envuelven a dos líneas, igual que en la maqueta, pero
 * NUNCA a mitad de palabra: cada columna tiene ancho suficiente para su
 * palabra más larga.
 */
const RETENCION_COLUMN_SPECS: Array<[string, number, 'left' | 'center' | 'right']> = [
  ['Comprobante', 0.115, 'left'],
  ['Número', 0.15, 'left'],
  ['Fecha Emisión', 0.115, 'center'],
  ['Ejercicio Fiscal', 0.11, 'center'],
  ['Base Imponible para la Retención', 0.16, 'right'],
  ['IMPUESTO', 0.12, 'center'],
  ['Porcentaje Retención', 0.11, 'right'],
  ['Valor Retenido', 0.12, 'right'],
];

/**
 * Etiqueta legible del tipo de impuesto retenido, por `RetencionRow.codigo`
 * — catálogo SRI del nodo `<impuesto>` dentro de cada `<retencion>` de un
 * comprobante de retención: `1` = RENTA, `2` = IVA, `6` = ISD. NO confundir
 * con `RetencionRow.codigoRetencion` (p.ej. `'303'`), que es el código del
 * concepto de retención de la Tabla 19 (Retenciones Impuesto a la Renta) o
 * la Tabla 21 (Retenciones IVA) del SRI. Local a este renderer (no en
 * `catalogs/`) porque es puramente una etiqueta de presentación del RIDE,
 * igual que `LABEL_FORMA_PAGO` en `blocks.ts` — los códigos en sí no tienen un
 * tipo nominal público hoy (`RetencionRow.codigo` se modela como `string`
 * suelto en `documents/retencion.ts`).
 */
const LABEL_IMPUESTO_RETENCION: Record<string, string> = {
  '1': 'RENTA',
  '2': 'IVA',
  '6': 'ISD',
};

/**
 * Aplana `docsSustento[].retenciones[]` a una fila de tabla por cada
 * retención, con los datos del `DocSustento` que la contiene (tipo, número,
 * fecha de emisión) repetidos por fila — un `DocSustento` puede traer varias
 * `retenciones` (p.ej. IVA y renta sobre el mismo comprobante sustento).
 *
 * La columna `IMPUESTO` de la maqueta muestra el tipo de impuesto
 * (`IVA`/`RENTA`); la maqueta de 2017 no le da columna propia a
 * `codigoRetencion` (el concepto de la Tabla 19/21), que sin embargo es un
 * campo real del documento — se imprime entre paréntesis junto al tipo
 * (`IVA (303)`) en vez de perderse, respetando el juego de 8 columnas
 * oficiales.
 *
 * Un `docSustento` con `retenciones: []` (nada retenido sobre ese comprobante
 * sustento en particular, pero el documento sí lo referencia) emite una fila
 * placeholder con solo sus columnas identificadoras — auditoría "campos
 * fiscales omitidos", hallazgo 7: antes, sin ninguna `retencion` de donde
 * generar una fila, el `docSustento` entero desaparecía del PDF.
 */
function filasRetenciones(docsSustento: DocSustento[], periodoFiscal: string): string[][] {
  const filas: string[][] = [];
  for (const docSustento of docsSustento) {
    const identificacion = [
      nombreDocumentoPorCodigo(docSustento.codDocSustento).toUpperCase(),
      docSustento.numDocSustento,
      docSustento.fechaEmisionDocSustento,
      periodoFiscal,
    ];

    if (docSustento.retenciones.length === 0) {
      filas.push([...identificacion, '', '', '', '']);
      continue;
    }
    for (const retencion of docSustento.retenciones) {
      const impuesto = LABEL_IMPUESTO_RETENCION[retencion.codigo] ?? retencion.codigo;
      filas.push([
        ...identificacion,
        formatMonto(retencion.baseImponible, 2),
        `${impuesto} (${retencion.codigoRetencion})`,
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
 * Líneas del bloque "Detalle de Documentos Sustento": el total retenido, el
 * tipo de sujeto retenido / parte relacionada del documento y, por cada
 * `docSustento`, su código de sustento, sus totales y CADA fila de
 * `impuestosDocSustento`/`pagos` — nada se resume ni se descarta.
 *
 * Este bloque NO está en la maqueta de la página 59, que solo dibuja la tabla
 * de retenciones: se conserva porque `codSustento`, `importeTotal`,
 * `impuestosDocSustento[]`, `pagos[]`, `tipoSujetoRetenido` y `parteRel` son
 * campos reales del documento y ninguna columna de las 8 oficiales los
 * recoge (auditoría "campos fiscales omitidos", hallazgo 9). Va DESPUÉS de la
 * tabla oficial y antes del pie, así que la mitad superior del RIDE —la que
 * reproduce la maqueta— queda intacta.
 */
function lineasDocumentosSustentoDetalle(documento: Retencion): string[] {
  const lineas = [
    `Total Retenido: ${totalRetenido(documento.docsSustento)}`,
  ];
  if (documento.tipoSujetoRetenido) {
    lineas.push(`Tipo de Sujeto Retenido: ${documento.tipoSujetoRetenido}`);
  }
  if (documento.parteRel) {
    lineas.push(`Parte Relacionada: ${documento.parteRel}`);
  }

  for (const docSustento of documento.docsSustento) {
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
 * RIDE de Comprobante de Retención (codDoc `07`), conforme a la maqueta de la
 * **página 59 del Anexo 2**: cabecera de dos columnas, banda del sujeto
 * retenido, la tabla de 8 columnas con los encabezados literales
 * ({@link RETENCION_COLUMN_SPECS}) y la caja `Información Adicional` abajo a
 * la izquierda.
 *
 * **Sin bloque de totales**: la maqueta de la retención no lo lleva (el valor
 * retenido de cada fila es la única cifra del comprobante), así que el pie se
 * dibuja solo con `infoAdicional`.
 */
export async function generarRideRetencion(opciones: RideOptions<Retencion>): Promise<Uint8Array> {
  const { documento, claveAcceso, autorizacion, logo } = opciones;
  const codigoBarras = opciones.opciones?.codigoBarras ?? true;
  const incluirQr = opciones.opciones?.incluirQr ?? false;
  const tamano = opciones.opciones?.tamano ?? 'A4';

  const { doc, finalizar } = await crearDocumentoRide(tamano);
  const qr = incluirQr ? await generarQr(claveAcceso) : undefined;

  const margenX = doc.page.margins.left;
  const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  let y = doc.page.margins.top;

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
  const cabecera = { emisor, comprobante, qr, codigoBarras };
  y = asegurarEspacio(doc, y, medirCabecera(doc, cabecera, anchoUtil));
  y = drawCabecera(doc, cabecera, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Banda del sujeto retenido, sin título: la maqueta arranca directamente en
  // `Razón Social / Nombres y Apellidos:`.
  const sujetoRetenido: CompradorRide = {
    razonSocial: documento.razonSocialSujetoRetenido,
    identificacion: documento.identificacionSujetoRetenido,
    tipoIdentificacion: documento.tipoIdentificacionSujetoRetenido,
    fechaEmision: documento.fechaEmision,
  };
  y = asegurarEspacio(doc, y, medirComprador(doc, sujetoRetenido, anchoUtil));
  y = drawComprador(doc, sujetoRetenido, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Tabla de retenciones (`drawTablaGenerica` reserva su propio espacio: es
  // dueña de su paginación fila a fila). El `periodoFiscal` del documento es
  // el `Ejercicio Fiscal` de cada fila — el SRI lo declara a nivel de
  // comprobante, no por retención.
  const columnas = construirColumnas(anchoUtil, RETENCION_COLUMN_SPECS);
  const filas = filasRetenciones(documento.docsSustento, documento.periodoFiscal);
  y = drawTablaGenerica(doc, columnas, filas, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Campos del documento que las 8 columnas oficiales no recogen (hallazgo 9
  // — ver `lineasDocumentosSustentoDetalle`).
  const lineasDetalleSustento = lineasDocumentosSustentoDetalle(documento);
  y = asegurarEspacio(doc, y, medirBloqueTexto(doc, TITULO_DOC_SUSTENTO_DETALLE, lineasDetalleSustento, anchoUtil));
  y =
    drawBloqueTexto(doc, TITULO_DOC_SUSTENTO_DETALLE, lineasDetalleSustento, { x: margenX, y, width: anchoUtil }) +
    ESPACIADO_BLOQUE;

  // Pie: solo `Información Adicional` (abajo a la izquierda, como la maqueta).
  // La retención no lleva bloque de totales ni tabla de formas de pago.
  const pie = { infoAdicional: documento.infoAdicional };
  y = asegurarEspacio(doc, y, medirPie(doc, pie, anchoUtil));
  drawPie(doc, pie, { x: margenX, y, width: anchoUtil });

  return finalizar();
}
