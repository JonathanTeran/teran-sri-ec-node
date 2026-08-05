import { TipoEmision } from '../catalogs/index.js';
import type { Destinatario, DestinatarioDetalle, GuiaRemision } from '../documents/index.js';
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
  drawInfoAdicional,
  drawTablaGenerica,
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

/** Títulos de los dos bloques de texto propios de la guía de remisión. */
const TITULO_TRANSPORTISTA = 'TRANSPORTISTA';
const TITULO_TRASLADO = 'DATOS DEL TRASLADO';

/** Columnas del detalle de un destinatario: shape distinto al `Detalle` compartido (sin precio unitario ni impuestos). */
const DESTINATARIO_DETALLE_COLUMN_SPECS: Array<[string, number, 'left' | 'right']> = [
  ['Cód. Interno', 0.18, 'left'],
  ['Cód. Adicional', 0.18, 'left'],
  ['Descripción', 0.5, 'left'],
  ['Cantidad', 0.14, 'right'],
];

/** Celdas de una fila de detalle de destinatario, en el mismo orden que {@link DESTINATARIO_DETALLE_COLUMN_SPECS}. */
function celdasDestinatarioDetalle(d: DestinatarioDetalle): string[] {
  const extras = d.detallesAdicionales
    ? `\n${Object.entries(d.detallesAdicionales)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')}`
    : '';
  return [d.codigoInterno ?? '', d.codigoAdicional ?? '', `${d.descripcion}${extras}`, formatMonto(d.cantidad, 2)];
}

/**
 * Líneas del bloque "datos del traslado" de un destinatario: motivo
 * (obligatorio), documento sustento, documento aduanero único y ruta (los
 * últimos tres, si vienen).
 */
function lineasTraslado(destinatario: Destinatario): string[] {
  const lineas = [`Motivo del Traslado: ${destinatario.motivoTraslado}`];
  if (destinatario.codDocSustento) {
    lineas.push(`Documento Sustento: ${destinatario.codDocSustento} - ${destinatario.numDocSustento ?? ''}`);
  }
  if (destinatario.docAduaneroUnico) {
    lineas.push(`Documento Aduanero Único: ${destinatario.docAduaneroUnico}`);
  }
  if (destinatario.ruta) {
    lineas.push(`Ruta: ${destinatario.ruta}`);
  }
  return lineas;
}

/**
 * RIDE de Guía de Remisión (codDoc `06`). El único de los 6 comprobantes sin
 * montos: no hay `detalles`, `totalConImpuestos` ni `pagos` a nivel
 * documento — el "detalle" vive por `Destinatario`
 * (`DestinatarioDetalle[]`, sin precio unitario ni impuestos), así que
 * `drawComprador` se llama una vez por destinatario
 * (`etiquetaSujeto: 'Destinatario'`, hallazgo de reusabilidad de la
 * revisión de Task 1), seguido de sus datos de traslado y su propia tabla
 * de detalle. `GuiaRemision` tampoco modela `fechaEmision`: se usa
 * `destinatario.fechaEmisionDocSustento` si viene, o si no
 * `documento.fechaIniTransporte` (obligatorio) como la fecha más cercana
 * disponible para ese bloque.
 */
export async function generarRideGuiaRemision(opciones: RideOptions<GuiaRemision>): Promise<Uint8Array> {
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

  // Transportista + placa + fechas de transporte + dirección de partida.
  const lineasTransportista = [
    `Razón Social: ${documento.razonSocialTransportista}`,
    `Identificación (RUC): ${documento.rucTransportista}`,
    `Placa: ${documento.placa}`,
    `Fecha Inicio Transporte: ${documento.fechaIniTransporte}`,
    `Fecha Fin Transporte: ${documento.fechaFinTransporte}`,
    `Dirección de Partida: ${documento.dirPartida}`,
  ];
  y = asegurarEspacio(doc, y, medirBloqueTexto(doc, TITULO_TRANSPORTISTA, lineasTransportista, anchoUtil));
  y =
    drawBloqueTexto(doc, TITULO_TRANSPORTISTA, lineasTransportista, { x: margenX, y, width: anchoUtil }) +
    ESPACIADO_BLOQUE;

  // Un bloque "destinatario" + sus datos de traslado + su tabla de detalle, por cada `Destinatario`.
  const columnasDetalle = construirColumnas(anchoUtil, DESTINATARIO_DETALLE_COLUMN_SPECS);

  for (const destinatario of documento.destinatarios) {
    const compradorDestinatario: CompradorRide = {
      etiquetaSujeto: 'Destinatario',
      razonSocial: destinatario.razonSocialDestinatario,
      identificacion: destinatario.identificacionDestinatario,
      fechaEmision: destinatario.fechaEmisionDocSustento ?? documento.fechaIniTransporte,
      direccion: destinatario.dirDestinatario,
    };
    y = asegurarEspacio(doc, y, medirComprador(doc, compradorDestinatario, anchoUtil));
    y = drawComprador(doc, compradorDestinatario, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

    const lineas = lineasTraslado(destinatario);
    y = asegurarEspacio(doc, y, medirBloqueTexto(doc, TITULO_TRASLADO, lineas, anchoUtil));
    y = drawBloqueTexto(doc, TITULO_TRASLADO, lineas, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

    // `drawTablaGenerica` reserva su propio espacio: es dueña de su paginación fila a fila.
    const filasDetalle = destinatario.detalles.map(celdasDestinatarioDetalle);
    y = drawTablaGenerica(doc, columnasDetalle, filasDetalle, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;
  }

  // Información adicional.
  y = asegurarEspacio(doc, y, medirInfoAdicional(doc, documento.infoAdicional, anchoUtil));
  drawInfoAdicional(doc, documento.infoAdicional, { x: margenX, y, width: anchoUtil });

  return finalizar();
}
