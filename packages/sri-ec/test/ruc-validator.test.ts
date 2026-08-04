import { describe, expect, it, vi } from 'vitest';

import { SRI_RUC_URL, validarRucChecksum, validarRucLocal, validarRucOnline } from '../src/utils/ruc-validator.js';

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

  // -------------------------------------------------------------------------
  // opts.checksum — extensión aditiva/opt-in (fix round 1, no existe en PHP).
  // El default (sin opts, o checksum: false) debe seguir siendo exactamente
  // el comportamiento de arriba, sin cambios.
  // -------------------------------------------------------------------------

  it('checksum por defecto es false: un RUC estructuralmente válido pero con dígito verificador real incorrecto sigue pasando', () => {
    // '1790011001001' es el ejemplo canónico de RucValidatorTest.php (PHP) —
    // estructuralmente válido, pero (ver describe('validarRucChecksum') más
    // abajo) NO pasa el módulo 11 real de sociedades. El comportamiento por
    // defecto de validarRucLocal no debe verse afectado por eso.
    expect(validarRucLocal('1790011001001')).toBe(true);
    expect(validarRucLocal('1790011001001', { checksum: false })).toBe(true);
  });

  it('checksum: true rechaza ese mismo RUC (falla el módulo 11 real de sociedades)', () => {
    expect(validarRucLocal('1790011001001', { checksum: true })).toBe(false);
  });

  it('checksum: true acepta un RUC que sí satisface el algoritmo real (sociedad privada construida a mano, ver describe(\'validarRucChecksum\'))', () => {
    expect(validarRucLocal('0990123454001', { checksum: true })).toBe(true);
  });

  it('checksum: true sigue rechazando por la validación local si esta falla primero (no llega a evaluar el checksum)', () => {
    expect(validarRucLocal('1790011001000', { checksum: true })).toBe(false); // establecimiento "000"
  });
});

// ---------------------------------------------------------------------------
// validarRucChecksum — algoritmo real ecuatoriano (módulo 10/11 + provincia).
// No existe en el PHP fuente (confirmado por inspección exhaustiva de
// src/Schema/BusinessValidator.php y grep en todo src/ — ver
// task-14-report.md); es una extensión aditiva de este port.
//
// Todos los RUC "válidos" de este describe se construyeron a mano (elegir
// los primeros N dígitos, calcular el dígito verificador con el algoritmo
// documentado en ruc-validator.ts) — no se afirma que correspondan a
// contribuyentes reales, solo que el cálculo es correcto. Ver el desglose
// aritmético de cada uno en task-14-report.md.
// ---------------------------------------------------------------------------

describe('validarRucChecksum', () => {
  describe('persona natural (tercer dígito 0-5, módulo 10)', () => {
    it('acepta un RUC natural con dígito verificador correcto (1701234567001)', () => {
      // Base "170123456" (provincia 17=Pichincha, tercer dígito 0, resto
      // arbitrario) con coeficientes 2,1,2,1,2,1,2,1,2:
      //   1*2=2  7*1=7  0*2=0  1*1=1  2*2=4  3*1=3  4*2=8  5*1=5  6*2=12→3
      //   suma = 2+7+0+1+4+3+8+5+3 = 33 → 33 % 10 = 3 → verificador = 10-3 = 7
      // El 10º dígito es '7': coincide. Establecimiento "001" != "000".
      expect(validarRucChecksum('1701234567001')).toBe(true);
    });

    it('rechaza el mismo RUC con el dígito verificador alterado', () => {
      expect(validarRucChecksum('1701234568001')).toBe(false); // dígito 10: '8' en vez de '7'
    });

    it('rechaza un código de provincia inválido (99) aunque el resto del cálculo sea autoconsistente', () => {
      // Base "990123456" (provincia 99, inválida) con los mismos
      // coeficientes: 9*2=18→9  9*1=9  0*2=0  1*1=1  2*2=4  3*1=3  4*2=8
      // 5*1=5  6*2=12→3 → suma=9+9+0+1+4+3+8+5+3=42 → 42%10=2 → verificador=8.
      // El dígito verificador (8) SÍ coincide con el 10º carácter, pero la
      // provincia "99" no es válida (no está en 01-24 ni es 30).
      expect(validarRucChecksum('9901234568001')).toBe(false);
    });

    it('acepta el código de provincia 30 (exterior)', () => {
      // Base "300123456" con los mismos coeficientes:
      //   3*2=6 0*1=0 0*2=0 1*1=1 2*2=4 3*1=3 4*2=8 5*1=5 6*2=12→3
      //   suma=6+0+0+1+4+3+8+5+3=30 → 30%10=0 → verificador=0.
      expect(validarRucChecksum('3001234560001')).toBe(true);
    });

    it('rechaza establecimiento "000" aunque el dígito verificador sea correcto', () => {
      expect(validarRucChecksum('1701234567000')).toBe(false);
    });
  });

  describe('entidad pública (tercer dígito 6, módulo 11)', () => {
    it('acepta un RUC público con dígito verificador correcto (1760002520001)', () => {
      // Base8 "17600025" (provincia 17, tercer dígito 6) con coeficientes
      // 3,2,7,6,5,4,3,2:
      //   1*3=3 7*2=14 6*7=42 0*6=0 0*5=0 0*4=0 2*3=6 5*2=10
      //   suma=3+14+42+0+0+0+6+10=75 → 75%11=9 (11*6=66) → verificador=11-9=2
      // El 9º dígito es '2': coincide. Establecimiento "0001" != "0000".
      expect(validarRucChecksum('1760002520001')).toBe(true);
    });

    it('rechaza el mismo RUC con el dígito verificador alterado', () => {
      expect(validarRucChecksum('1760002530001')).toBe(false); // dígito 9: '3' en vez de '2'
    });

    it('rechaza establecimiento "0000" aunque el dígito verificador sea correcto', () => {
      expect(validarRucChecksum('1760002520000')).toBe(false);
    });
  });

  describe('sociedad privada (tercer dígito 9, módulo 11)', () => {
    it('acepta un RUC de sociedad con dígito verificador correcto (0990123454001)', () => {
      // Base9 "099012345" (provincia 09=Guayas, tercer dígito 9) con
      // coeficientes 4,3,2,7,6,5,4,3,2:
      //   0*4=0 9*3=27 9*2=18 0*7=0 1*6=6 2*5=10 3*4=12 4*3=12 5*2=10
      //   suma=0+27+18+0+6+10+12+12+10=95 → 95%11=7 (11*8=88) → verificador=11-7=4
      // El 10º dígito es '4': coincide. Establecimiento "001" != "000".
      expect(validarRucChecksum('0990123454001')).toBe(true);
    });

    it('rechaza el mismo RUC con el dígito verificador alterado', () => {
      expect(validarRucChecksum('0990123455001')).toBe(false); // dígito 10: '5' en vez de '4'
    });

    it('rechaza establecimiento "000" aunque el dígito verificador sea correcto', () => {
      expect(validarRucChecksum('0990123454000')).toBe(false);
    });

    it('el ejemplo canónico de RucValidatorTest.php (PHP) NO pasa el checksum real de sociedades', () => {
      // Documenta explícitamente por qué validarRucLocal (default) y
      // validarRucChecksum pueden discrepar sobre el mismo RUC: '1790011001001'
      // es estructuralmente válido (por eso RucValidatorTest.php lo usa como
      // ejemplo) pero nunca se generó con el algoritmo real de módulo 11.
      expect(validarRucChecksum('1790011001001')).toBe(false);
    });
  });

  describe('casos generales', () => {
    it('rechaza un tercer dígito fuera del catálogo (7 y 8), aunque la longitud/provincia sean válidas', () => {
      expect(validarRucChecksum('1770011001001')).toBe(false);
      expect(validarRucChecksum('1780011001001')).toBe(false);
    });

    it('rechaza longitudes distintas de 13 dígitos', () => {
      expect(validarRucChecksum('123')).toBe(false);
    });

    it('rechaza strings no numéricos', () => {
      expect(validarRucChecksum('179001100100a')).toBe(false);
    });
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

  it('RUC local-válido + SRI responde "true\\n" (espacio en blanco incidental): retorna true (se recorta antes de comparar)', async () => {
    const fetchMock = vi.fn(async () => textResponse('true\n'));

    const result = await validarRucOnline('1790011001001', { fetch: fetchMock as unknown as typeof fetch });

    expect(result).toBe(true);
  });

  it('RUC local-válido + SRI responde " false " (espacios alrededor): retorna false', async () => {
    const fetchMock = vi.fn(async () => textResponse(' false '));

    const result = await validarRucOnline('1790011001001', { fetch: fetchMock as unknown as typeof fetch });

    expect(result).toBe(false);
  });

  it('RUC local-válido + cuerpo inesperado (HTML, ni "true" ni "false"): fallback a local (true), no se interpreta como false', async () => {
    const fetchMock = vi.fn(async () => textResponse('<html><body>Error</body></html>'));

    const result = await validarRucOnline('1790011001001', { fetch: fetchMock as unknown as typeof fetch });

    expect(result).toBe(true);
  });

  it('RUC local-válido + cuerpo vacío: fallback a local (true)', async () => {
    const fetchMock = vi.fn(async () => textResponse(''));

    const result = await validarRucOnline('1790011001001', { fetch: fetchMock as unknown as typeof fetch });

    expect(result).toBe(true);
  });

  it('RUC local-válido + cuerpo con capitalización distinta ("True"): fallback a local (true), no se interpreta como false', async () => {
    const fetchMock = vi.fn(async () => textResponse('True'));

    const result = await validarRucOnline('1790011001001', { fetch: fetchMock as unknown as typeof fetch });

    expect(result).toBe(true);
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
