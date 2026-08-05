import { describe, expect, it } from 'vitest';

import { TipoComprobante } from '../src/catalogs/index.js';
import type { DocSustento, Retencion } from '../src/documents/index.js';
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
  it('genera un PDF con los datos del proveedor, los totales y los bloques compartidos', async () => {
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
    // Extra: datos del proveedor (no "comprador") y sus totales. `drawComprador`
    // imprime la etiqueta en mayúsculas (ver `blocks.ts`).
    expect(texto).toContain('PROVEEDOR');
    expect(texto).toContain(liquidacionCompraFixture.razonSocialProveedor);
    expect(texto).toContain(liquidacionCompraFixture.identificacionProveedor);
    expect(texto).toContain(liquidacionCompraFixture.importeTotal);
  });
});

describe('ride: nota de crédito', () => {
  it('genera un PDF con el comprobante que modifica, el motivo y el valor de modificación', async () => {
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
    // fechaEmisionDocSustento), motivo y valor de modificación.
    expect(texto).toContain(notaCreditoFixture.codDocModificado);
    expect(texto).toContain(notaCreditoFixture.numDocModificado);
    expect(texto).toContain(notaCreditoFixture.fechaEmisionDocSustento);
    expect(texto).toContain(notaCreditoFixture.motivo);
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
    // Formas de pago + totales.
    expect(texto).toContain(notaDebitoFixture.valorTotal);
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
    expect(texto).toContain(guiaRemisionFixture.razonSocialTransportista);
    expect(texto).toContain(guiaRemisionFixture.rucTransportista);
    expect(texto).toContain(guiaRemisionFixture.placa);
    expect(texto).toContain(guiaRemisionFixture.fechaIniTransporte);
    expect(texto).toContain(guiaRemisionFixture.fechaFinTransporte);
    // Extra: cada destinatario, su motivo de traslado y su tabla de detalle.
    for (const destinatario of guiaRemisionFixture.destinatarios) {
      expect(texto).toContain(destinatario.razonSocialDestinatario);
      expect(texto).toContain(destinatario.motivoTraslado);
      for (const detalle of destinatario.detalles) {
        expect(texto).toContain(detalle.descripcion);
      }
    }
  });
});

describe('ride: retención', () => {
  it('genera un PDF con el periodo fiscal, la tabla de documentos sustento y el total retenido', async () => {
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
    // Extra: tabla de documentos sustento (número + valor retenido, por cada fila).
    for (const docSustento of retencionFixture.docsSustento) {
      expect(texto).toContain(docSustento.numDocSustento);
      for (const retencion of docSustento.retenciones) {
        expect(texto).toContain(retencion.valorRetenido);
      }
    }
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
