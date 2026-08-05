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

  it('acepta dirEstablecimiento/contribuyenteEspecial cuando están presentes (fix round 1, gap real confirmado del reviewer)', () => {
    const result = schemaFor(TipoComprobante.Factura).safeParse({
      ...facturaFixture,
      dirEstablecimiento: 'Av. Amazonas N24-03, Quito',
      contribuyenteEspecial: '5368',
    });
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

/**
 * `dirEstablecimiento` (simpleType `direccion` del XSD, máx. 300) y
 * `contribuyenteEspecial` (simpleType `contribuyenteEspecial` del XSD, máx.
 * 13) se modelaban como `nonEmptyString` sin tope superior en los 6
 * schemas — un valor más largo pasaba zod, se firmaba y el SRI lo rechazaba
 * en la recepción, quemando la clave de acceso (hallazgo confirmado del
 * reviewer). `dirEstablecimientoField`/`contribuyenteEspecialField`
 * (`shared.schema.ts`) son un único objeto zod reusado por los 6
 * `*.schema.ts` — probarlo vía `Factura` (campo opcional) y `GuiaRemision`
 * (campo obligatorio) cubre ambos usos sin repetir el boundary test 6 veces.
 */
describe('dirEstablecimiento / contribuyenteEspecial: límites de longitud del XSD (hallazgo confirmado del reviewer)', () => {
  it('acepta dirEstablecimiento de exactamente 300 caracteres (límite del XSD)', () => {
    const result = schemaFor(TipoComprobante.Factura).safeParse({
      ...facturaFixture,
      dirEstablecimiento: 'A'.repeat(300),
    });
    expect(result.success).toBe(true);
  });

  it('rechaza dirEstablecimiento de 301 caracteres, nombrando el campo', () => {
    const errors = errorsFor(TipoComprobante.Factura, {
      ...facturaFixture,
      dirEstablecimiento: 'A'.repeat(301),
    });
    expect(errors.some((e) => e.startsWith('dirEstablecimiento:'))).toBe(true);
  });

  it('acepta contribuyenteEspecial de exactamente 13 caracteres (límite del XSD)', () => {
    const result = schemaFor(TipoComprobante.Factura).safeParse({
      ...facturaFixture,
      contribuyenteEspecial: '1234567890123',
    });
    expect(result.success).toBe(true);
  });

  it('rechaza contribuyenteEspecial de 14 caracteres, nombrando el campo', () => {
    const errors = errorsFor(TipoComprobante.Factura, {
      ...facturaFixture,
      contribuyenteEspecial: '12345678901234',
    });
    expect(errors.some((e) => e.startsWith('contribuyenteEspecial:'))).toBe(true);
  });

  it('rechaza dirEstablecimiento de 301 caracteres en GuiaRemision, donde el campo es obligatorio (no solo opcional)', () => {
    const errors = errorsFor(TipoComprobante.GuiaRemision, {
      ...guiaRemisionFixture,
      dirEstablecimiento: 'A'.repeat(301),
    });
    expect(errors.some((e) => e.startsWith('dirEstablecimiento:'))).toBe(true);
  });

  it('acepta dirEstablecimiento de exactamente 300 caracteres en GuiaRemision', () => {
    const result = schemaFor(TipoComprobante.GuiaRemision).safeParse({
      ...guiaRemisionFixture,
      dirEstablecimiento: 'A'.repeat(300),
    });
    expect(result.success).toBe(true);
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

  it('acepta impuestosDocSustento sin factorProporcionalidad ni baseImponibleModificada (minOccurs=0 en el XSD)', () => {
    const result = schemaFor(TipoComprobante.Retencion).safeParse({
      ...retencionFixture,
      docsSustento: [
        {
          ...retencionFixture.docsSustento[0],
          impuestosDocSustento: [
            {
              codImpuestoDocSustento: '2',
              codigoPorcentaje: '4',
              baseImponible: '1000.00',
              tarifa: '12.00',
              valorImpuesto: '120.00',
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('sigue rechazando un factorProporcionalidad presente pero mal formado', () => {
    const errors = errorsFor(TipoComprobante.Retencion, {
      ...retencionFixture,
      docsSustento: [
        {
          ...retencionFixture.docsSustento[0],
          impuestosDocSustento: [
            {
              ...retencionFixture.docsSustento[0].impuestosDocSustento[0],
              factorProporcionalidad: 'no-es-un-monto',
            },
          ],
        },
      ],
    });
    expect(errors.some((e) => e.includes('factorProporcionalidad'))).toBe(true);
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
