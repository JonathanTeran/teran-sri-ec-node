import { TipoEmision } from '../catalogs/index.js';
import type { NotaCredito } from '../documents/index.js';
import {
  asegurarEspacio,
  drawBandaSujeto,
  drawCabecera,
  drawComprador,
  drawPie,
  drawTablaDetalles,
  ETIQUETAS_DETALLE_COMPLETAS,
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
 * El detalle de la nota de crédito (maqueta de la página 57) es el de la
 * factura SIN las columnas `Subsidio` / `Precio Sin Subsidio` y con los
 * encabezados escritos enteros: `Código`, `Código Auxiliar`, `Cantidad`,
 * `Descripción`, tres `Detalle Adicional`, `Precio Unitario`, `Descuento` y
 * `Precio Total`.
 */
const OPCIONES_DETALLE = { subsidio: false, etiquetas: ETIQUETAS_DETALLE_COMPLETAS };

/**
 * RIDE de Nota de Crédito (codDoc `04`), conforme a la maqueta de la **página
 * 57 del Anexo 2**: cabecera de dos columnas, banda del comprador, banda
 * `Comprobante que se modifica` / `Fecha Emisión (Comprobante a modificar)` /
 * `Razón de Modificación:`, detalle sin columnas de subsidio y pie de dos
 * columnas.
 *
 * `NotaCredito` no tiene `pagos` (el XSD 1.1.0 no lo contempla), así que la
 * columna izquierda del pie solo lleva la caja de información adicional — es
 * exactamente lo que dibuja la maqueta. `valorModificacion` se imprime como el
 * `VALOR TOTAL` de la tabla de totales: `NotaCredito` no modela un
 * `importeTotal` separado. La tabla no lleva `PROPINA` ni el recuadro de
 * subsidios (los añade solo la factura), y como el tipo tampoco modela
 * `totalDescuento`, la fila `DESCUENTO` se omite — igual que en la maqueta.
 */
export async function generarRideNotaCredito(opciones: RideOptions<NotaCredito>): Promise<Uint8Array> {
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

  // Banda del comprador, sin título: la maqueta arranca directamente en
  // `Razón Social / Nombres y Apellidos:`, igual que la de la factura.
  const comprador: CompradorRide = {
    razonSocial: documento.razonSocialComprador,
    identificacion: documento.identificacionComprador,
    tipoIdentificacion: documento.tipoIdentificacionComprador,
    fechaEmision: documento.fechaEmision,
  };
  y = asegurarEspacio(doc, y, medirComprador(doc, comprador, anchoUtil));
  y = drawComprador(doc, comprador, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Banda del comprobante que se modifica, con las etiquetas literales de la
  // maqueta. El tipo del documento modificado va decodificado
  // (`nombreDocumentoPorCodigo`, que cae al código crudo si no lo reconoce) y
  // el número en su propia columna, como en la página 57.
  y = asegurarEspacio(doc, y, medirBandaSujeto(doc, filasModifica(documento), anchoUtil));
  y = drawBandaSujeto(doc, filasModifica(documento), { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Detalle (`drawTablaDetalles` reserva su propio espacio: es dueña de su paginación fila a fila).
  y =
    drawTablaDetalles(doc, documento.detalles, { x: margenX, y, width: anchoUtil }, OPCIONES_DETALLE) +
    ESPACIADO_BLOQUE;

  // Pie de dos columnas: información adicional (izquierda), totales (derecha).
  const totales: TotalesRide = {
    impuestos: documento.totalConImpuestos,
    totalSinImpuestos: documento.totalSinImpuestos,
    importeTotal: documento.valorModificacion,
    moneda: documento.moneda,
  };

  const pie = { infoAdicional: documento.infoAdicional, totales };
  y = asegurarEspacio(doc, y, medirPie(doc, pie, anchoUtil));
  drawPie(doc, pie, { x: margenX, y, width: anchoUtil });

  return finalizar();
}

/**
 * Filas de la banda "comprobante que se modifica" (maqueta de la página 57).
 *
 * `codDocModificado` se imprime decodificado y en mayúsculas (`FACTURA`), tal
 * como la maqueta: `nombreDocumentoPorCodigo` devuelve el propio código si no
 * lo reconoce, así que un código fuera de catálogo se sigue viendo en el PDF
 * en vez de desaparecer.
 */
function filasModifica(documento: NotaCredito): FilaBanda[] {
  return [
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
    { izquierda: { etiqueta: 'Razón de Modificación:', valor: documento.motivo } },
  ];
}
