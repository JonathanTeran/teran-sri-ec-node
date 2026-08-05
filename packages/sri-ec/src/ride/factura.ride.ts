import { TipoEmision } from '../catalogs/index.js';
import type { Factura } from '../documents/index.js';
import {
  asegurarEspacio,
  drawBloquesEnFila,
  drawComprador,
  drawComprobante,
  drawEmisor,
  drawFormasPago,
  drawInfoAdicional,
  drawTablaDetalles,
  drawTotales,
  formatNumeroComprobante,
  medirComprador,
  medirComprobante,
  medirEmisor,
  medirFormasPago,
  medirInfoAdicional,
  medirTotales,
  nombreDocumento,
} from './blocks.js';
import { crearDocumentoRide } from './pdf-doc.js';
import { generarQr } from './qr.js';
import type { ComprobanteRide, CompradorRide, EmisorRide, RideOptions, TotalesRide } from './types.js';

/** Separación vertical entre bloques apilados. */
const ESPACIADO_BLOQUE = 10;
/** Proporción del ancho útil que ocupa la columna del emisor en la cabecera (el resto es "comprobante"). */
const PROPORCION_EMISOR = 0.55;
/** Proporción del ancho útil que ocupa "formas de pago" antes de "totales". */
const PROPORCION_FORMAS_PAGO = 0.5;

/**
 * RIDE de Factura (codDoc `01`). Arma los tipos normalizados de `types.ts` a
 * partir del `Factura` de `documents/factura.ts` y compone los 7 bloques de
 * `blocks.ts`: es el único `*.ride.ts` de la Task 1 — el patrón que sigue
 * (mapear el documento a `EmisorRide`/`ComprobanteRide`/`CompradorRide`/
 * `TotalesRide`, generar el QR una sola vez y encadenar los `draw*` con
 * `AreaRide`) es exactamente lo que Task 2 replica para los otros 5 tipos.
 */
export async function generarRideFactura(opciones: RideOptions<Factura>): Promise<Uint8Array> {
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
    // dirEstablecimiento/contribuyenteEspecial: fix round 1, gap real
    // confirmado del reviewer — Factura era el único de los 6 comprobantes
    // que no los modelaba (ver `documents/factura.ts`).
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

  // Comprador.
  const comprador: CompradorRide = {
    razonSocial: documento.razonSocialComprador,
    identificacion: documento.identificacionComprador,
    tipoIdentificacion: documento.tipoIdentificacionComprador,
    fechaEmision: documento.fechaEmision,
    direccion: documento.direccionComprador,
    guiaRemision: documento.guiaRemision,
  };
  y = asegurarEspacio(doc, y, medirComprador(doc, comprador, anchoUtil));
  y = drawComprador(doc, comprador, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Detalle (`drawTablaDetalles` reserva su propio espacio: es dueña de su paginación fila a fila).
  y = drawTablaDetalles(doc, documento.detalles, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Formas de pago (izquierda) + totales (derecha), misma fila.
  const anchoFormasPago = Math.floor(anchoUtil * PROPORCION_FORMAS_PAGO);
  const anchoTotales = anchoUtil - anchoFormasPago;

  const totales: TotalesRide = {
    impuestos: documento.totalConImpuestos,
    totalSinImpuestos: documento.totalSinImpuestos,
    totalDescuento: documento.totalDescuento,
    propina: documento.propina,
    importeTotal: documento.importeTotal,
    moneda: documento.moneda,
  };

  y =
    drawBloquesEnFila(
      doc,
      y,
      medirFormasPago(doc, documento.pagos, anchoFormasPago),
      medirTotales(doc, totales, anchoTotales),
      (yFila) => drawFormasPago(doc, documento.pagos, { x: margenX, y: yFila, width: anchoFormasPago }),
      (yFila) => drawTotales(doc, totales, { x: margenX + anchoFormasPago, y: yFila, width: anchoTotales }),
      ESPACIADO_BLOQUE,
    ) + ESPACIADO_BLOQUE;

  // Información adicional.
  y = asegurarEspacio(doc, y, medirInfoAdicional(doc, documento.infoAdicional, anchoUtil));
  drawInfoAdicional(doc, documento.infoAdicional, { x: margenX, y, width: anchoUtil });

  return finalizar();
}
