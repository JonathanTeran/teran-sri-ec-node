import { describe, expect, it, vi } from 'vitest';

import { SRI_RUC_URL, validarRucLocal, validarRucOnline } from '../src/utils/ruc-validator.js';

// ---------------------------------------------------------------------------
// validarRucLocal — port de BusinessValidator::validarRuc() (PHP), reusando
// esRucLocalValido (Task 6). Casos tomados de
// tests/Unit/Utils/RucValidatorTest.php y tests/Unit/Schema/... del PHP
// fuente, más los casos ya cubiertos en business-validator.test.ts.
// ---------------------------------------------------------------------------

describe('validarRucLocal', () => {
  it('acepta el RUC de ejemplo usado en RucValidatorTest.php (1790011001001)', () => {
    expect(validarRucLocal('1790011001001')).toBe(true);
  });

  it('acepta un RUC de persona natural (tercer dígito 0-5, cédula + 001)', () => {
    expect(validarRucLocal('1701234567001')).toBe(true);
  });

  it('acepta un RUC de entidad pública (tercer dígito 6)', () => {
    expect(validarRucLocal('1760001550001')).toBe(true);
  });

  it('acepta un RUC de sociedad privada (tercer dígito 9)', () => {
    expect(validarRucLocal('1790011001001')).toBe(true);
  });

  it('rechaza una longitud incorrecta (caso "123" de RucValidatorTest.php)', () => {
    expect(validarRucLocal('123')).toBe(false);
  });

  it('rechaza longitudes distintas de 13 dígitos en general', () => {
    expect(validarRucLocal('179001100100')).toBe(false);
    expect(validarRucLocal('17900110010012')).toBe(false);
  });

  it('rechaza strings no numéricos', () => {
    expect(validarRucLocal('179001100100a')).toBe(false);
  });

  it('rechaza un tercer dígito de régimen inválido (7: no está en 0-6 ni es 9)', () => {
    expect(validarRucLocal('1770011001001')).toBe(false);
  });

  it('rechaza un tercer dígito de régimen inválido (8: no está en 0-6 ni es 9)', () => {
    expect(validarRucLocal('1780011001001')).toBe(false);
  });

  it('rechaza un código de establecimiento "000"', () => {
    expect(validarRucLocal('1790011001000')).toBe(false);
  });

  it('no aplica módulo 10/11 (paridad deliberada con la looseness del PHP fuente): un RUC con dígito verificador de cédula incorrecto pero estructura válida sigue pasando', () => {
    // '1790011002001': mismo prefijo/sufijo que el caso válido de arriba pero
    // con la penúltima cifra de la cédula alterada (dígito verificador de
    // módulo 10 roto si se calculara). BusinessValidator::validarRuc() (PHP)
    // no calcula módulo 10, así que esto debe seguir aceptándose.
    expect(validarRucLocal('1790011002001')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validarRucOnline — combina validarRucLocal con un fetch al servicio REST
// del SRI, con fallback a local cuando la red falla (timeout, error, HTTP no
// 200). Ver ruc-validator.ts para la nota sobre la rama muerta de
// RucValidator::validate() en PHP que este port corrige a propósito.
// ---------------------------------------------------------------------------

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe('validarRucOnline', () => {
  it('RUC local-inválido: retorna false sin llamar a fetch', async () => {
    const fetchMock = vi.fn();

    const result = await validarRucOnline('123', { fetch: fetchMock as unknown as typeof fetch });

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('RUC local-válido + SRI responde "true": retorna true', async () => {
    const fetchMock = vi.fn(async () => textResponse('true'));

    const result = await validarRucOnline('1790011001001', { fetch: fetchMock as unknown as typeof fetch });

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${SRI_RUC_URL}1790011001001`);
  });

  it('RUC local-válido + SRI responde "false" explícitamente: retorna false', async () => {
    const fetchMock = vi.fn(async () => textResponse('false'));

    const result = await validarRucOnline('1790011001001', { fetch: fetchMock as unknown as typeof fetch });

    expect(result).toBe(false);
  });

  it('RUC local-válido + HTTP no-200: fallback a local (true)', async () => {
    const fetchMock = vi.fn(async () => textResponse('Internal Server Error', 500));

    const result = await validarRucOnline('1790011001001', { fetch: fetchMock as unknown as typeof fetch });

    expect(result).toBe(true);
  });

  it('RUC local-válido + fetch rechaza (red caída): fallback a local (true)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await validarRucOnline('1790011001001', { fetch: fetchMock as unknown as typeof fetch });

    expect(result).toBe(true);
  });

  it('RUC local-válido + timeout (AbortSignal por timeoutMs): fallback a local (true)', async () => {
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
        // Nunca resuelve por sí sola: solo el abort debe destrabar la promesa.
        setTimeout(() => resolve(textResponse('true')), 60_000);
      });
    });

    const result = await validarRucOnline('1790011001001', {
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 10,
    });

    expect(result).toBe(true);
  });

  it('usa el timeoutMs por defecto (3000ms) si no se especifica opts.timeoutMs', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return Promise.resolve(textResponse('true'));
    });

    await validarRucOnline('1790011001001', { fetch: fetchMock as unknown as typeof fetch });

    expect(capturedSignal?.aborted).toBe(false);
  });
});
