import { describe, expect, it } from 'vitest';

import type { Factura, NotaCredito, NotaDebito, Retencion } from '../src/documents/index.js';
import { ValidationError } from '../src/errors/index.js';
import { assertValid, validateBusiness } from '../src/schemas/business-validator.js';
import {
  facturaFixture,
  guiaRemisionFixture,
  liquidacionCompraFixture,
  notaCreditoFixture,
  notaDebitoFixture,
  retencionFixture,
} from './documents.test.js';

describe('validateBusiness', () => {
  it.each([
    ['Factura', facturaFixture],
    ['LiquidacionCompra', liquidacionCompraFixture],
    ['NotaCredito', notaCreditoFixture],
    ['NotaDebito', notaDebitoFixture],
    ['GuiaRemision', guiaRemisionFixture],
    ['Retencion', retencionFixture],
  ] as const)('%s: el fixture cuadra -> []', (_nombre, fixture) => {
    expect(validateBusiness(fixture)).toEqual([]);
  });

  describe('Factura', () => {
    it('importeTotal roto produce un error que menciona "importeTotal"', () => {
      const roto: Factura = { ...facturaFixture, importeTotal: '999.00' };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('importeTotal:'))).toBe(true);
    });

    it('la suma de pagos.total distinta de importeTotal menciona "importeTotal"', () => {
      const roto: Factura = { ...facturaFixture, pagos: [{ formaPago: '01', total: '50.00' }] };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('importeTotal:'))).toBe(true);
    });

    it('la suma de detalles.precioTotalSinImpuesto distinta de totalSinImpuestos menciona "totalSinImpuestos"', () => {
      const roto: Factura = { ...facturaFixture, totalSinImpuestos: '50.00' };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('totalSinImpuestos:'))).toBe(true);
    });

    it('la agregación de impuestos de detalles distinta de totalConImpuestos menciona "totalConImpuestos"', () => {
      const roto: Factura = {
        ...facturaFixture,
        totalConImpuestos: [{ codigo: '2', codigoPorcentaje: '4', baseImponible: '100.00', valor: '11.00' }],
      };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('totalConImpuestos:'))).toBe(true);
    });

    it('cantidad*precioUnitario-descuento a ±1 centavo de precioTotalSinImpuesto no dispara error de detalle', () => {
      const tolerado: Factura = {
        ...facturaFixture,
        detalles: [{ ...facturaFixture.detalles[0], precioTotalSinImpuesto: '100.01' }],
      };
      const errors = validateBusiness(tolerado);
      expect(errors.some((e) => e.includes('cantidad*precioUnitario'))).toBe(false);
    });

    it('cantidad*precioUnitario-descuento a ±2 centavos de precioTotalSinImpuesto sí dispara error de detalle', () => {
      const roto: Factura = {
        ...facturaFixture,
        detalles: [{ ...facturaFixture.detalles[0], precioTotalSinImpuesto: '100.02' }],
      };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.includes('cantidad*precioUnitario') && e.startsWith('detalles[0]'))).toBe(true);
    });

    it('un RUC con tercer dígito inválido menciona "infoTributaria.ruc"', () => {
      const roto: Factura = {
        ...facturaFixture,
        infoTributaria: { ...facturaFixture.infoTributaria, ruc: '1770011001001' },
      };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('infoTributaria.ruc:'))).toBe(true);
    });

    it('un RUC con código de establecimiento "000" menciona "infoTributaria.ruc"', () => {
      const roto: Factura = {
        ...facturaFixture,
        infoTributaria: { ...facturaFixture.infoTributaria, ruc: '1790011001000' },
      };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('infoTributaria.ruc:'))).toBe(true);
    });

    it('un nombreComercial de más de 300 caracteres menciona "infoTributaria.nombreComercial"', () => {
      const roto: Factura = {
        ...facturaFixture,
        infoTributaria: { ...facturaFixture.infoTributaria, nombreComercial: 'A'.repeat(301) },
      };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('infoTributaria.nombreComercial:'))).toBe(true);
    });

    it('una dirMatriz de más de 300 caracteres menciona "infoTributaria.dirMatriz"', () => {
      const roto: Factura = {
        ...facturaFixture,
        infoTributaria: { ...facturaFixture.infoTributaria, dirMatriz: 'B'.repeat(301) },
      };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('infoTributaria.dirMatriz:'))).toBe(true);
    });

    it('una formaPago fuera del catálogo SRI menciona "formaPago"', () => {
      const roto: Factura = { ...facturaFixture, pagos: [{ formaPago: '99', total: '112.00' }] };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.includes('formaPago') && e.startsWith('pagos[0]'))).toBe(true);
    });
  });

  describe('LiquidacionCompra', () => {
    it('importeTotal roto produce un error que menciona "importeTotal"', () => {
      const roto = { ...liquidacionCompraFixture, importeTotal: '999.00' };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('importeTotal:'))).toBe(true);
    });
  });

  describe('NotaCredito', () => {
    it('valorModificacion incoherente con totalSinImpuestos+impuestos menciona "valorModificacion"', () => {
      const roto: NotaCredito = { ...notaCreditoFixture, valorModificacion: '999.00' };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('valorModificacion:'))).toBe(true);
    });
  });

  describe('NotaDebito', () => {
    it('valorTotal incoherente con totalSinImpuestos+impuestos menciona "valorTotal"', () => {
      const roto: NotaDebito = { ...notaDebitoFixture, valorTotal: '999.00' };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('valorTotal:'))).toBe(true);
    });

    it('la suma de pagos.total distinta de valorTotal menciona "valorTotal"', () => {
      const roto: NotaDebito = { ...notaDebitoFixture, pagos: [{ formaPago: '01', total: '1.00' }] };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('valorTotal:'))).toBe(true);
    });
  });

  describe('GuiaRemision', () => {
    it('un rucTransportista con tercer dígito inválido menciona "rucTransportista"', () => {
      const roto = { ...guiaRemisionFixture, rucTransportista: '1770011001001' };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('rucTransportista:'))).toBe(true);
    });
  });

  describe('Retencion', () => {
    it('valorRetenido malo produce un error que menciona "valorRetenido"', () => {
      const roto: Retencion = {
        ...retencionFixture,
        docsSustento: [
          {
            ...retencionFixture.docsSustento[0],
            retenciones: [{ ...retencionFixture.docsSustento[0].retenciones[0], valorRetenido: '50.00' }],
          },
        ],
      };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('docsSustento[0].retenciones[0].valorRetenido:'))).toBe(true);
    });

    it('valorRetenido a ±1 centavo de baseImponible*porcentaje/100 no dispara error', () => {
      const tolerado: Retencion = {
        ...retencionFixture,
        docsSustento: [
          {
            ...retencionFixture.docsSustento[0],
            retenciones: [{ ...retencionFixture.docsSustento[0].retenciones[0], valorRetenido: '100.01' }],
          },
        ],
      };
      expect(validateBusiness(tolerado)).toEqual([]);
    });

    it('valorRetenido a ±2 centavos de baseImponible*porcentaje/100 sí dispara error', () => {
      const roto: Retencion = {
        ...retencionFixture,
        docsSustento: [
          {
            ...retencionFixture.docsSustento[0],
            retenciones: [{ ...retencionFixture.docsSustento[0].retenciones[0], valorRetenido: '100.02' }],
          },
        ],
      };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('docsSustento[0].retenciones[0].valorRetenido:'))).toBe(true);
    });

    it('una formaPago de docSustento fuera del catálogo SRI menciona "formaPago"', () => {
      const roto: Retencion = {
        ...retencionFixture,
        docsSustento: [
          {
            ...retencionFixture.docsSustento[0],
            pagos: [{ formaPago: '99', total: '1020.00' }],
          },
        ],
      };
      const errors = validateBusiness(roto);
      expect(errors.some((e) => e.startsWith('docsSustento[0].pagos[0].formaPago:'))).toBe(true);
    });

    it('la suma de pagos.total del docSustento NO se valida contra importeTotal (es neto de retención)', () => {
      // 1120.00 (importeTotal) - 100.00 (retenido) = 1020.00: el fixture ya
      // codifica esta relación real del SRI. `validateBusiness` no debe
      // exigir `pagos.total == importeTotal` aquí (a diferencia de
      // Factura/LiquidacionCompra/NotaDebito).
      expect(validateBusiness(retencionFixture)).toEqual([]);
    });
  });
});

describe('assertValid', () => {
  it.each([
    ['Factura', facturaFixture],
    ['LiquidacionCompra', liquidacionCompraFixture],
    ['NotaCredito', notaCreditoFixture],
    ['NotaDebito', notaDebitoFixture],
    ['GuiaRemision', guiaRemisionFixture],
    ['Retencion', retencionFixture],
  ] as const)('%s: no lanza con el fixture válido', (_nombre, fixture) => {
    expect(() => assertValid(fixture)).not.toThrow();
  });

  it('lanza ValidationError con todos los errores de negocio acumulados', () => {
    const roto: Factura = { ...facturaFixture, importeTotal: '999.00' };
    expect(() => assertValid(roto)).toThrow(ValidationError);
    try {
      assertValid(roto);
      throw new Error('unreachable');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const validationError = err as ValidationError;
      expect(validationError.errors.some((e) => e.startsWith('importeTotal:'))).toBe(true);
    }
  });

  it('acumula errores de zod (estructura) y de negocio (coherencia), zod primero', () => {
    const roto: Factura = { ...facturaFixture, fechaEmision: '2026-01-26', importeTotal: '999.00' };
    try {
      assertValid(roto);
      throw new Error('unreachable');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const { errors } = err as ValidationError;
      const zodIndex = errors.findIndex((e) => e.startsWith('fechaEmision:'));
      const businessIndex = errors.findIndex((e) => e.startsWith('importeTotal:'));
      expect(zodIndex).toBeGreaterThanOrEqual(0);
      expect(businessIndex).toBeGreaterThanOrEqual(0);
      expect(zodIndex).toBeLessThan(businessIndex);
    }
  });

  it('acepta doc.tipo para elegir el schema correcto (Retencion)', () => {
    const roto: Retencion = {
      ...retencionFixture,
      docsSustento: [
        {
          ...retencionFixture.docsSustento[0],
          retenciones: [{ ...retencionFixture.docsSustento[0].retenciones[0], valorRetenido: '999.00' }],
        },
      ],
    };
    expect(() => assertValid(roto)).toThrow(ValidationError);
  });
});
