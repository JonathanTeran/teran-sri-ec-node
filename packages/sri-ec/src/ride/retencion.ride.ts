import { TipoEmision } from '../catalogs/index.js';
import type { DocSustento, Retencion } from '../documents/index.js';
// Desde `'sri-ec'` (no `'../utils/money.js'`), ver la nota en `blocks.ts`.
import { formatMonto, fromCents, toCents } from 'sri-ec';
import {
  asegurarEspacio,
  construirColumnas,
  drawBloqueTexto,
  drawComprador,
  drawComprobante,
  drawEmisor,
  drawInfoAdicional,
  drawTablaGenerica,
  formatNumeroComprobante,
  nombreDocumento,
} from './blocks.js';
import { crearDocumentoRide } from './pdf-doc.js';
import { generarQr } from './qr.js';
import type { AreaRide, ComprobanteRide, CompradorRide, EmisorRide, RideOptions } from './types.js';

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
 */
function filasDocsSustento(docsSustento: DocSustento[]): string[][] {
  const filas: string[][] = [];
  for (const docSustento of docsSustento) {
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

/**
 * RIDE de Comprobante de Retención (codDoc `07`). Otro comprobante sin
 * `detalles`/`totalConImpuestos`/`pagos` a nivel documento: el cuerpo es la
 * tabla de `docsSustento`, aplanada a una fila por cada `retenciones[]`.
 * `DocSustento.pagos` (`PagoSustentoRow[]`, shape distinto al `Pago`
 * compartido) no se imprime — no está en el listado de bloques
 * obligatorios de retención del plan (periodo fiscal + tabla de documentos
 * sustento + total retenido), a diferencia de `docsSustento`. El "sujeto"
 * de `drawComprador` es el sujeto retenido
 * (`etiquetaSujeto: 'Sujeto Retenido'`).
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
  const areaEmisor: AreaRide = { x: margenX, y, width: anchoEmisor };
  const yEmisor = drawEmisor(doc, emisor, areaEmisor);

  const comprobante: ComprobanteRide = {
    ruc: documento.infoTributaria.ruc,
    nombreDocumento: nombreDocumento(documento.tipo),
    numero: formatNumeroComprobante(documento.infoTributaria),
    ambiente: documento.infoTributaria.ambiente,
    tipoEmision: documento.infoTributaria.tipoEmision ?? TipoEmision.Normal,
    claveAcceso,
    autorizacion,
  };
  const areaComprobante: AreaRide = { x: margenX + anchoEmisor, y, width: anchoComprobante };
  const yComprobante = drawComprobante(doc, comprobante, areaComprobante, qr);

  y = Math.max(yEmisor, yComprobante) + ESPACIADO_BLOQUE;

  // Sujeto retenido: mismo bloque "comprador", etiqueta cambiada.
  const sujetoRetenido: CompradorRide = {
    etiquetaSujeto: 'Sujeto Retenido',
    razonSocial: documento.razonSocialSujetoRetenido,
    identificacion: documento.identificacionSujetoRetenido,
    fechaEmision: documento.fechaEmision,
  };
  y = asegurarEspacio(doc, y, 40);
  y = drawComprador(doc, sujetoRetenido, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Período fiscal + total retenido.
  y = asegurarEspacio(doc, y, 30);
  y =
    drawBloqueTexto(
      doc,
      'RETENCIÓN',
      [`Período Fiscal: ${documento.periodoFiscal}`, `Total Retenido: ${totalRetenido(documento.docsSustento)}`],
      { x: margenX, y, width: anchoUtil },
    ) + ESPACIADO_BLOQUE;

  // Documentos sustento (una fila de tabla por cada `retenciones[]`).
  y = asegurarEspacio(doc, y, 30);
  const columnas = construirColumnas(anchoUtil, DOC_SUSTENTO_COLUMN_SPECS);
  const filas = filasDocsSustento(documento.docsSustento);
  y = drawTablaGenerica(doc, columnas, filas, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Información adicional.
  y = asegurarEspacio(doc, y, 20);
  drawInfoAdicional(doc, documento.infoAdicional, { x: margenX, y, width: anchoUtil });

  return finalizar();
}
