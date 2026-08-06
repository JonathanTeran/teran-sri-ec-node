import { TipoEmision } from '../catalogs/index.js';
import type { Factura } from '../documents/index.js';
import {
  asegurarEspacio,
  drawCabecera,
  drawComprador,
  drawPie,
  drawTablaDetalles,
  formatNumeroComprobante,
  medirCabecera,
  medirComprador,
  medirPie,
  nombreDocumento,
} from './blocks.js';
import { crearDocumentoRide } from './pdf-doc.js';
import { generarQr } from './qr.js';
import type { ComprobanteRide, CompradorRide, EmisorRide, RideOptions, TotalesRide } from './types.js';

/** Separación vertical entre bloques apilados. */
const ESPACIADO_BLOQUE = 10;

/**
 * RIDE de Factura (codDoc `01`), conforme a la maqueta de la **página 56 del
 * Anexo 2** de la Ficha Técnica del SRI. Arma los tipos normalizados de
 * `types.ts` a partir del `Factura` de `documents/factura.ts` y compone los
 * cuatro bloques del Anexo 2: cabecera de dos columnas, banda del comprador,
 * tabla de detalles y pie de dos columnas.
 *
 * Es el patrón que Task 2 replica para los otros 5 tipos: mapear el documento a
 * `EmisorRide`/`ComprobanteRide`/`CompradorRide`/`TotalesRide`, y encadenar
 * `drawCabecera` → banda propia → `drawTablaDetalles` → `drawPie`, midiendo
 * cada bloque con su `medir*` antes de dibujarlo.
 */
export async function generarRideFactura(opciones: RideOptions<Factura>): Promise<Uint8Array> {
  const { documento, claveAcceso, autorizacion, logo } = opciones;
  // El código de barras Code 128 es el predeterminado (es lo que imprime la
  // maqueta); el QR de v0.2.0 queda como alternativa opt-in.
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
  // Cabecera de dos columnas: logo + emisor (izquierda), comprobante con el
  // código de barras de la clave de acceso (derecha), ambas a la misma altura.
  const cabecera = { emisor, comprobante, qr, codigoBarras };
  y = asegurarEspacio(doc, y, medirCabecera(doc, cabecera, anchoUtil));
  y = drawCabecera(doc, cabecera, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Banda del comprador, a todo el ancho.
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

  // Pie de dos columnas: información adicional + formas de pago (izquierda),
  // totales y recuadro de subsidios (derecha).
  const totales: TotalesRide = {
    impuestos: documento.totalConImpuestos,
    totalSinImpuestos: documento.totalSinImpuestos,
    totalDescuento: documento.totalDescuento,
    propina: documento.propina,
    importeTotal: documento.importeTotal,
    moneda: documento.moneda,
    // `PROPINA` y el recuadro de subsidios son filas fijas de la maqueta de la
    // factura (los otros comprobantes no las llevan).
    conPropina: true,
    conSubsidio: true,
  };

  const pie = { infoAdicional: documento.infoAdicional, pagos: documento.pagos, totales };
  y = asegurarEspacio(doc, y, medirPie(doc, pie, anchoUtil));
  drawPie(doc, pie, { x: margenX, y, width: anchoUtil });

  return finalizar();
}
