import { describe, expect, it, vi } from 'vitest';

import {
  BatchEmitter,
  BatchProcessor,
  InMemoryComprobanteRepository,
  RetryPolicy,
  createBatchItem,
  isTerminal,
  markAuthorized,
  markFailed,
  markInProcess,
  markRejected,
  markSent,
  type BatchItem,
  type ComprobanteRepository,
} from '../src/batch/index.js';
import { Ambiente } from '../src/catalogs/index.js';
import { CommunicationError } from '../src/errors/index.js';
import type { AuthorizationOutcome, ReceptionOutcome, SriTransport } from '../src/transport/index.js';

function mockTransport(
  overrides: { enviar?: SriTransport['enviar']; autorizar?: SriTransport['autorizar'] } = {},
) {
  const enviar = vi.fn(
    overrides.enviar ?? (async (): Promise<ReceptionOutcome> => ({ estado: 'RECIBIDA', mensajes: [] })),
  );
  const autorizar = vi.fn(
    overrides.autorizar ??
      (async (): Promise<AuthorizationOutcome> => ({ estado: 'AUTORIZADO', mensajes: [] })),
  );
  return { enviar, autorizar };
}

const CLAVE = 'clave-1790011001001-1';

describe('BatchItem', () => {
  it('un item nuevo está PENDING, con 0 intentos y no terminal', () => {
    const item = createBatchItem(CLAVE, '<factura/>');
    expect(item.state).toBe('PENDING');
    expect(item.attempts).toBe(0);
    expect(isTerminal(item.state)).toBe(false);
  });

  it('las transiciones devuelven instancias nuevas; el item original no cambia', () => {
    const item = createBatchItem(CLAVE, '<xml/>');

    const sent = markSent(item);
    expect(sent.state).toBe('SENT');
    expect(item.state).toBe('PENDING'); // original sin cambios

    const auth = markAuthorized(sent, '123', '<auth/>', []);
    expect(auth.state).toBe('AUTHORIZED');
    expect(auth.numeroAutorizacion).toBe('123');
    expect(isTerminal(auth.state)).toBe(true);
  });

  it('markInProcess incrementa attempts en cada llamada', () => {
    const item = markSent(createBatchItem(CLAVE, '<xml/>'));
    const p1 = markInProcess(item, [{ identificador: '70', mensaje: 'EN PROCESAMIENTO' }]);
    const p2 = markInProcess(p1, []);
    expect(p2.state).toBe('IN_PROCESS');
    expect(p2.attempts).toBe(2);
  });

  it('REJECTED y FAILED son terminales', () => {
    const item = createBatchItem(CLAVE, '<xml/>');
    expect(isTerminal(markRejected(item, []).state)).toBe(true);
    expect(isTerminal(markFailed(item, []).state)).toBe(true);
  });

  it('markAuthorized conserva numeroAutorizacion/authorizedXml previos cuando llegan undefined', () => {
    const item = markAuthorized(createBatchItem(CLAVE, '<xml/>'), 'original', '<a/>', []);
    const reAuth = markAuthorized(item, undefined, undefined, []);
    expect(reAuth.numeroAutorizacion).toBe('original');
    expect(reAuth.authorizedXml).toBe('<a/>');
  });
});

describe('InMemoryComprobanteRepository', () => {
  it('put/get hacen upsert por claveAcceso', () => {
    const repo = new InMemoryComprobanteRepository();
    repo.put(createBatchItem('clave-1', '<a/>'));
    expect(repo.get('clave-1')?.state).toBe('PENDING');

    repo.put(markSent(createBatchItem('clave-1', '<a/>')));
    expect(repo.get('clave-1')?.state).toBe('SENT');
    expect(repo.get('inexistente')).toBeUndefined();
  });

  it('pending() excluye los terminales', () => {
    const repo = new InMemoryComprobanteRepository();
    repo.put(createBatchItem('a', '<a/>')); // PENDING
    repo.put(markSent(createBatchItem('b', '<b/>'))); // SENT (no terminal)
    repo.put(markAuthorized(createBatchItem('c', '<c/>'), '1', undefined, [])); // terminal
    repo.put(markRejected(createBatchItem('d', '<d/>'), [])); // terminal

    const claves = repo
      .pending()
      .map((i) => i.claveAcceso)
      .sort();
    expect(claves).toEqual(['a', 'b']);
  });

  it('counts() cuenta por estado y siempre trae los seis estados', () => {
    const repo = new InMemoryComprobanteRepository();
    repo.put(markAuthorized(createBatchItem('a', '<a/>'), '1', undefined, []));
    repo.put(markAuthorized(createBatchItem('b', '<b/>'), '2', undefined, []));
    repo.put(markRejected(createBatchItem('c', '<c/>'), []));

    const counts = repo.counts();
    expect(counts.AUTHORIZED).toBe(2);
    expect(counts.REJECTED).toBe(1);
    expect(counts.PENDING).toBe(0);
    expect(counts.SENT).toBe(0);
    expect(counts.IN_PROCESS).toBe(0);
    expect(counts.FAILED).toBe(0);
  });
});

describe('RetryPolicy', () => {
  it('shouldRetry permite intentos hasta maxAttempts (exclusivo)', () => {
    const policy = new RetryPolicy({ maxAttempts: 3 });
    expect(policy.shouldRetry(1)).toBe(true);
    expect(policy.shouldRetry(2)).toBe(true);
    expect(policy.shouldRetry(3)).toBe(false);
    expect(policy.shouldRetry(4)).toBe(false);
  });

  it('delaySeconds crece exponencialmente desde baseDelaySeconds', () => {
    const policy = new RetryPolicy({ baseDelaySeconds: 2 });
    expect(policy.delaySeconds(1)).toBe(2);
    expect(policy.delaySeconds(2)).toBe(4);
    expect(policy.delaySeconds(3)).toBe(8);
  });

  it('delaySeconds respeta el tope maxDelaySeconds', () => {
    const policy = new RetryPolicy({ baseDelaySeconds: 100, maxDelaySeconds: 250 });
    expect(policy.delaySeconds(1)).toBe(100);
    expect(policy.delaySeconds(2)).toBe(200);
    expect(policy.delaySeconds(3)).toBe(250); // 400 -> tope
  });
});

describe('BatchProcessor', () => {
  function processor(transport: SriTransport, retryPolicy?: RetryPolicy): BatchProcessor {
    return new BatchProcessor(transport, Ambiente.Pruebas, { retryPolicy });
  }

  it('flujo feliz: RECIBIDA + AUTORIZADO llega a AUTHORIZED con numeroAutorizacion', async () => {
    const { enviar, autorizar } = mockTransport({
      autorizar: async () => ({ estado: 'AUTORIZADO', numeroAutorizacion: '123', comprobante: '<a/>', mensajes: [] }),
    });
    const repo = new InMemoryComprobanteRepository();
    repo.put(createBatchItem(CLAVE, '<xml/>'));

    await processor({ enviar, autorizar }).process(repo);

    const item = repo.get(CLAVE);
    expect(item?.state).toBe('AUTHORIZED');
    expect(item?.numeroAutorizacion).toBe('123');
  });

  it('DEVUELTA en recepción → REJECTED, nunca se llega a autorizar', async () => {
    const { enviar, autorizar } = mockTransport({
      enviar: async () => ({ estado: 'DEVUELTA', mensajes: [{ identificador: '43', mensaje: 'RUC inválido' }] }),
    });
    const repo = new InMemoryComprobanteRepository();
    repo.put(createBatchItem(CLAVE, '<xml/>'));

    await processor({ enviar, autorizar }).process(repo);

    const item = repo.get(CLAVE);
    expect(item?.state).toBe('REJECTED');
    expect(item?.numeroAutorizacion).toBeUndefined();
    expect(autorizar).not.toHaveBeenCalled();
  });

  it("'EN PROCESO' se mantiene IN_PROCESS mientras la política permita reintentar", async () => {
    const { enviar, autorizar } = mockTransport({
      autorizar: async () => ({ estado: 'EN PROCESO', mensajes: [] }),
    });
    const repo = new InMemoryComprobanteRepository();
    repo.put(createBatchItem(CLAVE, '<xml/>'));

    // maxPasses=2: 1) PENDING->SENT, 2) SENT->IN_PROCESS. Sin más pasadas, no debería fallar.
    await processor({ enviar, autorizar }).process(repo, 2);

    expect(repo.get(CLAVE)?.state).toBe('IN_PROCESS');
  });

  it(
    "'EN PROCESO' estancado: process() retorna de inmediato sin esperar (sin timers), deja el " +
      'item IN_PROCESS (nunca FAILED) e incrementa attempts una vez por pasada; una segunda ' +
      'llamada retoma y termina cuando el SRI ya autorizó',
    async () => {
      const autorizar = vi.fn(async (): Promise<AuthorizationOutcome> => ({ estado: 'EN PROCESO', mensajes: [] }));
      const enviar = vi.fn(async (): Promise<ReceptionOutcome> => ({ estado: 'RECIBIDA', mensajes: [] }));
      const repo = new InMemoryComprobanteRepository();
      // Arranca ya en IN_PROCESS (attempts=1): una pasada sin progreso de estado real.
      repo.put(markInProcess(markSent(createBatchItem(CLAVE, '<xml/>')), []));

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const p = processor({ enviar, autorizar });

      await p.process(repo);

      // (c) el camino por defecto no espera: ningún timer se programa.
      expect(setTimeoutSpy).not.toHaveBeenCalled();

      // (a) el item sigue EN PROCESO en el SRI: debe quedar IN_PROCESS, jamás FAILED, tras una
      // sola pasada sin progreso — y solo un intento más (no varios "quemados" de una).
      let item = repo.get(CLAVE);
      expect(item?.state).toBe('IN_PROCESS');
      expect(item?.attempts).toBe(2);
      expect(enviar).not.toHaveBeenCalled();

      // (b) el SRI ya terminó de procesarlo: una segunda invocación (como haría un worker de
      // cola reinvocando más tarde) retoma y llega a AUTHORIZED.
      autorizar.mockResolvedValueOnce({ estado: 'AUTORIZADO', numeroAutorizacion: '123', mensajes: [] });
      await p.process(repo);

      item = repo.get(CLAVE);
      expect(item?.state).toBe('AUTHORIZED');
      expect(item?.numeroAutorizacion).toBe('123');

      setTimeoutSpy.mockRestore();
    },
  );

  it('fallo de comunicación transitorio agota reintentos y termina en FAILED', async () => {
    const enviar = vi.fn(async (): Promise<ReceptionOutcome> => {
      throw new CommunicationError('timeout hablando con el SRI');
    });
    const autorizar = vi.fn(async (): Promise<AuthorizationOutcome> => ({ estado: 'AUTORIZADO', mensajes: [] }));
    const repo = new InMemoryComprobanteRepository();
    repo.put(createBatchItem(CLAVE, '<xml/>'));

    await processor({ enviar, autorizar }, new RetryPolicy({ maxAttempts: 1 })).process(repo);

    const item = repo.get(CLAVE);
    expect(item?.state).toBe('FAILED');
    expect(item?.attempts).toBe(1); // un intento de transporte contado
  });

  it("'EN PROCESO' persistente agota reintentos y termina en FAILED", async () => {
    const { enviar, autorizar } = mockTransport({
      autorizar: async () => ({ estado: 'EN PROCESO', mensajes: [] }),
    });
    const repo = new InMemoryComprobanteRepository();
    repo.put(markSent(createBatchItem(CLAVE, '<xml/>'))); // arranca en SENT → va directo a autorizar

    await processor({ enviar, autorizar }, new RetryPolicy({ maxAttempts: 1 })).process(repo);

    const item = repo.get(CLAVE);
    expect(item?.state).toBe('FAILED');
    expect(item?.attempts).toBe(1); // un intento de autorización contado
  });

  it('los items terminales no se reprocesan (idempotencia)', async () => {
    const { enviar, autorizar } = mockTransport({
      autorizar: async () => ({ estado: 'AUTORIZADO', numeroAutorizacion: '123', mensajes: [] }),
    });
    const repo = new InMemoryComprobanteRepository();
    repo.put(markAuthorized(createBatchItem(CLAVE, '<xml/>'), 'original', undefined, []));

    const p = processor({ enviar, autorizar });
    await p.process(repo);
    await p.process(repo); // segunda corrida

    expect(repo.get(CLAVE)?.numeroAutorizacion).toBe('original');
    expect(enviar).not.toHaveBeenCalled();
    expect(autorizar).not.toHaveBeenCalled();
  });
});

describe('BatchEmitter', () => {
  function emitter(
    transport: SriTransport,
    overrides: { retryPolicy?: RetryPolicy; repository?: ComprobanteRepository } = {},
  ): BatchEmitter {
    return new BatchEmitter({ ambiente: Ambiente.Pruebas, transport, ...overrides });
  }

  it('add() es idempotente por clave de acceso: no duplica ni reemplaza', async () => {
    const { enviar, autorizar } = mockTransport();
    const e = emitter({ enviar, autorizar });

    e.add('clave-1', '<f1/>');
    e.add('clave-1', '<otro/>'); // misma clave: no duplica

    await e.run();

    const counts = e.status();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
    expect(e.result('clave-1')?.signedXml).toBe('<f1/>'); // conserva el primer XML agregado
  });

  it('run() procesa hasta un estado terminal en una sola llamada: EN PROCESO → AUTORIZADO (reanuda internamente entre pasadas)', async () => {
    const autorizar = vi.fn(
      async (): Promise<AuthorizationOutcome> => ({
        estado: 'AUTORIZADO',
        numeroAutorizacion: '123',
        comprobante: '<a/>',
        mensajes: [],
      }),
    );
    autorizar.mockResolvedValueOnce({ estado: 'EN PROCESO', mensajes: [] }); // primera consulta: todavía en proceso
    const { enviar } = mockTransport();
    const e = emitter({ enviar, autorizar });

    e.add(CLAVE, '<xml/>');
    await e.run();

    const item = e.result(CLAVE);
    expect(item?.state).toBe('AUTHORIZED');
    expect(item?.numeroAutorizacion).toBe('123');
    expect(autorizar).toHaveBeenCalledTimes(2);
  });

  it('REJECTED no se reintenta: transport.autorizar nunca se llama y attempts queda en 0', async () => {
    const { enviar, autorizar } = mockTransport({
      enviar: async () => ({ estado: 'DEVUELTA', mensajes: [{ identificador: '43', mensaje: 'RUC inválido' }] }),
    });
    const e = emitter({ enviar, autorizar });

    e.add(CLAVE, '<xml/>');
    await e.run();

    const item = e.result(CLAVE);
    expect(item?.state).toBe('REJECTED');
    expect(item?.attempts).toBe(0);
    expect(autorizar).not.toHaveBeenCalled();
  });

  it('FAILED tras maxAttempts en errores de red (cada intento requiere una reinvocación de run(), como un worker de cola)', async () => {
    const enviar = vi.fn(async (): Promise<ReceptionOutcome> => {
      throw new CommunicationError('ECONNRESET');
    });
    const autorizar = vi.fn(async (): Promise<AuthorizationOutcome> => ({ estado: 'AUTORIZADO', mensajes: [] }));
    const e = emitter({ enviar, autorizar }, { retryPolicy: new RetryPolicy({ maxAttempts: 3 }) });

    e.add(CLAVE, '<xml/>');

    // Un `CommunicationError` que persiste nunca cambia el estado del item (sigue PENDING), así
    // que cada pasada de run() es "sin progreso" y retorna de inmediato — el caller (aquí, el
    // test haciendo de worker de cola) debe reinvocar run() una vez por intento.
    await e.run(); // attempts 0 -> 1, sigue PENDING
    expect(e.result(CLAVE)?.state).toBe('PENDING');
    expect(e.result(CLAVE)?.attempts).toBe(1);

    await e.run(); // attempts 1 -> 2, sigue PENDING
    expect(e.result(CLAVE)?.state).toBe('PENDING');
    expect(e.result(CLAVE)?.attempts).toBe(2);

    await e.run(); // attempts 2 -> 3: maxAttempts alcanzado -> FAILED

    const item = e.result(CLAVE);
    expect(item?.state).toBe('FAILED');
    expect(item?.attempts).toBe(3);
    expect(autorizar).not.toHaveBeenCalled();
  });

  it('status() cuenta correctamente por estado sobre un repositorio con items mixtos', () => {
    const repo = new InMemoryComprobanteRepository();
    repo.put(createBatchItem('a', '<a/>'));
    repo.put(markSent(createBatchItem('b', '<b/>')));
    repo.put(markInProcess(markSent(createBatchItem('c', '<c/>')), []));
    repo.put(markAuthorized(createBatchItem('d', '<d/>'), '1', undefined, []));
    repo.put(markAuthorized(createBatchItem('e', '<e/>'), '2', undefined, []));
    repo.put(markRejected(createBatchItem('f', '<f/>'), []));
    repo.put(markFailed(createBatchItem('g', '<g/>'), []));

    const { enviar, autorizar } = mockTransport();
    const e = emitter({ enviar, autorizar }, { repository: repo });

    expect(e.status()).toEqual({
      PENDING: 1,
      SENT: 1,
      IN_PROCESS: 1,
      AUTHORIZED: 2,
      REJECTED: 1,
      FAILED: 1,
    });
  });

  it('run() es re-llamable: una corrida acotada por maxPasses deja el item a medio camino, y una segunda corrida lo termina', async () => {
    const { enviar, autorizar } = mockTransport({
      autorizar: async () => ({ estado: 'AUTORIZADO', numeroAutorizacion: '123', mensajes: [] }),
    });
    const e = emitter({ enviar, autorizar });
    e.add(CLAVE, '<xml/>');

    await e.run({ maxPasses: 1 }); // solo alcanza a enviar (PENDING → SENT)
    expect(e.result(CLAVE)?.state).toBe('SENT');
    expect(autorizar).not.toHaveBeenCalled();

    await e.run(); // reanuda: SENT → AUTHORIZED
    expect(e.result(CLAVE)?.state).toBe('AUTHORIZED');

    await e.run(); // tercera corrida sobre un item ya terminal: no-op, no lanza
    expect(e.result(CLAVE)?.state).toBe('AUTHORIZED');
    expect(e.result(CLAVE)?.numeroAutorizacion).toBe('123');
  });
});
