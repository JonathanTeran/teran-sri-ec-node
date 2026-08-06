import { describe, expect, it } from 'vitest';

import { TipoComprobante } from '../src/catalogs/index.js';
import type { DocSustento, GuiaRemision, Retencion } from '../src/documents/index.js';
import { generarRide } from '../src/ride/index.js';
import { generarClaveAcceso } from '../src/utils/clave-acceso.js';
import {
  guiaRemisionFixture,
  liquidacionCompraFixture,
  notaCreditoFixture,
  notaDebitoFixture,
  retencionFixture,
} from './documents.test.js';

/**
 * RIDE de los 5 comprobantes que no son factura, conforme a las maquetas del
 * **Anexo 2** de la Ficha Técnica del SRI: nota de crédito (página 57), nota
 * de débito (58), comprobante de retención (59), guía de remisión (60) y
 * liquidación de compra (61).
 *
 * Mismo criterio de test que `ride-factura.test.ts`: generar el PDF de cada
 * fixture real, extraer su texto con `pdfjs-dist` y verificar contenido real
 * — nunca solo el header `%PDF`. Además de los datos del documento, cada
 * bloque asserta las ETIQUETAS Y ENCABEZADOS LITERALES de su maqueta: son
 * parte de la especificación (el SRI publica la maqueta, no una lista de
 * campos), así que renombrar uno debe romper el test. No se repiten aquí los
 * tests de "dependencia opcional ausente"/"sin autorización"
 * (`ride-factura.test.ts` ya los cubre: son genéricos del motor de layout, no
 * dependen del tipo de comprobante).
 */

/** Mismo helper de extracción de texto que `ride-factura.test.ts` (ver ese archivo para el porqué del build "legacy" de pdfjs). */
async function extraerTextoPdf(pdfBytes: Uint8Array): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const documento = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

  const paginas: string[] = [];
  for (let i = 1; i <= documento.numPages; i++) {
    const pagina = await documento.getPage(i);
    const contenido = await pagina.getTextContent();
    paginas.push(contenido.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return paginas.join('\n');
}

/**
 * Mismos parámetros de clave de acceso que `test/xml-otros.test.ts` usa para
 * estos mismos fixtures (mismo `secuencial` de cada `infoTributaria`) — 49
 * dígitos reales de Módulo 11, no strings inventados.
 */
const claveLiquidacionCompra = generarClaveAcceso({
  fecha: '03/08/2026',
  tipoComprobante: TipoComprobante.LiquidacionCompra,
  ruc: '1790011001001',
  ambiente: '1',
  serie: '001001',
  numero: '000000002',
  codigoNum: '12345678',
});

const claveNotaCredito = generarClaveAcceso({
  fecha: '03/08/2026',
  tipoComprobante: TipoComprobante.NotaCredito,
  ruc: '1790011001001',
  ambiente: '1',
  serie: '001001',
  numero: '000000003',
  codigoNum: '12345678',
});

const claveNotaDebito = generarClaveAcceso({
  fecha: '03/08/2026',
  tipoComprobante: TipoComprobante.NotaDebito,
  ruc: '1790011001001',
  ambiente: '1',
  serie: '001001',
  numero: '000000004',
  codigoNum: '12345678',
});

const claveGuiaRemision = generarClaveAcceso({
  fecha: '03/08/2026',
  tipoComprobante: TipoComprobante.GuiaRemision,
  ruc: '1790011001001',
  ambiente: '1',
  serie: '001001',
  numero: '000000005',
  codigoNum: '12345678',
});

const claveRetencion = generarClaveAcceso({
  fecha: '03/08/2026',
  tipoComprobante: TipoComprobante.Retencion,
  ruc: '1790011001001',
  ambiente: '1',
  serie: '001001',
  numero: '000000006',
  codigoNum: '12345678',
});

/**
 * Texto sin NINGÚN espacio en blanco. El nombre del documento se imprime con
 * espaciado entre letras (`F A C T U R A`, maqueta del Anexo 2), y pdfjs lo
 * extrae con esos espacios intercalados: comparar sin espacios verifica que el
 * nombre está impreso sin depender de cómo el extractor represente el
 * espaciado.
 */
function sinEspacios(texto: string): string {
  return texto.replace(/\s+/g, '');
}

/**
 * `texto` contiene `fragmento` ignorando TODO el espaciado. Es como se
 * comparan los encabezados de tabla y las etiquetas largas: la maqueta los
 * envuelve a dos y tres líneas (`Base Imponible para la Retención`, `Precio
 * Sin Subsidio`) y pdfjs entrega cada línea como un `TextItem` aparte, así que
 * el texto extraído trae los saltos convertidos en espacios.
 */
function contiene(texto: string, fragmento: string): boolean {
  return sinEspacios(texto).includes(sinEspacios(fragmento));
}

/** Veces que `fragmento` aparece en `texto`, ignorando el espaciado. */
function vecesQueAparece(texto: string, fragmento: string): number {
  return sinEspacios(texto).split(sinEspacios(fragmento)).length - 1;
}

describe('ride: liquidación de compra', () => {
  it('genera un PDF conforme a la maqueta de la página 61: banda del proveedor, detalle con una columna "Detalle Adicional" y totales con las etiquetas de liquidación', async () => {
    const pdf = await generarRide({
      documento: liquidacionCompraFixture,
      claveAcceso: claveLiquidacionCompra,
      autorizacion: { numero: claveLiquidacionCompra, fecha: '03/08/2026 10:00:00' },
    });

    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const texto = await extraerTextoPdf(pdf);

    // Compartidos: razón social, RUC, número de comprobante, clave de acceso.
    expect(texto).toContain('COMERCIAL AMEPHIA S.A.');
    expect(texto).toContain('1790011001001');
    expect(sinEspacios(texto)).toContain(sinEspacios('LIQUIDACIÓN DE COMPRA'));
    expect(texto).toContain('001-001-000000002');
    expect(claveLiquidacionCompra).toHaveLength(49);
    expect(texto).toContain(claveLiquidacionCompra);

    // Banda del proveedor con las CUATRO etiquetas literales de la maqueta —
    // distintas de las de la banda del comprador de la factura (`Nombres y
    // Apellidos:`, no `Razón Social / Nombres y Apellidos:`; `Fecha Emision:`
    // va sin tilde en el original del SRI).
    for (const etiqueta of ['Nombres y Apellidos:', 'Identificación:', 'Fecha Emision:', 'Dirección:']) {
      expect(contiene(texto, etiqueta), `falta la etiqueta "${etiqueta}"`).toBe(true);
    }
    expect(texto).toContain(liquidacionCompraFixture.razonSocialProveedor);
    expect(texto).toContain(liquidacionCompraFixture.identificacionProveedor);
    expect(texto).toContain(liquidacionCompraFixture.direccionProveedor as string);

    // Detalle: UNA sola columna `Detalle Adicional` (la factura lleva tres) y
    // las dos columnas de subsidio, que la liquidación SÍ tiene.
    expect(vecesQueAparece(texto, 'Detalle Adicional')).toBe(1);
    expect(contiene(texto, 'Subsidio')).toBe(true);
    expect(contiene(texto, 'Precio Sin Subsidio')).toBe(true);
    // Cada descripción: prueba que `drawTablaDetalles` renderizó las filas (no
    // solo el encabezado de columnas, que se dibuja siempre). La columna
    // `Descripción` es estrecha y envuelve, así que se compara sin espacios.
    for (const detalle of liquidacionCompraFixture.detalles) {
      expect(sinEspacios(texto)).toContain(sinEspacios(detalle.descripcion));
    }

    // Formas de pago: encabezado + forma de pago decodificada. `importeTotal`
    // ('56.00') por sí solo no distingue este bloque del de "Totales" —en
    // este fixture un solo pago cubre el total, así que ambos bloques
    // imprimen el mismo número; el encabezado y la etiqueta decodificada solo
    // los imprime `drawFormasPago`.
    expect(texto).toContain('Forma de Pago');
    expect(texto).toContain('Sin utilización del sistema financiero'); // LABEL_FORMA_PAGO[FormaPago.EFECTIVO]

    // Totales con las etiquetas LITERALES de la página 61, que difieren de las
    // de la factura en cuatro filas.
    for (const etiqueta of [
      'SUBTOTAL 0%',
      'SUBTOTAL NO OBJETO DE IVA',
      'SUBTOTAL EXENTO DE IVA',
      'SUBTOTAL SIN IMPUESTOS',
      'TOTAL DESCUENTO',
      'VALOR TOTAL',
    ]) {
      expect(contiene(texto, etiqueta), `falta la fila de totales "${etiqueta}"`).toBe(true);
    }
    // Y NO las de la factura: la liquidación no redacta así esas cuatro filas.
    expect(contiene(texto, 'SUBTOTAL IVA 0%')).toBe(false);
    expect(contiene(texto, 'SUBTOTAL NO OBJETO IVA')).toBe(false);
    expect(contiene(texto, 'SUBTOTAL EXENTO IVA')).toBe(false);
    // Ni `PROPINA` ni el recuadro de subsidios (solo factura).
    expect(contiene(texto, 'PROPINA')).toBe(false);
    expect(contiene(texto, 'VALOR TOTAL SIN SUBSIDIO')).toBe(false);
    expect(texto).toContain(liquidacionCompraFixture.importeTotal);
  });
});

describe('ride: nota de crédito', () => {
  it('genera un PDF conforme a la maqueta de la página 57: banda "Comprobante que se modifica", detalle sin columnas de subsidio y totales sin propina', async () => {
    const pdf = await generarRide({
      documento: notaCreditoFixture,
      claveAcceso: claveNotaCredito,
      autorizacion: { numero: claveNotaCredito, fecha: '03/08/2026 10:00:00' },
    });

    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const texto = await extraerTextoPdf(pdf);

    expect(texto).toContain('COMERCIAL AMEPHIA S.A.');
    expect(sinEspacios(texto)).toContain(sinEspacios('NOTA DE CRÉDITO'));
    expect(texto).toContain('001-001-000000003');
    expect(claveNotaCredito).toHaveLength(49);
    expect(texto).toContain(claveNotaCredito);

    // Banda del comprador, con las etiquetas de la maqueta y sin título
    // (la página 57 arranca directamente en `Razón Social / Nombres...`).
    expect(contiene(texto, 'Razón Social / Nombres y Apellidos:')).toBe(true);
    expect(texto).toContain(notaCreditoFixture.razonSocialComprador);

    // Banda del comprobante que se modifica, con sus TRES etiquetas literales.
    // El tipo va decodificado y en mayúsculas (`FACTURA`), como en la maqueta;
    // `codDocModificado` ('01') solo, sin más contexto, no probaría nada por
    // sí mismo: es un substring trivial de la clave de acceso de 49 dígitos.
    for (const etiqueta of [
      'Comprobante que se modifica',
      'Fecha Emisión (Comprobante a modificar)',
      'Razón de Modificación:',
    ]) {
      expect(contiene(texto, etiqueta), `falta la etiqueta "${etiqueta}"`).toBe(true);
    }
    expect(texto).toContain('FACTURA');
    expect(texto).toContain(notaCreditoFixture.numDocModificado);
    expect(texto).toContain(notaCreditoFixture.fechaEmisionDocSustento);
    expect(texto).toContain(notaCreditoFixture.motivo);

    // Detalle: TRES columnas `Detalle Adicional` y NINGUNA de subsidio (la
    // maqueta de la nota de crédito no las lleva, la de la factura sí).
    expect(vecesQueAparece(texto, 'Detalle Adicional')).toBe(3);
    expect(contiene(texto, 'Subsidio')).toBe(false);
    expect(contiene(texto, 'Precio Unitario')).toBe(true);
    expect(contiene(texto, 'Precio Total')).toBe(true);
    for (const detalle of notaCreditoFixture.detalles) {
      // La columna `Descripción` de la maqueta es estrecha, así que una
      // descripción larga se envuelve y pdfjs la extrae partida en varias
      // líneas: se compara sin espacios.
      expect(sinEspacios(texto)).toContain(sinEspacios(detalle.descripcion));
    }

    // Totales: `valorModificacion` hace de "VALOR TOTAL" — a diferencia de
    // liquidación de compra, esta nota no tiene `pagos`, así que este valor
    // no coincide con ningún otro bloque en este fixture.
    expect(texto).toContain('SUBTOTAL SIN IMPUESTOS');
    expect(texto).toContain(notaCreditoFixture.valorModificacion);
    // Sin propina, sin recuadro de subsidios y sin tabla de formas de pago
    // (`NotaCredito` no modela `pagos`) — las tres, como en la maqueta.
    expect(contiene(texto, 'PROPINA')).toBe(false);
    expect(contiene(texto, 'VALOR TOTAL SIN SUBSIDIO')).toBe(false);
    expect(contiene(texto, 'Forma de Pago')).toBe(false);
  });
});

describe('ride: nota de débito', () => {
  it('genera un PDF conforme a la maqueta de la página 58: banda "Comprobante que se modifica", tabla RAZÓN/VALOR DE LA MODIFICACIÓN, formas de pago y totales', async () => {
    const pdf = await generarRide({
      documento: notaDebitoFixture,
      claveAcceso: claveNotaDebito,
      autorizacion: { numero: claveNotaDebito, fecha: '03/08/2026 10:00:00' },
    });

    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const texto = await extraerTextoPdf(pdf);

    expect(texto).toContain('COMERCIAL AMEPHIA S.A.');
    expect(sinEspacios(texto)).toContain(sinEspacios('NOTA DE DÉBITO'));
    expect(texto).toContain('001-001-000000004');
    expect(claveNotaDebito).toHaveLength(49);
    expect(texto).toContain(claveNotaDebito);
    // Tabla de motivos, con los DOS encabezados literales de la maqueta (que
    // en la nota de débito ocupa el lugar del detalle: este comprobante no
    // modela `detalles`).
    expect(contiene(texto, 'RAZÓN DE LA MODIFICACIÓN')).toBe(true);
    expect(contiene(texto, 'VALOR DE LA MODIFICACIÓN')).toBe(true);
    for (const motivo of notaDebitoFixture.motivos) {
      expect(texto).toContain(motivo.razon);
    }
    // Y NO hay tabla de detalle: la maqueta de la página 58 no la lleva.
    expect(contiene(texto, 'Detalle Adicional')).toBe(false);
    // Formas de pago: encabezado + forma de pago decodificada. Antes esta
    // prueba solo verificaba `valorTotal`, que también aparece en el bloque
    // de totales (mismo número, dos bloques) — confirmado con mutación
    // manual: comentando la llamada a `drawFormasPago` en
    // `nota-debito.ride.ts` este test seguía en verde sin este assert (ver
    // task-2-report.md, sección de la revisión).
    expect(texto).toContain('Forma de Pago');
    expect(texto).toContain('Sin utilización del sistema financiero'); // LABEL_FORMA_PAGO[FormaPago.EFECTIVO]
    // Totales, sin propina ni recuadro de subsidios (como en la maqueta).
    expect(texto).toContain('SUBTOTAL SIN IMPUESTOS');
    expect(texto).toContain(notaDebitoFixture.valorTotal);
    expect(contiene(texto, 'PROPINA')).toBe(false);
    expect(contiene(texto, 'VALOR TOTAL SIN SUBSIDIO')).toBe(false);
  });

  /**
   * Auditoría "campos fiscales omitidos", hallazgo 2 (CRÍTICO):
   * `codDocModificado`/`numDocModificado`/`fechaEmisionDocSustento` (y
   * `rise`) no se leían en ningún lado de `nota-debito.ride.ts` — el
   * comprobante que la nota de débito modifica no aparecía en el PDF.
   * Verificado con mutación: comentar la llamada a `drawBloqueTexto` del
   * bloque "COMPROBANTE QUE MODIFICA" en `nota-debito.ride.ts` hace fallar
   * este test (los 3 campos, en particular `numDocModificado`
   * ('001-001-000000001') y `fechaEmisionDocSustento` ('01/08/2026'), dejan
   * de aparecer — son justo los dos valores que la auditoría confirmó
   * ausentes con `pdftotext`). El bloque pasó de ser una caja de texto propia
   * a la banda `Comprobante que se modifica` / `Fecha Emisión (Comprobante a
   * modificar)` de la maqueta de la página 58, pero los 3 campos siguen
   * imprimiéndose.
   */
  it('imprime el comprobante que modifica (codDocModificado/numDocModificado/fechaEmisionDocSustento) y el RISE del emisor (hallazgo 2, CRÍTICO)', async () => {
    const pdf = await generarRide({
      documento: notaDebitoFixture,
      claveAcceso: claveNotaDebito,
      autorizacion: { numero: claveNotaDebito, fecha: '03/08/2026 10:00:00' },
    });
    const texto = await extraerTextoPdf(pdf);

    expect(contiene(texto, 'Comprobante que se modifica')).toBe(true);
    expect(contiene(texto, 'Fecha Emisión (Comprobante a modificar)')).toBe(true);
    // `codDocModificado` ('01') decodificado y en mayúsculas, como la maqueta.
    expect(texto).toContain('FACTURA');
    expect(texto).toContain(notaDebitoFixture.numDocModificado);
    expect(texto).toContain(notaDebitoFixture.fechaEmisionDocSustento);
    // `rise` del emisor (hallazgo 2 también lo señala como omitido).
    expect(texto).toContain('RISE');
    expect(texto).toContain(notaDebitoFixture.rise as string);
  });
});

describe('ride: guía de remisión', () => {
  it('genera un PDF conforme a la maqueta de la página 60: banda del transportista, banda por destinatario y su tabla Cantidad/Descripcion/Códigos, sin totales', async () => {
    const pdf = await generarRide({
      documento: guiaRemisionFixture,
      claveAcceso: claveGuiaRemision,
      autorizacion: { numero: claveGuiaRemision, fecha: '03/08/2026 10:00:00' },
    });

    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const texto = await extraerTextoPdf(pdf);

    expect(texto).toContain('COMERCIAL AMEPHIA S.A.');
    expect(sinEspacios(texto)).toContain(sinEspacios('GUÍA DE REMISIÓN'));
    expect(texto).toContain('001-001-000000005');
    expect(claveGuiaRemision).toHaveLength(49);
    expect(texto).toContain(claveGuiaRemision);

    // Banda del transportista, con las CINCO etiquetas literales de la
    // maqueta. `rucTransportista` coincide con el RUC del emisor en este
    // fixture (ambos '1790011001001'), así que por sí solo no probaría que
    // este bloque se dibujó: son las etiquetas las que lo confirman.
    for (const etiqueta of [
      'Identificación (Transportista)',
      'Razón Social / Nombres y Apellidos:',
      'Placa:',
      'Punto de Partida:',
      'Fecha inicio Transporte',
      'Fecha fin Transporte',
    ]) {
      expect(contiene(texto, etiqueta), `falta la etiqueta "${etiqueta}"`).toBe(true);
    }
    expect(texto).toContain(guiaRemisionFixture.razonSocialTransportista);
    expect(texto).toContain(guiaRemisionFixture.rucTransportista);
    expect(texto).toContain(guiaRemisionFixture.placa);
    expect(texto).toContain(guiaRemisionFixture.dirPartida);
    expect(texto).toContain(guiaRemisionFixture.fechaIniTransporte);
    expect(texto).toContain(guiaRemisionFixture.fechaFinTransporte);

    // Encabezados literales (y en el orden) de la tabla de detalle de la
    // maqueta: `Descripcion` va sin tilde en el original del SRI.
    for (const encabezado of ['Cantidad', 'Descripcion', 'Código Principal', 'Código Auxiliar']) {
      expect(contiene(texto, encabezado), `falta el encabezado "${encabezado}"`).toBe(true);
    }

    // Cada destinatario: sus etiquetas literales, sus datos y su detalle.
    for (const destinatario of guiaRemisionFixture.destinatarios) {
      for (const etiqueta of [
        'Comprobante de Venta:',
        'Fecha de Emisión:',
        'Número de Autorización:',
        'Motivo Traslado:',
        'Destino(Punto de llegada)',
        'Identificación (Destinatario)',
        'Razón Social/Nombres Apellidos',
      ]) {
        expect(contiene(texto, etiqueta), `falta la etiqueta "${etiqueta}"`).toBe(true);
      }
      expect(texto).toContain(destinatario.razonSocialDestinatario);
      expect(texto).toContain(destinatario.identificacionDestinatario);
      expect(texto).toContain(destinatario.dirDestinatario);
      expect(texto).toContain(destinatario.motivoTraslado);
      for (const detalle of destinatario.detalles) {
        // La columna `Descripcion` puede envolver, así que se compara sin espacios.
        expect(sinEspacios(texto)).toContain(sinEspacios(detalle.descripcion));
      }
    }

    // La guía de remisión NO lleva bloque de totales ni formas de pago (es el
    // único de los 6 comprobantes sin montos), pero sí `Información
    // Adicional` abajo a la izquierda.
    expect(contiene(texto, 'SUBTOTAL SIN IMPUESTOS')).toBe(false);
    expect(contiene(texto, 'VALOR TOTAL')).toBe(false);
    expect(contiene(texto, 'Forma de Pago')).toBe(false);
    expect(texto).toContain('Información Adicional');
  });

  it('renderiza el documento aduanero único y la ruta cuando el destinatario los trae (hallazgo de revisión: guiaRemisionFixture no ejercitaba estas dos ramas condicionales)', async () => {
    const guiaConAduanaYRuta: GuiaRemision = {
      ...guiaRemisionFixture,
      destinatarios: [
        {
          ...guiaRemisionFixture.destinatarios[0],
          docAduaneroUnico: 'DAU-2026-000123',
          ruta: 'Quito - Guayaquil vía E35',
        },
      ],
    };

    const pdf = await generarRide({ documento: guiaConAduanaYRuta, claveAcceso: claveGuiaRemision });
    const texto = await extraerTextoPdf(pdf);

    // Etiquetas literales de la maqueta (`Documento Aduanero`, `Ruta:`) + su valor.
    expect(contiene(texto, 'Documento Aduanero')).toBe(true);
    expect(texto).toContain('DAU-2026-000123');
    expect(contiene(texto, 'Ruta:')).toBe(true);
    expect(texto).toContain('Quito - Guayaquil vía E35');
  });

  /**
   * Auditoría "campos fiscales omitidos", hallazgo 8: `numAutDocSustento`
   * (ya presente en `guiaRemisionFixture.destinatarios[0]`) y
   * `codEstabDestino` no se leían en `guia-remision.ride.ts`. Verificado con
   * mutación: comentar las dos ramas `if` que las imprimen en
   * `lineasTraslado` hace fallar este test.
   */
  it('renderiza numAutDocSustento y codEstabDestino cuando el destinatario los trae (hallazgo 8)', async () => {
    // `codEstabDestino` con un valor que NO pueda aparecer por casualidad en
    // otro sitio del PDF: un '002' pelado es un substring trivial de la clave
    // de acceso de 49 dígitos y del propio número de comprobante, así que el
    // test pasaría igual aunque la fila desapareciera.
    const guiaConEstabDestino: GuiaRemision = {
      ...guiaRemisionFixture,
      destinatarios: [
        { ...guiaRemisionFixture.destinatarios[0], codEstabDestino: 'ESTAB-DESTINO-002' },
      ],
    };

    const pdf = await generarRide({ documento: guiaConEstabDestino, claveAcceso: claveGuiaRemision });
    const texto = await extraerTextoPdf(pdf);

    expect(contiene(texto, 'Número de Autorización:')).toBe(true);
    expect(texto).toContain(guiaRemisionFixture.destinatarios[0].numAutDocSustento as string);
    expect(contiene(texto, 'Código Establecimiento Destino')).toBe(true);
    expect(texto).toContain('ESTAB-DESTINO-002');
  });
});

describe('ride: retención', () => {
  it('genera un PDF conforme a la maqueta de la página 59: los 8 encabezados literales de la tabla de retenciones y NINGÚN bloque de totales', async () => {
    const pdf = await generarRide({
      documento: retencionFixture,
      claveAcceso: claveRetencion,
      autorizacion: { numero: claveRetencion, fecha: '03/08/2026 10:00:00' },
    });

    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const texto = await extraerTextoPdf(pdf);

    expect(texto).toContain('AGENTE RETENCION S.A.');
    expect(sinEspacios(texto)).toContain(sinEspacios('COMPROBANTE DE RETENCIÓN'));
    expect(texto).toContain('001-001-000000006');
    expect(claveRetencion).toHaveLength(49);
    expect(texto).toContain(claveRetencion);
    // Banda del sujeto retenido (sin título, como la maqueta).
    expect(contiene(texto, 'Razón Social / Nombres y Apellidos:')).toBe(true);
    expect(texto).toContain(retencionFixture.razonSocialSujetoRetenido);
    expect(texto).toContain(retencionFixture.identificacionSujetoRetenido);

    // Los OCHO encabezados de la tabla, literales y completos: la maqueta los
    // envuelve a dos líneas, pero nunca a mitad de palabra (hallazgo
    // confirmado en la revisión anterior: con columnas demasiado estrechas
    // pdfkit partía "Comprobante" en "Comprobant" / "e").
    for (const encabezado of [
      'Comprobante',
      'Número',
      'Fecha Emisión',
      'Ejercicio Fiscal',
      'Base Imponible para la Retención',
      'IMPUESTO',
      'Porcentaje Retención',
      'Valor Retenido',
    ]) {
      expect(contiene(texto, encabezado), `falta el encabezado "${encabezado}"`).toBe(true);
    }
    // Ninguna palabra del encabezado más largo quedó partida.
    expect(texto).toContain('Comprobante');
    expect(texto).toContain('Retención');

    // Filas: comprobante sustento decodificado (`FACTURA`), número, fechas,
    // ejercicio fiscal (el `periodoFiscal` del documento), base, impuesto,
    // porcentaje y valor retenido.
    expect(texto).toContain('FACTURA');
    expect(texto).toContain(retencionFixture.periodoFiscal);
    for (const docSustento of retencionFixture.docsSustento) {
      expect(texto).toContain(docSustento.numDocSustento);
      expect(texto).toContain(docSustento.fechaEmisionDocSustento);
      for (const retencion of docSustento.retenciones) {
        expect(texto).toContain(retencion.valorRetenido);
        expect(texto).toContain(retencion.baseImponible);
        expect(texto).toContain(`${retencion.porcentajeRetener}%`);
        // Columna `IMPUESTO`: el tipo decodificado ("IVA", vía
        // `LABEL_IMPUESTO_RETENCION` para `codigo: '2'`) MÁS el código de
        // retención de la Tabla 19/21 entre paréntesis ('303',
        // `codigoRetencion`) — son dos catálogos SRI distintos y la maqueta de
        // 2017 solo le da columna al primero, así que el segundo se conserva
        // aquí en vez de perderse.
        expect(texto).toContain(`IVA (${retencion.codigoRetencion})`);
      }
    }

    // La retención NO lleva bloque de totales ni tabla de formas de pago; sí
    // la caja `Información Adicional` abajo a la izquierda.
    expect(contiene(texto, 'SUBTOTAL SIN IMPUESTOS')).toBe(false);
    expect(contiene(texto, 'VALOR TOTAL')).toBe(false);
    expect(contiene(texto, 'Forma de Pago')).toBe(false);
    expect(texto).toContain('Información Adicional');
  });

  /**
   * Auditoría "campos fiscales omitidos", hallazgo 7 (MEDIO):
   * `filasDocsSustento` solo emitía filas desde el bucle interior sobre
   * `retenciones[]` — un `docSustento` con `retenciones: []` no generaba
   * ninguna fila EN LA TABLA, así que su `numDocSustento` no aparecía en la
   * tabla de documentos sustento (solo en el bloque "Detalle de Documentos
   * Sustento" del hallazgo 9, que es independiente y también lo imprime).
   * Por eso este test CUENTA ocurrencias del número en vez de usar
   * `toContain`: con el fix, aparece 2 veces (fila placeholder de la tabla +
   * bloque de detalle); sin él, solo 1 (el bloque de detalle solo). Sin
   * contar así, este test pasaría igual aunque `filasDocsSustento` volviera
   * a perder la fila — confirmado con la mutación de abajo.
   *
   * Verificado con mutación: quitar la rama `if
   * (docSustento.retenciones.length === 0)` de `filasDocsSustento` hace
   * fallar este test (pasa de 2 ocurrencias a 1).
   */
  it('un docSustento con retenciones vacío sigue generando su propia fila en la tabla de documentos sustento (hallazgo 7)', async () => {
    const retencionConDocVacio: Retencion = {
      ...retencionFixture,
      docsSustento: [
        ...retencionFixture.docsSustento,
        {
          codSustento: '01',
          codDocSustento: '01',
          numDocSustento: '001-001-000000200',
          fechaEmisionDocSustento: '02/08/2026',
          totalSinImpuestos: '500.00',
          importeTotal: '500.00',
          impuestosDocSustento: [],
          retenciones: [],
          pagos: [],
        },
      ],
    };

    const pdf = await generarRide({ documento: retencionConDocVacio, claveAcceso: claveRetencion });
    const texto = await extraerTextoPdf(pdf);

    const ocurrencias = texto.split('001-001-000000200').length - 1;
    // 1 en la tabla de documentos sustento (fila placeholder) + 1 en el
    // bloque "Detalle de Documentos Sustento" (hallazgo 9) = 2.
    expect(ocurrencias).toBe(2);
  });

  /**
   * Auditoría "campos fiscales omitidos", hallazgo 9 (MEDIO):
   * `importeTotal`, `codSustento`, `impuestosDocSustento[]` y `pagos[]` de
   * cada `docSustento` no se leían en ningún lado de `retencion.ride.ts` —
   * los valores de `retencionFixture` (`1120.00`, `120.00`, `1020.00` y
   * `factorProporcionalidad: '1.00'`) nunca aparecían en el PDF. Verificado
   * con mutación: comentar la llamada a `drawBloqueTexto` del bloque
   * "DETALLE DE DOCUMENTOS SUSTENTO" en `retencion.ride.ts` hace fallar este
   * test.
   */
  it('imprime importeTotal, codSustento, impuestosDocSustento[] y pagos[] de cada docSustento (hallazgo 9)', async () => {
    const pdf = await generarRide({ documento: retencionFixture, claveAcceso: claveRetencion });
    const texto = await extraerTextoPdf(pdf);
    const docSustento = retencionFixture.docsSustento[0];
    const impuesto = docSustento.impuestosDocSustento[0];
    const pago = docSustento.pagos[0];

    expect(texto).toContain('DETALLE DE DOCUMENTOS SUSTENTO');
    // El bloque recoge además el total retenido y el tipo de sujeto retenido,
    // que las 8 columnas oficiales de la tabla tampoco tienen dónde poner.
    expect(texto).toContain('Total Retenido');
    expect(texto).toContain(`Tipo de Sujeto Retenido: ${retencionFixture.tipoSujetoRetenido}`);
    expect(texto).toContain(`Código de Sustento: ${docSustento.codSustento}`);
    expect(texto).toContain(`Importe Total: ${docSustento.importeTotal}`);
    expect(docSustento.importeTotal).toBe('1120.00');
    expect(texto).toContain(impuesto.valorImpuesto);
    expect(impuesto.valorImpuesto).toBe('120.00');
    expect(texto).toContain(`factor de proporcionalidad ${impuesto.factorProporcionalidad}`);
    expect(pago.total).toBe('1020.00');
    expect(texto).toContain(pago.total);
  });
});

describe('ride: paginación (retención con muchas filas de documentos sustento)', () => {
  it('agrega páginas y no pierde filas cuando la tabla de documentos sustento no cabe en una sola página', async () => {
    const muchosDocsSustento: DocSustento[] = Array.from({ length: 60 }, (_, i) => ({
      codSustento: '01',
      codDocSustento: '01',
      numDocSustento: `001-001-${String(i + 1).padStart(9, '0')}`,
      fechaEmisionDocSustento: '01/08/2026',
      totalSinImpuestos: '100.00',
      importeTotal: '112.00',
      impuestosDocSustento: [
        {
          codImpuestoDocSustento: '2',
          codigoPorcentaje: '4',
          baseImponible: '100.00',
          tarifa: '12.00',
          valorImpuesto: '12.00',
        },
      ],
      retenciones: [
        {
          codigo: '2',
          codigoRetencion: '303',
          baseImponible: '100.00',
          porcentajeRetener: '10',
          valorRetenido: '10.00',
        },
      ],
      pagos: [{ formaPago: '01', total: '102.00' }],
    }));

    const retencionConMuchasFilas: Retencion = {
      ...retencionFixture,
      docsSustento: muchosDocsSustento,
    };

    const pdf = await generarRide({ documento: retencionConMuchasFilas, claveAcceso: claveRetencion });

    // Una sola carga del PDF: `pdfjs-dist` transfiere (y por lo tanto deja
    // inutilizable) el `ArrayBuffer` subyacente del `Uint8Array` que se le
    // pasa a `getDocument()` — llamarlo una segunda vez sobre el mismo
    // buffer (p.ej. reusando `extraerTextoPdf(pdf)` después de ya haber
    // cargado `pdf` una vez) revienta con `DataCloneError`. Por eso aquí se
    // lee `numPages` y el texto de cada página del mismo `documentoPdf`, en
    // vez de cargar el documento dos veces como en los tests de arriba.
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const documentoPdf = await pdfjsLib.getDocument({ data: pdf }).promise;
    expect(documentoPdf.numPages).toBeGreaterThan(1);

    const paginas: string[] = [];
    for (let i = 1; i <= documentoPdf.numPages; i++) {
      const pagina = await documentoPdf.getPage(i);
      const contenido = await pagina.getTextContent();
      paginas.push(contenido.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    const texto = paginas.join('\n');

    // La primera y la última fila deben aparecer: confirma que ninguna fila
    // se perdió (ni se dibujó fuera de la caja) al saltar de página.
    expect(texto).toContain(muchosDocsSustento[0].numDocSustento);
    expect(texto).toContain(muchosDocsSustento[muchosDocsSustento.length - 1].numDocSustento);
  });
});
