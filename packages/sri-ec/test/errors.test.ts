import { describe, expect, it } from 'vitest';

import {
  CertificateError,
  CommunicationError,
  SignatureError,
  SriError,
  ValidationError,
} from '../src/errors/index.js';

describe('errors', () => {
  it('SriError es instanceof Error y expone code/name', () => {
    class TestError extends SriError {}
    const err = new TestError('boom', 'VALIDATION');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SriError);
    expect(err.code).toBe('VALIDATION');
    expect(err.message).toBe('boom');
    expect(err.name).toBe('SriError');
  });

  describe('ValidationError', () => {
    it('une los errores en el message y expone .errors', () => {
      const err = new ValidationError('Documento inválido', [
        'campo x requerido',
        'campo y inválido',
      ]);

      expect(err.errors).toEqual(['campo x requerido', 'campo y inválido']);
      expect(err.message).toContain('campo x requerido');
      expect(err.message).toContain('campo y inválido');
    });

    it('es instanceof SriError, Error y ValidationError; code === VALIDATION', () => {
      const err = new ValidationError('inválido', ['a']);

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SriError);
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.code).toBe('VALIDATION');
      expect(err.name).toBe('ValidationError');
    });

    it('funciona con un array de errores vacío', () => {
      const err = new ValidationError('inválido', []);

      expect(err.errors).toEqual([]);
      expect(err.message).toBe('inválido');
    });
  });

  describe('CertificateError', () => {
    it('es instanceof SriError y Error; code === CERTIFICATE', () => {
      const err = new CertificateError('certificado inválido');

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SriError);
      expect(err).toBeInstanceOf(CertificateError);
      expect(err.code).toBe('CERTIFICATE');
      expect(err.name).toBe('CertificateError');
      expect(err.message).toBe('certificado inválido');
    });
  });

  describe('SignatureError', () => {
    it('es instanceof SriError y Error; code === SIGNATURE', () => {
      const err = new SignatureError('firma inválida');

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SriError);
      expect(err).toBeInstanceOf(SignatureError);
      expect(err.code).toBe('SIGNATURE');
      expect(err.name).toBe('SignatureError');
    });
  });

  describe('CommunicationError', () => {
    it('es instanceof SriError y Error; code === COMMUNICATION', () => {
      const err = new CommunicationError('fallo de comunicación con el SRI');

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SriError);
      expect(err).toBeInstanceOf(CommunicationError);
      expect(err.code).toBe('COMMUNICATION');
      expect(err.name).toBe('CommunicationError');
    });

    it('acepta un cause opcional', () => {
      const cause = new Error('timeout de red');
      const err = new CommunicationError('fallo de comunicación con el SRI', cause);

      expect(err.cause).toBe(cause);
    });

    it('funciona sin cause', () => {
      const err = new CommunicationError('fallo de comunicación con el SRI');

      expect(err.cause).toBeUndefined();
    });
  });

  it('todas las subclases mantienen instanceof correctamente (semántica ES2022)', () => {
    const errs: SriError[] = [
      new ValidationError('x', ['y']),
      new CertificateError('x'),
      new SignatureError('x'),
      new CommunicationError('x'),
    ];

    for (const e of errs) {
      expect(e instanceof Error).toBe(true);
      expect(e instanceof SriError).toBe(true);
    }
  });
});
