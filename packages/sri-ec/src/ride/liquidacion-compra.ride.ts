import { TipoEmision } from '../catalogs/index.js';
import type { LiquidacionCompra } from '../documents/index.js';
import {
  asegurarEspacio,
  drawComprador,
  drawComprobante,
  drawEmisor,
  drawFormasPago,
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
/** Proporción del ancho útil que ocupa "formas de pago" antes de "totales". */
const PROPORCION_FORMAS_PAGO = 0.5;

/**
 * RIDE de Liquidación de Compra (codDoc `03`). Mismo layout que
 * `factura.ride.ts` (Task 1) — comparte los mismos 7 bloques, en el mismo
 * orden — pero con "Proveedor" en vez de "Comprador"
 * (`CompradorRide.etiquetaSujeto`, hallazgo de reusabilidad de la revisión
 * de Task 1): el emisor liquida una compra a un proveedor no obligado a
 * facturar. A diferencia de `Factura`, `LiquidacionCompra` no modela
 * `guiaRemision` ni `propina`.
 */
export async function generarRideLiquidacionCompra(opciones: RideOptions<LiquidacionCompra>): Promise<Uint8Array> {
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

  // Proveedor: mismo bloque "comprador", etiqueta cambiada.
  const proveedor: CompradorRide = {
    etiquetaSujeto: 'Proveedor',
    razonSocial: documento.razonSocialProveedor,
    identificacion: documento.identificacionProveedor,
    fechaEmision: documento.fechaEmision,
    direccion: documento.direccionProveedor,
  };
  y = asegurarEspacio(doc, y, 40);
  y = drawComprador(doc, proveedor, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Detalle.
  y = asegurarEspacio(doc, y, 30);
  y = drawTablaDetalles(doc, documento.detalles, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Formas de pago (izquierda) + totales (derecha), misma fila.
  const anchoFormasPago = Math.floor(anchoUtil * PROPORCION_FORMAS_PAGO);
  const anchoTotales = anchoUtil - anchoFormasPago;

  const totales: TotalesRide = {
    impuestos: documento.totalConImpuestos,
    totalSinImpuestos: documento.totalSinImpuestos,
    totalDescuento: documento.totalDescuento,
    importeTotal: documento.importeTotal,
  };

  y = asegurarEspacio(doc, y, 40);
  const yFormasPago = drawFormasPago(doc, documento.pagos, { x: margenX, y, width: anchoFormasPago });
  const yTotales = drawTotales(doc, totales, { x: margenX + anchoFormasPago, y, width: anchoTotales });
  y = Math.max(yFormasPago, yTotales) + ESPACIADO_BLOQUE;

  // Información adicional.
  y = asegurarEspacio(doc, y, 20);
  drawInfoAdicional(doc, documento.infoAdicional, { x: margenX, y, width: anchoUtil });

  return finalizar();
}
