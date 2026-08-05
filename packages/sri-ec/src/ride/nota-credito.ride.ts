import { TipoComprobante, TipoEmision } from '../catalogs/index.js';
import type { NotaCredito } from '../documents/index.js';
import {
  asegurarEspacio,
  drawBloqueTexto,
  drawComprador,
  drawComprobante,
  drawEmisor,
  drawInfoAdicional,
  drawTablaDetalles,
  drawTotales,
  formatNumeroComprobante,
  nombreDocumento,
} from './blocks.js';
import { crearDocumentoRide } from './pdf-doc.js';
import { generarQr } from './qr.js';
import type { AreaRide, ComprobanteRide, CompradorRide, EmisorRide, RideOptions, TotalesRide } from './types.js';

/** Separación vertical entre bloques apilados. */
const ESPACIADO_BLOQUE = 10;
/** Proporción del ancho útil que ocupa la columna del emisor en la cabecera (el resto es "comprobante"). */
const PROPORCION_EMISOR = 0.55;

/**
 * Nombre legible por `codDoc`, para el bloque "Comprobante que Modifica".
 * `codDocModificado` se modela como `string` suelto (no `TipoComprobante`)
 * en `NotaCredito` — puede en teoría traer un código que el catálogo no
 * reconozca — así que se resuelve con un mapa + fallback al código crudo,
 * en vez de reusar `nombreDocumento()` de `blocks.ts` (que asume un
 * `TipoComprobante` válido, sin rama `default`, y lanzaría en tiempo de
 * ejecución ante un código desconocido).
 */
const NOMBRE_POR_COD_DOC: Record<string, string> = {
  [TipoComprobante.Factura]: 'Factura',
  [TipoComprobante.LiquidacionCompra]: 'Liquidación de Compra',
  [TipoComprobante.NotaCredito]: 'Nota de Crédito',
  [TipoComprobante.NotaDebito]: 'Nota de Débito',
  [TipoComprobante.GuiaRemision]: 'Guía de Remisión',
  [TipoComprobante.Retencion]: 'Comprobante de Retención',
};

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

  // Comprador.
  const comprador: CompradorRide = {
    razonSocial: documento.razonSocialComprador,
    identificacion: documento.identificacionComprador,
    fechaEmision: documento.fechaEmision,
  };
  y = asegurarEspacio(doc, y, 40);
  y = drawComprador(doc, comprador, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Comprobante que modifica + motivo.
  const nombreModificado = NOMBRE_POR_COD_DOC[documento.codDocModificado] ?? documento.codDocModificado;
  y = asegurarEspacio(doc, y, 60);
  y =
    drawBloqueTexto(
      doc,
      'COMPROBANTE QUE MODIFICA',
      [
        `Tipo de Comprobante Modificado: ${documento.codDocModificado} - ${nombreModificado}`,
        `Número de Comprobante Modificado: ${documento.numDocModificado}`,
        `Fecha de Emisión del Comprobante Sustento: ${documento.fechaEmisionDocSustento}`,
        `Motivo: ${documento.motivo}`,
      ],
      { x: margenX, y, width: anchoUtil },
    ) + ESPACIADO_BLOQUE;

  // Detalle.
  y = asegurarEspacio(doc, y, 30);
  y = drawTablaDetalles(doc, documento.detalles, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Totales (ancho completo: NotaCredito no tiene `pagos`, así que no comparte
  // fila con "Formas de Pago"). `valorModificacion` hace de `importeTotal`.
  const totales: TotalesRide = {
    impuestos: documento.totalConImpuestos,
    totalSinImpuestos: documento.totalSinImpuestos,
    importeTotal: documento.valorModificacion,
  };
  y = asegurarEspacio(doc, y, 40);
  y = drawTotales(doc, totales, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Información adicional.
  y = asegurarEspacio(doc, y, 20);
  drawInfoAdicional(doc, documento.infoAdicional, { x: margenX, y, width: anchoUtil });

  return finalizar();
}
