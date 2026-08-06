import { TipoEmision } from '../catalogs/index.js';
import type { LiquidacionCompra } from '../documents/index.js';
import {
  asegurarEspacio,
  drawBandaSujeto,
  drawCabecera,
  drawPie,
  drawTablaDetalles,
  formatNumeroComprobante,
  identificacionConTipo,
  medirBandaSujeto,
  medirCabecera,
  medirPie,
  nombreDocumento,
} from './blocks.js';
import type { FilaBanda } from './blocks.js';
import { crearDocumentoRide } from './pdf-doc.js';
import { generarQr } from './qr.js';
import type { ComprobanteRide, EmisorRide, EtiquetasTotales, RideOptions, TotalesRide } from './types.js';

/** Separación vertical entre bloques apilados. */
const ESPACIADO_BLOQUE = 10;

/**
 * Columnas `Detalle Adicional` del detalle de la liquidación de compra: UNA
 * (maqueta de la página 61), no las tres de la factura. El resto de columnas
 * —incluidas `Subsidio` y `Precio sin Subsidio`— son las mismas que la
 * factura, de ahí que solo se sobreescriba este número.
 */
const OPCIONES_DETALLE = { detallesAdicionales: 1 };

/**
 * Etiquetas de la tabla de totales de la maqueta de la página 61. La
 * liquidación de compra redacta cuatro de las filas distinto que la factura
 * (`SUBTOTAL 0%` en vez de `SUBTOTAL IVA 0%`, `NO OBJETO DE IVA` en vez de `NO
 * OBJETO IVA`, `EXENTO DE IVA` en vez de `EXENTO IVA`, `TOTAL DESCUENTO` en
 * vez de `DESCUENTO`); el resto —`SUBTOTAL SIN IMPUESTOS`, `ICE`, `IVA`,
 * `IRBPNR`, `VALOR TOTAL`— coincide y se hereda del default.
 */
const ETIQUETAS_TOTALES: Partial<EtiquetasTotales> = {
  subtotalCero: 'SUBTOTAL 0%',
  subtotalNoObjeto: 'SUBTOTAL NO OBJETO DE IVA',
  subtotalExento: 'SUBTOTAL EXENTO DE IVA',
  descuento: 'TOTAL DESCUENTO',
};

/**
 * RIDE de Liquidación de Compra (codDoc `03`), conforme a la maqueta de la
 * **página 61 del Anexo 2** de la Ficha Técnica del SRI: cabecera de dos
 * columnas, banda del proveedor con las etiquetas literales de esa página
 * (`Nombres y Apellidos:` / `Identificación:` / `Fecha Emision:` /
 * `Dirección:`, una por fila y sin título), detalle con UNA columna `Detalle
 * Adicional` y pie de dos columnas.
 *
 * A diferencia de la factura, su tabla de totales no lleva `PROPINA` ni el
 * recuadro de subsidios, y cuatro de sus filas usan otra redacción (ver
 * {@link ETIQUETAS_TOTALES}). `LiquidacionCompra` tampoco modela
 * `guiaRemision`.
 */
export async function generarRideLiquidacionCompra(opciones: RideOptions<LiquidacionCompra>): Promise<Uint8Array> {
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
  const cabecera = { emisor, comprobante, qr, codigoBarras };
  y = asegurarEspacio(doc, y, medirCabecera(doc, cabecera, anchoUtil));
  y = drawCabecera(doc, cabecera, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Banda del proveedor. La maqueta de la página 61 NO reusa la banda del
  // comprador de la factura: sus cuatro etiquetas son distintas
  // (`Nombres y Apellidos:`, no `Razón Social / Nombres y Apellidos:`; `Fecha
  // Emision:`, sin tilde) y van una por fila, no emparejadas de dos en dos.
  // `tipoIdentificacionProveedor` se imprime decodificado junto al número, como
  // en `drawComprador` — es un campo real del documento y perderlo sería un
  // dato menos en el PDF.
  const filasProveedor: FilaBanda[] = [
    { izquierda: { etiqueta: 'Nombres y Apellidos:', valor: documento.razonSocialProveedor } },
    {
      izquierda: {
        etiqueta: 'Identificación:',
        valor: identificacionConTipo(documento.identificacionProveedor, documento.tipoIdentificacionProveedor),
      },
    },
    { izquierda: { etiqueta: 'Fecha Emision:', valor: documento.fechaEmision } },
  ];
  if (documento.direccionProveedor !== undefined && documento.direccionProveedor.trim() !== '') {
    filasProveedor.push({ izquierda: { etiqueta: 'Dirección:', valor: documento.direccionProveedor } });
  }
  y = asegurarEspacio(doc, y, medirBandaSujeto(doc, filasProveedor, anchoUtil));
  y = drawBandaSujeto(doc, filasProveedor, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Detalle (`drawTablaDetalles` reserva su propio espacio: es dueña de su paginación fila a fila).
  y = drawTablaDetalles(doc, documento.detalles, { x: margenX, y, width: anchoUtil }, OPCIONES_DETALLE) +
    ESPACIADO_BLOQUE;

  // Pie de dos columnas: información adicional + formas de pago (izquierda),
  // totales (derecha). Sin `conPropina` ni `conSubsidio`: la maqueta de la
  // página 61 termina la tabla en `VALOR TOTAL`.
  const totales: TotalesRide = {
    impuestos: documento.totalConImpuestos,
    totalSinImpuestos: documento.totalSinImpuestos,
    totalDescuento: documento.totalDescuento,
    importeTotal: documento.importeTotal,
    moneda: documento.moneda,
    etiquetas: ETIQUETAS_TOTALES,
  };

  const pie = { infoAdicional: documento.infoAdicional, pagos: documento.pagos, totales };
  y = asegurarEspacio(doc, y, medirPie(doc, pie, anchoUtil));
  drawPie(doc, pie, { x: margenX, y, width: anchoUtil });

  return finalizar();
}
