import { TipoEmision } from '../catalogs/index.js';
import type { NotaDebito } from '../documents/index.js';
// Desde `'sri-ec'` (no `'../utils/money.js'`), ver la nota en `blocks.ts`.
import { formatMonto } from 'sri-ec';
import {
  asegurarEspacio,
  construirColumnas,
  drawComprador,
  drawComprobante,
  drawEmisor,
  drawFormasPago,
  drawInfoAdicional,
  drawTablaGenerica,
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

/** Columnas de la tabla "motivos" (razón/valor) — `NotaDebito.motivos` es obligatoria y no vacía en el value object PHP. */
const MOTIVO_COLUMN_SPECS: Array<[string, number, 'left' | 'right']> = [
  ['Razón', 0.75, 'left'],
  ['Valor', 0.25, 'right'],
];

/**
 * RIDE de Nota de Débito (codDoc `05`). No tiene `detalles` (a diferencia de
 * Factura/LiquidacionCompra/NotaCredito): en su lugar dibuja la tabla de
 * `motivos` (razón/valor) sobre {@link drawTablaGenerica}, reutilizando el
 * motor de tabla genérica de Task 2 en vez de `drawTablaDetalles` (que
 * asume el shape de `Detalle`, que este comprobante no modela).
 * `TotalesRide.totalDescuento` queda sin asignar porque `NotaDebito` no lo
 * modela (fix round 1 de Task 1: el campo es opcional justo por esto).
 */
export async function generarRideNotaDebito(opciones: RideOptions<NotaDebito>): Promise<Uint8Array> {
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

  // Motivos (razón/valor) — reemplaza al detalle, que este comprobante no tiene.
  y = asegurarEspacio(doc, y, 30);
  const columnasMotivos = construirColumnas(anchoUtil, MOTIVO_COLUMN_SPECS);
  const filasMotivos = documento.motivos.map((motivo) => [motivo.razon, formatMonto(motivo.valor, 2)]);
  y = drawTablaGenerica(doc, columnasMotivos, filasMotivos, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Formas de pago (izquierda) + totales (derecha), misma fila.
  const anchoFormasPago = Math.floor(anchoUtil * PROPORCION_FORMAS_PAGO);
  const anchoTotales = anchoUtil - anchoFormasPago;

  const totales: TotalesRide = {
    impuestos: documento.impuestos,
    totalSinImpuestos: documento.totalSinImpuestos,
    importeTotal: documento.valorTotal,
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
