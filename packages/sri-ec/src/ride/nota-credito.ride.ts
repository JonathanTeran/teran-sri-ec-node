import { TipoEmision } from '../catalogs/index.js';
import type { NotaCredito } from '../documents/index.js';
import {
  asegurarEspacio,
  drawBloqueTexto,
  drawBloquesEnFila,
  drawComprador,
  drawComprobante,
  drawEmisor,
  drawInfoAdicional,
  drawTablaDetalles,
  drawTotales,
  formatNumeroComprobante,
  medirBloqueTexto,
  medirComprador,
  medirComprobante,
  medirEmisor,
  medirInfoAdicional,
  medirTotales,
  nombreDocumento,
  nombreDocumentoPorCodigo,
} from './blocks.js';
import { crearDocumentoRide } from './pdf-doc.js';
import { generarQr } from './qr.js';
import type { ComprobanteRide, CompradorRide, EmisorRide, RideOptions, TotalesRide } from './types.js';

/** Separación vertical entre bloques apilados. */
const ESPACIADO_BLOQUE = 10;
/** Proporción del ancho útil que ocupa la columna del emisor en la cabecera (el resto es "comprobante"). */
const PROPORCION_EMISOR = 0.55;

/**
 * Título del bloque propio de la nota de crédito. El nombre legible de
 * `codDocModificado` se resuelve con `nombreDocumentoPorCodigo()` de
 * `blocks.ts` (compartido con `nota-debito.ride.ts` — ver ese archivo para
 * el porqué de no reusar `nombreDocumento()`).
 */
const TITULO_MODIFICA = 'COMPROBANTE QUE MODIFICA';

/**
 * RIDE de Nota de Crédito (codDoc `04`). A diferencia de Factura, no tiene
 * `pagos` (el XSD 1.1.0 de notaCredito no lo contempla) — por eso "Totales"
 * ocupa el ancho completo de la página en vez de compartir fila con
 * "Formas de Pago". El extra propio del tipo es el bloque "Comprobante que
 * Modifica" (`codDocModificado` + `numDocModificado` +
 * `fechaEmisionDocSustento` + `motivo`, vía `drawBloqueTexto`);
 * `valorModificacion` se imprime como el "VALOR TOTAL" del bloque Totales
 * compartido — `NotaCredito` no modela un `importeTotal` separado.
 */
export async function generarRideNotaCredito(opciones: RideOptions<NotaCredito>): Promise<Uint8Array> {
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
    rise: documento.rise,
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

  // Comprador.
  const comprador: CompradorRide = {
    razonSocial: documento.razonSocialComprador,
    identificacion: documento.identificacionComprador,
    tipoIdentificacion: documento.tipoIdentificacionComprador,
    fechaEmision: documento.fechaEmision,
  };
  y = asegurarEspacio(doc, y, medirComprador(doc, comprador, anchoUtil));
  y = drawComprador(doc, comprador, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Comprobante que modifica + motivo.
  const nombreModificado = nombreDocumentoPorCodigo(documento.codDocModificado);
  const lineasModifica = [
    `Tipo de Comprobante Modificado: ${documento.codDocModificado} - ${nombreModificado}`,
    `Número de Comprobante Modificado: ${documento.numDocModificado}`,
    `Fecha de Emisión del Comprobante Sustento: ${documento.fechaEmisionDocSustento}`,
    `Motivo: ${documento.motivo}`,
  ];
  y = asegurarEspacio(doc, y, medirBloqueTexto(doc, TITULO_MODIFICA, lineasModifica, anchoUtil));
  y = drawBloqueTexto(doc, TITULO_MODIFICA, lineasModifica, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Detalle (`drawTablaDetalles` reserva su propio espacio: es dueña de su paginación fila a fila).
  y = drawTablaDetalles(doc, documento.detalles, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Totales (ancho completo: NotaCredito no tiene `pagos`, así que no comparte
  // fila con "Formas de Pago"). `valorModificacion` hace de `importeTotal`.
  const totales: TotalesRide = {
    impuestos: documento.totalConImpuestos,
    totalSinImpuestos: documento.totalSinImpuestos,
    importeTotal: documento.valorModificacion,
    moneda: documento.moneda,
  };
  y = asegurarEspacio(doc, y, medirTotales(doc, totales, anchoUtil));
  y = drawTotales(doc, totales, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Información adicional.
  y = asegurarEspacio(doc, y, medirInfoAdicional(doc, documento.infoAdicional, anchoUtil));
  drawInfoAdicional(doc, documento.infoAdicional, { x: margenX, y, width: anchoUtil });

  return finalizar();
}
