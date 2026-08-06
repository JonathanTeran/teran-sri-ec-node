import { TipoEmision } from '../catalogs/index.js';
import type { NotaDebito } from '../documents/index.js';
// Desde `'sri-ec'` (no `'../utils/money.js'`), ver la nota en `blocks.ts`.
import { formatMonto } from 'sri-ec';
import {
  asegurarEspacio,
  construirColumnas,
  drawBandaSujeto,
  drawCabecera,
  drawComprador,
  drawPie,
  drawTablaGenerica,
  formatNumeroComprobante,
  medirBandaSujeto,
  medirCabecera,
  medirComprador,
  medirPie,
  nombreDocumento,
  nombreDocumentoPorCodigo,
} from './blocks.js';
import type { FilaBanda } from './blocks.js';
import { crearDocumentoRide } from './pdf-doc.js';
import { generarQr } from './qr.js';
import type { ComprobanteRide, CompradorRide, EmisorRide, RideOptions, TotalesRide } from './types.js';

/** Separación vertical entre bloques apilados. */
const ESPACIADO_BLOQUE = 10;

/**
 * Columnas de la tabla de motivos, con los encabezados LITERALES de la maqueta
 * de la página 58 (`RAZÓN DE LA MODIFICACIÓN` | `VALOR DE LA MODIFICACIÓN`).
 * Esta tabla ocupa en la nota de débito el lugar que el detalle ocupa en los
 * otros comprobantes — `NotaDebito` no modela `detalles`, modela `motivos`.
 */
const MOTIVO_COLUMN_SPECS: Array<[string, number, 'left' | 'right']> = [
  ['RAZÓN DE LA MODIFICACIÓN', 0.55, 'left'],
  ['VALOR DE LA MODIFICACIÓN', 0.45, 'right'],
];

/**
 * RIDE de Nota de Débito (codDoc `05`), conforme a la maqueta de la **página
 * 58 del Anexo 2**: cabecera de dos columnas, banda del comprador, banda
 * `Comprobante que se modifica` / `Fecha Emisión (Comprobante a modificar)`,
 * la tabla de motivos con sus dos encabezados literales y pie de dos columnas.
 *
 * No hay tabla de detalle (a diferencia de factura/liquidación/nota de
 * crédito): la maqueta pone en su lugar la tabla de motivos.
 * `TotalesRide.totalDescuento` queda sin asignar porque `NotaDebito` no lo
 * modela —así que la fila `DESCUENTO` no se emite, igual que en la maqueta— y
 * `moneda` tampoco (este es el único de los seis comprobantes que no la
 * modela).
 */
export async function generarRideNotaDebito(opciones: RideOptions<NotaDebito>): Promise<Uint8Array> {
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
  const cabecera = { emisor, comprobante, qr, codigoBarras };
  y = asegurarEspacio(doc, y, medirCabecera(doc, cabecera, anchoUtil));
  y = drawCabecera(doc, cabecera, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Banda del comprador, sin título (igual que en la maqueta).
  const comprador: CompradorRide = {
    razonSocial: documento.razonSocialComprador,
    identificacion: documento.identificacionComprador,
    tipoIdentificacion: documento.tipoIdentificacionComprador,
    fechaEmision: documento.fechaEmision,
  };
  y = asegurarEspacio(doc, y, medirComprador(doc, comprador, anchoUtil));
  y = drawComprador(doc, comprador, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Banda del comprobante que se modifica. Auditoría "campos fiscales
  // omitidos", hallazgo 2 (CRÍTICO): antes de aquel fix, ninguno de estos
  // campos se leía en este archivo — el comprobante que la nota de débito
  // modifica no aparecía en ningún lado del PDF, en un documento fiscal cuyo
  // propósito es precisamente relacionarse con otro ya emitido. La maqueta de
  // la página 58 le da dos filas, sin la de `Razón de Modificación:` que sí
  // tiene la nota de crédito (aquí los motivos van en su propia tabla).
  const filasModifica: FilaBanda[] = [
    {
      izquierda: {
        etiqueta: 'Comprobante que se modifica',
        valor: nombreDocumentoPorCodigo(documento.codDocModificado).toUpperCase(),
      },
      derecha: { etiqueta: '', valor: documento.numDocModificado },
    },
    {
      izquierda: {
        etiqueta: 'Fecha Emisión (Comprobante a modificar)',
        valor: documento.fechaEmisionDocSustento,
      },
    },
  ];
  y = asegurarEspacio(doc, y, medirBandaSujeto(doc, filasModifica, anchoUtil));
  y = drawBandaSujeto(doc, filasModifica, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Tabla de motivos (`drawTablaGenerica` reserva su propio espacio: es dueña
  // de su paginación fila a fila).
  const columnasMotivos = construirColumnas(anchoUtil, MOTIVO_COLUMN_SPECS);
  const filasMotivos = documento.motivos.map((motivo) => [motivo.razon, formatMonto(motivo.valor, 2)]);
  y = drawTablaGenerica(doc, columnasMotivos, filasMotivos, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Pie de dos columnas: información adicional + formas de pago (izquierda),
  // totales (derecha).
  const totales: TotalesRide = {
    impuestos: documento.impuestos,
    totalSinImpuestos: documento.totalSinImpuestos,
    importeTotal: documento.valorTotal,
  };

  const pie = { infoAdicional: documento.infoAdicional, pagos: documento.pagos, totales };
  y = asegurarEspacio(doc, y, medirPie(doc, pie, anchoUtil));
  drawPie(doc, pie, { x: margenX, y, width: anchoUtil });

  return finalizar();
}
