import { TipoEmision } from '../catalogs/index.js';
import type { NotaDebito } from '../documents/index.js';
// Desde `'sri-ec'` (no `'../utils/money.js'`), ver la nota en `blocks.ts`.
import { formatMonto } from 'sri-ec';
import {
  asegurarEspacio,
  construirColumnas,
  drawBloqueTexto,
  drawBloquesEnFila,
  drawComprador,
  drawComprobante,
  drawEmisor,
  drawFormasPago,
  drawInfoAdicional,
  drawTablaGenerica,
  drawTotales,
  formatNumeroComprobante,
  medirBloqueTexto,
  medirComprador,
  medirComprobante,
  medirEmisor,
  medirFormasPago,
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
/** Proporción del ancho útil que ocupa "formas de pago" antes de "totales". */
const PROPORCION_FORMAS_PAGO = 0.5;

/** Columnas de la tabla "motivos" (razón/valor) — `NotaDebito.motivos` es obligatoria y no vacía en el value object PHP. */
const MOTIVO_COLUMN_SPECS: Array<[string, number, 'left' | 'right']> = [
  ['Razón', 0.75, 'left'],
  ['Valor', 0.25, 'right'],
];

/**
 * Título del bloque "Comprobante que Modifica", igual que en
 * `nota-credito.ride.ts` — `NotaDebito` también modela
 * `codDocModificado`/`numDocModificado`/`fechaEmisionDocSustento` (identifica
 * el comprobante al que se le añade el débito), pero NO un `motivo` singular
 * (tiene `motivos: Motivo[]`, su propia tabla más abajo), así que este
 * bloque no lleva la línea "Motivo:" que sí tiene el de nota de crédito.
 *
 * Auditoría "campos fiscales omitidos", hallazgo 2 (CRÍTICO): antes de este
 * fix, ninguno de estos 3 campos se leía en `nota-debito.ride.ts` — el
 * comprobante que la nota de débito modifica no aparecía en ningún lado del
 * PDF, en un documento fiscal cuyo propósito es precisamente relacionarse
 * con otro ya emitido.
 */
const TITULO_MODIFICA = 'COMPROBANTE QUE MODIFICA';

/**
 * RIDE de Nota de Débito (codDoc `05`). No tiene `detalles` (a diferencia de
 * Factura/LiquidacionCompra/NotaCredito): en su lugar dibuja la tabla de
 * `motivos` (razón/valor) sobre {@link drawTablaGenerica}, reutilizando el
 * motor de tabla genérica de Task 2 en vez de `drawTablaDetalles` (que
 * asume el shape de `Detalle`, que este comprobante no modela).
 * `TotalesRide.totalDescuento` queda sin asignar porque `NotaDebito` no lo
 * modela (fix round 1 de Task 1: el campo es opcional justo por esto).
 * `NotaDebito` tampoco modela `moneda` (a diferencia de Factura/
 * LiquidacionCompra/NotaCredito), así que `TotalesRide.moneda` queda sin
 * asignar aquí también.
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

  // Comprobante que modifica (hallazgo 2, CRÍTICO — ver comentario de
  // `TITULO_MODIFICA` arriba). Mismo contenido que el bloque equivalente de
  // `nota-credito.ride.ts`, sin la línea "Motivo:" (`NotaDebito` no modela
  // un motivo singular: tiene su propia tabla `motivos` más abajo).
  const nombreModificado = nombreDocumentoPorCodigo(documento.codDocModificado);
  const lineasModifica = [
    `Tipo de Comprobante Modificado: ${documento.codDocModificado} - ${nombreModificado}`,
    `Número de Comprobante Modificado: ${documento.numDocModificado}`,
    `Fecha de Emisión del Comprobante Sustento: ${documento.fechaEmisionDocSustento}`,
  ];
  y = asegurarEspacio(doc, y, medirBloqueTexto(doc, TITULO_MODIFICA, lineasModifica, anchoUtil));
  y = drawBloqueTexto(doc, TITULO_MODIFICA, lineasModifica, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Motivos (razón/valor) — reemplaza al detalle, que este comprobante no
  // tiene. `drawTablaGenerica` reserva su propio espacio.
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
