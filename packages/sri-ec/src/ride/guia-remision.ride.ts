import { TipoEmision } from '../catalogs/index.js';
import type { Destinatario, DestinatarioDetalle, GuiaRemision } from '../documents/index.js';
import {
  asegurarEspacio,
  construirColumnas,
  drawBandaSujeto,
  drawCabecera,
  drawPie,
  drawTablaGenerica,
  formatCantidadPrecision,
  formatNumeroComprobante,
  identificacionConTipo,
  medirBandaSujeto,
  medirCabecera,
  medirPie,
  nombreDocumento,
  nombreDocumentoPorCodigo,
} from './blocks.js';
import type { FilaBanda } from './blocks.js';
import { crearDocumentoRide } from './pdf-doc.js';
import { generarQr } from './qr.js';
import type { ComprobanteRide, EmisorRide, RideOptions } from './types.js';

/** Separación vertical entre bloques apilados. */
const ESPACIADO_BLOQUE = 10;

/**
 * Reparto de las filas de la guía que llevan DOS pares (`Fecha inicio
 * Transporte` / `Fecha fin Transporte`, `Comprobante de Venta:` / `Fecha de
 * Emisión:`). El reparto por defecto de la banda está afinado para la del
 * comprador, cuya etiqueta derecha es corta (`Identificación:`); aquí las dos
 * etiquetas son largas y los dos valores, cortos.
 */
const FRACCIONES_DOS_PARES = [0.26, 0.32, 0.19, 0.23] as const;

/**
 * Columnas del detalle de un destinatario, con los encabezados y el ORDEN
 * literales de la maqueta de la **página 60** (`Cantidad`, `Descripcion` —sin
 * tilde, como el original—, `Código Principal`, `Código Auxiliar`). Es un
 * shape distinto del `Detalle` compartido: no hay precio unitario ni
 * impuestos, porque una guía de remisión no lleva montos.
 */
const DESTINATARIO_DETALLE_COLUMN_SPECS: Array<[string, number, 'left' | 'center' | 'right']> = [
  ['Cantidad', 0.12, 'right'],
  ['Descripcion', 0.48, 'left'],
  ['Código Principal', 0.2, 'left'],
  ['Código Auxiliar', 0.2, 'left'],
];

/**
 * Celdas de una fila de detalle de destinatario, en el mismo orden que
 * {@link DESTINATARIO_DETALLE_COLUMN_SPECS}. `cantidad` usa
 * {@link formatCantidadPrecision} (hasta 6 decimales, sin redondear) — no
 * `formatMonto(d.cantidad, 2)`, que REDONDEABA una cantidad a granel (p.ej.
 * `0.001000`) a `0.00` (auditoría "campos fiscales omitidos", hallazgo 4).
 */
function celdasDestinatarioDetalle(d: DestinatarioDetalle): string[] {
  const extras = d.detallesAdicionales
    ? `\n${Object.entries(d.detallesAdicionales)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')}`
    : '';
  return [
    formatCantidadPrecision(d.cantidad),
    `${d.descripcion}${extras}`,
    d.codigoInterno ?? '',
    d.codigoAdicional ?? '',
  ];
}

/**
 * Filas de la banda de un destinatario, con las etiquetas literales de la
 * maqueta de la página 60 y en su orden: comprobante de venta que sustenta el
 * traslado (+ fecha de emisión en la misma fila), número de autorización,
 * motivo, destino, identificación y razón social del destinatario, documento
 * aduanero, código de establecimiento destino y ruta.
 *
 * Una etiqueta cuyo valor no viene NO se emite (la maqueta las imprime en
 * blanco, como plantilla; el RIDE generado no es una plantilla, y una etiqueta
 * sin valor parece un dato faltante del documento en vez de uno ausente en la
 * fuente — criterio de la auditoría "campos fiscales omitidos"). Ningún campo
 * de `Destinatario` se queda fuera: `numAutDocSustento` y `codEstabDestino`
 * (hallazgo 8) tienen aquí su fila propia.
 */
function filasDestinatario(destinatario: Destinatario): FilaBanda[] {
  const filas: FilaBanda[] = [];

  if (destinatario.codDocSustento || destinatario.numDocSustento) {
    const tipo = destinatario.codDocSustento
      ? nombreDocumentoPorCodigo(destinatario.codDocSustento).toUpperCase()
      : '';
    const comprobante = [tipo, destinatario.numDocSustento ?? ''].filter((parte) => parte !== '').join('   ');
    // La fecha de emisión del documento sustento comparte fila con el
    // comprobante, como en la maqueta. Si no viene, la fila se queda con dos
    // columnas y el comprobante ocupa todo el ancho.
    filas.push(
      destinatario.fechaEmisionDocSustento
        ? {
            izquierda: { etiqueta: 'Comprobante de Venta:', valor: comprobante },
            derecha: { etiqueta: 'Fecha de Emisión:', valor: destinatario.fechaEmisionDocSustento },
            fracciones: FRACCIONES_DOS_PARES,
          }
        : { izquierda: { etiqueta: 'Comprobante de Venta:', valor: comprobante } },
    );
  }

  const pares: Array<[string, string | undefined]> = [
    ['Número de Autorización:', destinatario.numAutDocSustento],
    ['Motivo Traslado:', destinatario.motivoTraslado],
    ['Destino(Punto de llegada)', destinatario.dirDestinatario],
    ['Identificación (Destinatario)', destinatario.identificacionDestinatario],
    ['Razón Social/Nombres Apellidos', destinatario.razonSocialDestinatario],
    ['Documento Aduanero', destinatario.docAduaneroUnico],
    ['Código Establecimiento Destino', destinatario.codEstabDestino],
    ['Ruta:', destinatario.ruta],
  ];
  for (const [etiqueta, valor] of pares) {
    if (valor !== undefined && valor.trim() !== '') {
      filas.push({ izquierda: { etiqueta, valor } });
    }
  }
  return filas;
}

/**
 * RIDE de Guía de Remisión (codDoc `06`), conforme a la maqueta de la
 * **página 60 del Anexo 2**: cabecera de dos columnas, banda del
 * transportista (`Identificación (Transportista)`, `Razón Social / Nombres y
 * Apellidos:`, `Placa:`, `Punto de Partida:`, `Fecha inicio Transporte` /
 * `Fecha fin Transporte`), y por cada destinatario su propia banda + su tabla
 * `Cantidad | Descripcion | Código Principal | Código Auxiliar`.
 *
 * **Sin bloque de totales**: es el único de los 6 comprobantes sin montos (no
 * hay `detalles`, `totalConImpuestos` ni `pagos` a nivel documento), así que
 * el pie se dibuja solo con `infoAdicional`.
 */
export async function generarRideGuiaRemision(opciones: RideOptions<GuiaRemision>): Promise<Uint8Array> {
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

  // Banda del transportista. `tipoIdentificacionTransportista` se imprime
  // decodificado junto al número (`(RUC)`), igual que en la banda del
  // comprador: es un campo real del documento.
  const filasTransportista: FilaBanda[] = [
    {
      izquierda: {
        etiqueta: 'Identificación (Transportista)',
        valor: identificacionConTipo(documento.rucTransportista, documento.tipoIdentificacionTransportista),
      },
    },
    { izquierda: { etiqueta: 'Razón Social / Nombres y Apellidos:', valor: documento.razonSocialTransportista } },
    { izquierda: { etiqueta: 'Placa:', valor: documento.placa } },
    { izquierda: { etiqueta: 'Punto de Partida:', valor: documento.dirPartida } },
    {
      izquierda: { etiqueta: 'Fecha inicio Transporte', valor: documento.fechaIniTransporte },
      derecha: { etiqueta: 'Fecha fin Transporte', valor: documento.fechaFinTransporte },
      fracciones: FRACCIONES_DOS_PARES,
    },
  ];
  y = asegurarEspacio(doc, y, medirBandaSujeto(doc, filasTransportista, anchoUtil));
  y = drawBandaSujeto(doc, filasTransportista, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

  // Una banda por destinatario, seguida de su tabla de detalle.
  const columnasDetalle = construirColumnas(anchoUtil, DESTINATARIO_DETALLE_COLUMN_SPECS);

  for (const destinatario of documento.destinatarios) {
    const filas = filasDestinatario(destinatario);
    y = asegurarEspacio(doc, y, medirBandaSujeto(doc, filas, anchoUtil));
    y = drawBandaSujeto(doc, filas, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;

    // `drawTablaGenerica` reserva su propio espacio: es dueña de su paginación fila a fila.
    const filasDetalle = destinatario.detalles.map(celdasDestinatarioDetalle);
    y = drawTablaGenerica(doc, columnasDetalle, filasDetalle, { x: margenX, y, width: anchoUtil }) + ESPACIADO_BLOQUE;
  }

  // Pie: solo `Información Adicional`. La guía de remisión no lleva bloque de
  // totales ni tabla de formas de pago.
  const pie = { infoAdicional: documento.infoAdicional };
  y = asegurarEspacio(doc, y, medirPie(doc, pie, anchoUtil));
  drawPie(doc, pie, { x: margenX, y, width: anchoUtil });

  return finalizar();
}
