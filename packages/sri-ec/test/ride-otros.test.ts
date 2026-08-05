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
 * RIDE de los 5 comprobantes que no son factura (Task 2 del plan RIDE, ver
 * `docs/plans/2026-08-04-ride.md`). Mismo criterio de test que
 * `ride-factura.test.ts` (Task 1): generar el PDF de cada fixture real,
 * extraer su texto con `pdfjs-dist` y verificar contenido real — nunca solo
 * el header `%PDF`. No se repiten aquí los tests de "dependencia opcional
 * ausente"/"sin autorización" (ride-factura.test.ts ya los cubre: son
 * genéricos del motor de layout, no dependen del tipo de comprobante).
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

describe('ride: liquidación de compra', () => {
  it('genera un PDF con los datos del proveedor, la tabla de detalle, formas de pago y totales', async () => {
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
    expect(texto).toContain('LIQUIDACIÓN DE COMPRA');
    expect(texto).toContain('001-001-000000002');
    expect(claveLiquidacionCompra).toHaveLength(49);
    expect(texto).toContain(claveLiquidacionCompra);
    // Extra: datos del proveedor (no "comprador"). `drawComprador` imprime la
    // etiqueta en mayúsculas (ver `blocks.ts`).
    expect(texto).toContain('PROVEEDOR');
    expect(texto).toContain(liquidacionCompraFixture.razonSocialProveedor);
    expect(texto).toContain(liquidacionCompraFixture.identificacionProveedor);
    // Detalle: cada descripción — prueba que `drawTablaDetalles` renderizó
    // las filas (no solo el encabezado de columnas, que se dibuja siempre).
    for (const detalle of liquidacionCompraFixture.detalles) {
      expect(texto).toContain(detalle.descripcion);
    }
    // Formas de pago: encabezado + forma de pago decodificada. `importeTotal`
    // ('56.00') por sí solo no distingue este bloque del de "Totales" —en
    // este fixture un solo pago cubre el total, así que ambos bloques
    // imprimen el mismo número; el encabezado y la etiqueta decodificada solo
    // los imprime `drawFormasPago`.
    expect(texto).toContain('FORMAS DE PAGO');
    expect(texto).toContain('Sin utilización del sistema financiero'); // LABEL_FORMA_PAGO[FormaPago.EFECTIVO]
    // Totales.
    expect(texto).toContain('TOTALES');
    expect(texto).toContain(liquidacionCompraFixture.importeTotal);
  });
});

describe('ride: nota de crédito', () => {
  it('genera un PDF con el comprobante que modifica, la tabla de detalle, el motivo y el valor de modificación', async () => {
    const pdf = await generarRide({
      documento: notaCreditoFixture,
      claveAcceso: claveNotaCredito,
      autorizacion: { numero: claveNotaCredito, fecha: '03/08/2026 10:00:00' },
    });

    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const texto = await extraerTextoPdf(pdf);

    expect(texto).toContain('COMERCIAL AMEPHIA S.A.');
    expect(texto).toContain('NOTA DE CRÉDITO');
    expect(texto).toContain('001-001-000000003');
    expect(claveNotaCredito).toHaveLength(49);
    expect(texto).toContain(claveNotaCredito);
    // Extra: comprobante que modifica (codDocModificado + numDocModificado +
    // fechaEmisionDocSustento) + motivo. `codDocModificado` ('01') solo, sin
    // más contexto, no prueba nada por sí mismo: es un substring trivial de
    // la clave de acceso de 49 dígitos y de otros números del documento —
    // verificado (`claveNotaCredito.includes('01') === true`). Se verifica la
    // línea completa tal como la compone `nota-credito.ride.ts`.
    expect(texto).toContain('COMPROBANTE QUE MODIFICA');
    expect(texto).toContain(`Tipo de Comprobante Modificado: ${notaCreditoFixture.codDocModificado} - Factura`);
    expect(texto).toContain(notaCreditoFixture.numDocModificado);
    expect(texto).toContain(notaCreditoFixture.fechaEmisionDocSustento);
    expect(texto).toContain(notaCreditoFixture.motivo);
    // Detalle: cada descripción.
    for (const detalle of notaCreditoFixture.detalles) {
      expect(texto).toContain(detalle.descripcion);
    }
    // Totales: `valorModificacion` hace de "VALOR TOTAL" — a diferencia de
    // liquidación de compra, esta nota no tiene `pagos`, así que este valor
    // no coincide con ningún otro bloque en este fixture.
    expect(texto).toContain('TOTALES');
    expect(texto).toContain(notaCreditoFixture.valorModificacion);
  });
});

describe('ride: nota de débito', () => {
  it('genera un PDF con la tabla de motivos, formas de pago y totales', async () => {
    const pdf = await generarRide({
      documento: notaDebitoFixture,
      claveAcceso: claveNotaDebito,
      autorizacion: { numero: claveNotaDebito, fecha: '03/08/2026 10:00:00' },
    });

    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const texto = await extraerTextoPdf(pdf);

    expect(texto).toContain('COMERCIAL AMEPHIA S.A.');
    expect(texto).toContain('NOTA DE DÉBITO');
    expect(texto).toContain('001-001-000000004');
    expect(claveNotaDebito).toHaveLength(49);
    expect(texto).toContain(claveNotaDebito);
    // Extra: tabla de motivos (razón/valor).
    for (const motivo of notaDebitoFixture.motivos) {
      expect(texto).toContain(motivo.razon);
    }
    // Formas de pago: encabezado + forma de pago decodificada. Antes esta
    // prueba solo verificaba `valorTotal`, que también aparece en el bloque
    // de totales (mismo número, dos bloques) — confirmado con mutación
    // manual: comentando la llamada a `drawFormasPago` en
    // `nota-debito.ride.ts` este test seguía en verde sin este assert (ver
    // task-2-report.md, sección de la revisión).
    expect(texto).toContain('FORMAS DE PAGO');
    expect(texto).toContain('Sin utilización del sistema financiero'); // LABEL_FORMA_PAGO[FormaPago.EFECTIVO]
    // Totales.
    expect(texto).toContain('TOTALES');
    expect(texto).toContain(notaDebitoFixture.valorTotal);
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
   * ausentes con `pdftotext`).
   */
  it('imprime el comprobante que modifica (codDocModificado/numDocModificado/fechaEmisionDocSustento) y el RISE del emisor (hallazgo 2, CRÍTICO)', async () => {
    const pdf = await generarRide({
      documento: notaDebitoFixture,
      claveAcceso: claveNotaDebito,
      autorizacion: { numero: claveNotaDebito, fecha: '03/08/2026 10:00:00' },
    });
    const texto = await extraerTextoPdf(pdf);

    expect(texto).toContain('COMPROBANTE QUE MODIFICA');
    expect(texto).toContain(`Tipo de Comprobante Modificado: ${notaDebitoFixture.codDocModificado} - Factura`);
    expect(texto).toContain(notaDebitoFixture.numDocModificado);
    expect(texto).toContain(notaDebitoFixture.fechaEmisionDocSustento);
    // `rise` del emisor (hallazgo 2 también lo señala como omitido).
    expect(texto).toContain('RISE');
    expect(texto).toContain(notaDebitoFixture.rise as string);
  });
});

describe('ride: guía de remisión', () => {
  it('genera un PDF con el transportista, la placa, las fechas de transporte y cada destinatario con su detalle', async () => {
    const pdf = await generarRide({
      documento: guiaRemisionFixture,
      claveAcceso: claveGuiaRemision,
      autorizacion: { numero: claveGuiaRemision, fecha: '03/08/2026 10:00:00' },
    });

    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const texto = await extraerTextoPdf(pdf);

    expect(texto).toContain('COMERCIAL AMEPHIA S.A.');
    expect(texto).toContain('GUÍA DE REMISIÓN');
    expect(texto).toContain('001-001-000000005');
    expect(claveGuiaRemision).toHaveLength(49);
    expect(texto).toContain(claveGuiaRemision);
    // Extra: transportista, placa, fechas de inicio/fin de transporte.
    // `rucTransportista` coincide con el RUC del emisor en este fixture
    // (ambos '1790011001001'), así que por sí solo no prueba que este bloque
    // se dibujó — el encabezado "TRANSPORTISTA" (que solo imprime este
    // bloque) es lo que realmente lo confirma.
    expect(texto).toContain('TRANSPORTISTA');
    expect(texto).toContain(guiaRemisionFixture.razonSocialTransportista);
    expect(texto).toContain(guiaRemisionFixture.rucTransportista);
    expect(texto).toContain(guiaRemisionFixture.placa);
    expect(texto).toContain(guiaRemisionFixture.fechaIniTransporte);
    expect(texto).toContain(guiaRemisionFixture.fechaFinTransporte);
    // Extra: cada destinatario (encabezado + razón social + identificación),
    // su motivo de traslado (encabezado + texto) y su tabla de detalle.
    for (const destinatario of guiaRemisionFixture.destinatarios) {
      expect(texto).toContain('DESTINATARIO');
      expect(texto).toContain(destinatario.razonSocialDestinatario);
      expect(texto).toContain(destinatario.identificacionDestinatario);
      expect(texto).toContain('DATOS DEL TRASLADO');
      expect(texto).toContain(destinatario.motivoTraslado);
      for (const detalle of destinatario.detalles) {
        expect(texto).toContain(detalle.descripcion);
      }
    }
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

    expect(texto).toContain('Documento Aduanero Único: DAU-2026-000123');
    expect(texto).toContain('Ruta: Quito - Guayaquil vía E35');
  });

  /**
   * Auditoría "campos fiscales omitidos", hallazgo 8: `numAutDocSustento`
   * (ya presente en `guiaRemisionFixture.destinatarios[0]`) y
   * `codEstabDestino` no se leían en `guia-remision.ride.ts`. Verificado con
   * mutación: comentar las dos ramas `if` que las imprimen en
   * `lineasTraslado` hace fallar este test.
   */
  it('renderiza numAutDocSustento y codEstabDestino cuando el destinatario los trae (hallazgo 8)', async () => {
    const guiaConEstabDestino: GuiaRemision = {
      ...guiaRemisionFixture,
      destinatarios: [
        { ...guiaRemisionFixture.destinatarios[0], codEstabDestino: '002' },
      ],
    };

    const pdf = await generarRide({ documento: guiaConEstabDestino, claveAcceso: claveGuiaRemision });
    const texto = await extraerTextoPdf(pdf);

    expect(texto).toContain(
      `Número de Autorización del Documento Sustento: ${guiaRemisionFixture.destinatarios[0].numAutDocSustento}`,
    );
    expect(texto).toContain('Código de Establecimiento Destino: 002');
  });
});

describe('ride: retención', () => {
  it('genera un PDF con el periodo fiscal, la tabla de documentos sustento (impuesto decodificado + código de retención) y el total retenido', async () => {
    const pdf = await generarRide({
      documento: retencionFixture,
      claveAcceso: claveRetencion,
      autorizacion: { numero: claveRetencion, fecha: '03/08/2026 10:00:00' },
    });

    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const texto = await extraerTextoPdf(pdf);

    expect(texto).toContain('AGENTE RETENCION S.A.');
    expect(texto).toContain('COMPROBANTE DE RETENCIÓN');
    expect(texto).toContain('001-001-000000006');
    expect(claveRetencion).toHaveLength(49);
    expect(texto).toContain(claveRetencion);
    // Extra: sujeto retenido, periodo fiscal y bloque de total retenido.
    expect(texto).toContain(retencionFixture.razonSocialSujetoRetenido);
    expect(texto).toContain('Período Fiscal');
    expect(texto).toContain(retencionFixture.periodoFiscal);
    expect(texto).toContain('Total Retenido');
    // Extra: tabla de documentos sustento — número, código de retención y
    // valor retenido, por cada fila.
    for (const docSustento of retencionFixture.docsSustento) {
      expect(texto).toContain(docSustento.numDocSustento);
      for (const retencion of docSustento.retenciones) {
        expect(texto).toContain(retencion.valorRetenido);
        expect(texto).toContain(retencion.codigoRetencion);
      }
    }
    // Columna "Impuesto": debe mostrar el tipo de impuesto decodificado
    // ("IVA", vía `LABEL_IMPUESTO_RETENCION` en `retencion.ride.ts` para
    // `codigo: '2'`), no el código de retención crudo ('303', que es
    // `codigoRetencion` y va en su propia columna "Código" — hallazgo
    // confirmado de la revisión).
    expect(texto).toContain('IVA');
    // Encabezados "Comprobante" y "Fecha Emisión" completos, no partidos a
    // la mitad (hallazgo confirmado del reviewer: con las columnas a 0.1 y
    // 0.11 de ancho, pdfkit envolvía el encabezado en dos líneas —
    // "Comprobant" / "e" — y `extraerTextoPdf` (une los `TextItem` de
    // pdfjs con un espacio) lo habría mostrado como "Comprobant e").
    expect(texto).toContain('Comprobante');
    expect(texto).toContain('Fecha Emisión');
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
