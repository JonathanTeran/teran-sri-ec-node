import { describe, expect, it } from 'vitest';

import { ValidationError } from '../src/errors/index.js';
import { formatMonto, fromCents, isMonto, toCents } from '../src/utils/money.js';

describe('money', () => {
  describe('toCents', () => {
    it('convierte un monto con 2 decimales', () => {
      expect(toCents('100.00')).toBe(10000);
    });

    it('convierte un monto con 1 decimal', () => {
      expect(toCents('0.1')).toBe(10);
    });

    it('redondea half-up cuando el tercer decimal es 5', () => {
      expect(toCents('1.005')).toBe(101);
    });

    it('trunca (no redondea hacia arriba) cuando el tercer decimal es menor a 5', () => {
      expect(toCents('1.004')).toBe(100);
    });

    it('convierte un monto sin parte decimal', () => {
      expect(toCents('100')).toBe(10000);
    });

    it('convierte un monto con 6 decimales (escala máxima soportada)', () => {
      expect(toCents('1.123456')).toBe(112);
    });

    it('lanza ValidationError con un monto malformado', () => {
      expect(() => toCents('abc')).toThrow(ValidationError);
    });

    it('el message del ValidationError no duplica el prefijo "Monto inválido"', () => {
      expect.assertions(2);
      try {
        toCents('abc');
      } catch (err) {
        const message = (err as ValidationError).message;
        const occurrences = message.split('Monto inválido').length - 1;
        expect(occurrences).toBe(1);
        expect(message).toBe(
          "Monto inválido: 'abc': Debe ser un número no negativo con hasta 6 decimales.",
        );
      }
    });

    it('lanza ValidationError con un monto negativo', () => {
      expect(() => toCents('-1.00')).toThrow(ValidationError);
    });

    it('lanza ValidationError con más de 6 decimales', () => {
      expect(() => toCents('1.1234567')).toThrow(ValidationError);
    });
  });

  describe('fromCents', () => {
    it('formatea centavos a un monto de 2 decimales', () => {
      expect(fromCents(11200)).toBe('112.00');
    });

    it('rellena con cero cuando los centavos son de un solo dígito', () => {
      expect(fromCents(5)).toBe('0.05');
    });

    it('formatea cero', () => {
      expect(fromCents(0)).toBe('0.00');
    });
  });

  describe('formatMonto', () => {
    it('formatea a 2 decimales un monto que ya viene con 2 decimales', () => {
      expect(formatMonto('100.00', 2)).toBe('100.00');
    });

    it('formatea a 6 decimales (escala de cantidad/precioUnitario)', () => {
      expect(formatMonto('1', 6)).toBe('1.000000');
      expect(formatMonto('1.000000', 6)).toBe('1.000000');
    });

    it('rellena con ceros un monto entero a 2 decimales', () => {
      expect(formatMonto('0', 2)).toBe('0.00');
      expect(formatMonto('112', 2)).toBe('112.00');
    });

    it('redondea half-up cuando hay más decimales que la escala destino', () => {
      expect(formatMonto('1.005', 2)).toBe('1.01');
      expect(formatMonto('1.004', 2)).toBe('1.00');
    });

    it('trunca sin redondear cuando el monto ya coincide exactamente con la escala destino', () => {
      expect(formatMonto('12.345678', 6)).toBe('12.345678');
    });

    it('lanza ValidationError con un monto inválido', () => {
      expect(() => formatMonto('abc', 2)).toThrow(ValidationError);
      expect(() => formatMonto('-1.00', 2)).toThrow(ValidationError);
    });
  });

  describe('isMonto', () => {
    it('rechaza strings no numéricos', () => {
      expect(isMonto('abc')).toBe(false);
    });

    it('acepta enteros', () => {
      expect(isMonto('100')).toBe(true);
    });

    it('acepta hasta 6 decimales', () => {
      expect(isMonto('1.123456')).toBe(true);
    });

    it('rechaza más de 6 decimales', () => {
      expect(isMonto('1.1234567')).toBe(false);
    });

    it('rechaza negativos', () => {
      expect(isMonto('-1.00')).toBe(false);
    });
  });
});
