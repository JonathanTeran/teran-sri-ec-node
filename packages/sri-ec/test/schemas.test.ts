import { describe, expect, it } from 'vitest';

import { TipoComprobante } from '../src/catalogs/index.js';
import { schemaFor, zodIssuesToErrors } from '../src/schemas/index.js';
import {
  facturaFixture,
  guiaRemisionFixture,
  liquidacionCompraFixture,
  notaCreditoFixture,
  notaDebitoFixture,
  retencionFixture,
} from './documents.test.js';

/**
 * Valida `data` contra el schema de `tipo` y devuelve las líneas
 * `"path: mensaje"` (vacío si es válido). Helper de test, no exportado por
 * el paquete.
 */
function errorsFor(tipo: TipoComprobante, data: unknown): string[] {
  const result = schemaFor(tipo).safeParse(data);
  return result.success ? [] : zodIssuesToErrors(result.error.issues);
}

describe('schemaFor(Factura)', () => {
  it('acepta el fixture válido', () => {
    const result = schemaFor(TipoComprobante.Factura).safeParse(facturaFixture);
    expect(result.success).toBe(true);
  });

  it('rechaza un ruc de 12 dígitos, nombrando el campo', () => {
    const errors = errorsFor(TipoComprobante.Factura, {
      ...facturaFixture,
      infoTributaria: { ...facturaFixture.infoTributaria, ruc: '179001100100' },
    });
    expect(errors.some((e) => e.startsWith('infoTributaria.ruc:'))).toBe(true);
  });

  it('rechaza un secuencial corto, nombrando el campo', () => {
    const errors = errorsFor(TipoComprobante.Factura, {
      ...facturaFixture,
      infoTributaria: { ...facturaFixture.infoTributaria, secuencial: '123' },
    });
    expect(errors.some((e) => e.startsWith('infoTributaria.secuencial:'))).toBe(true);
  });

  it("rechaza una fecha en formato ISO ('2026-01-26'), nombrando el campo", () => {
    const errors = errorsFor(TipoComprobante.Factura, {
      ...facturaFixture,
      fechaEmision: '2026-01-26',
    });
    expect(errors.some((e) => e.startsWith('fechaEmision:'))).toBe(true);
  });

  it('rechaza detalles vacío, nombrando el campo', () => {
    const errors = errorsFor(TipoComprobante.Factura, {
      ...facturaFixture,
      detalles: [],
    });
    expect(errors.some((e) => e.startsWith('detalles:'))).toBe(true);
  });

  it('rechaza un monto inválido en totalSinImpuestos, nombrando el campo', () => {
    const errors = errorsFor(TipoComprobante.Factura, {
      ...facturaFixture,
      totalSinImpuestos: 'cien',
    });
    expect(errors.some((e) => e.startsWith('totalSinImpuestos:'))).toBe(true);
  });

  it('rechaza claves no reconocidas (documento con campo extra)', () => {
    const errors = errorsFor(TipoComprobante.Factura, {
      ...facturaFixture,
      campoInventado: 'x',
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('schemaFor(LiquidacionCompra)', () => {
  it('acepta el fixture válido', () => {
    const result = schemaFor(TipoComprobante.LiquidacionCompra).safeParse(liquidacionCompraFixture);
    expect(result.success).toBe(true);
  });

  it('rechaza un secuencial corto, nombrando el campo', () => {
    const errors = errorsFor(TipoComprobante.LiquidacionCompra, {
      ...liquidacionCompraFixture,
      infoTributaria: { ...liquidacionCompraFixture.infoTributaria, secuencial: '42' },
    });
    expect(errors.some((e) => e.startsWith('infoTributaria.secuencial:'))).toBe(true);
  });
});

describe('schemaFor(NotaCredito)', () => {
  it('acepta el fixture válido', () => {
    const result = schemaFor(TipoComprobante.NotaCredito).safeParse(notaCreditoFixture);
    expect(result.success).toBe(true);
  });

  it('rechaza un ruc de 12 dígitos, nombrando el campo', () => {
    const errors = errorsFor(TipoComprobante.NotaCredito, {
      ...notaCreditoFixture,
      infoTributaria: { ...notaCreditoFixture.infoTributaria, ruc: '179001100100' },
    });
    expect(errors.some((e) => e.startsWith('infoTributaria.ruc:'))).toBe(true);
  });
});

describe('schemaFor(NotaDebito)', () => {
  it('acepta el fixture válido', () => {
    const result = schemaFor(TipoComprobante.NotaDebito).safeParse(notaDebitoFixture);
    expect(result.success).toBe(true);
  });

  it('rechaza motivos vacío, nombrando el campo', () => {
    const errors = errorsFor(TipoComprobante.NotaDebito, {
      ...notaDebitoFixture,
      motivos: [],
    });
    expect(errors.some((e) => e.startsWith('motivos:'))).toBe(true);
  });
});

describe('schemaFor(GuiaRemision)', () => {
  it('acepta el fixture válido', () => {
    const result = schemaFor(TipoComprobante.GuiaRemision).safeParse(guiaRemisionFixture);
    expect(result.success).toBe(true);
  });

  it('rechaza un ptoEmi que no son 3 dígitos, nombrando el campo', () => {
    const errors = errorsFor(TipoComprobante.GuiaRemision, {
      ...guiaRemisionFixture,
      infoTributaria: { ...guiaRemisionFixture.infoTributaria, ptoEmi: '1' },
    });
    expect(errors.some((e) => e.startsWith('infoTributaria.ptoEmi:'))).toBe(true);
  });
});

describe('schemaFor(Retencion)', () => {
  it('acepta el fixture válido', () => {
    const result = schemaFor(TipoComprobante.Retencion).safeParse(retencionFixture);
    expect(result.success).toBe(true);
  });

  it('rechaza docsSustento vacío, nombrando el campo', () => {
    const errors = errorsFor(TipoComprobante.Retencion, {
      ...retencionFixture,
      docsSustento: [],
    });
    expect(errors.some((e) => e.startsWith('docsSustento:'))).toBe(true);
  });

  it('acepta campos SRI adicionales no listados en las filas de docSustento (índice string)', () => {
    const result = schemaFor(TipoComprobante.Retencion).safeParse({
      ...retencionFixture,
      docsSustento: [
        {
          ...retencionFixture.docsSustento[0],
          retenciones: [{ ...retencionFixture.docsSustento[0].retenciones[0], campoSriExtra: 'valor' }],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('zodIssuesToErrors', () => {
  it('produce líneas "path: mensaje" a partir de los issues de un ZodError', () => {
    const result = schemaFor(TipoComprobante.Factura).safeParse({
      ...facturaFixture,
      infoTributaria: { ...facturaFixture.infoTributaria, ruc: '1' },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    const errors = zodIssuesToErrors(result.error.issues);
    expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/^infoTributaria\.ruc: .+/)]));
  });
});
