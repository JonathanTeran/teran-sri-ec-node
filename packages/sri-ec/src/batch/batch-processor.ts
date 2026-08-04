import type { Ambiente } from '../catalogs/index.js';
import { CommunicationError } from '../errors/index.js';
import type { SriTransport } from '../transport/index.js';
import {
  incrementAttempts,
  isTerminal,
  markAuthorized,
  markFailed,
  markInProcess,
  markRejected,
  markSent,
  type BatchItem,
} from './batch-item.js';
import type { ComprobanteRepository } from './comprobante-repository.js';
import { RetryPolicy } from './retry-policy.js';

/**
 * Limita la tasa de llamadas al SRI. `throttle()` bloquea (o espera) lo
 * necesario antes de cada llamada — implementaciones reales: token-bucket
 * global o por RUC. Port de `Teran\Sri\Batch\RateLimiterInterface`; `key` por
 * defecto es `'sri'` igual que el PHP.
 */
export interface RateLimiter {
  throttle(key?: string): Promise<void> | void;
}

/** Port de `Teran\Sri\Batch\NullRateLimiter`: sin límite, no-op. Implementación por defecto de {@link BatchProcessor}. */
export class NullRateLimiter implements RateLimiter {
  throttle(): void {
    // no-op
  }
}

/**
 * Función de espera inyectable — por defecto un `setTimeout` real envuelto en
 * `Promise`. Los tests inyectan una versión que resuelve de inmediato para no
 * esperar los backoffs reales de {@link RetryPolicy} (hasta 600s).
 */
export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface BatchProcessorOptions {
  retryPolicy?: RetryPolicy;
  rateLimiter?: RateLimiter;
  sleep?: Sleep;
}

/**
 * Conduce la máquina de estados del envío masivo de forma idempotente: enviar
 * → autorizar, con reintentos ({@link RetryPolicy}) y rate-limit. Port de
 * `Teran\Sri\Batch\BatchProcessor`.
 */
export class BatchProcessor {
  private readonly transport: SriTransport;
  private readonly ambiente: Ambiente;
  private readonly retryPolicy: RetryPolicy;
  private readonly rateLimiter: RateLimiter;
  private readonly sleep: Sleep;

  constructor(transport: SriTransport, ambiente: Ambiente, options: BatchProcessorOptions = {}) {
    this.transport = transport;
    this.ambiente = ambiente;
    this.retryPolicy = options.retryPolicy ?? new RetryPolicy();
    this.rateLimiter = options.rateLimiter ?? new NullRateLimiter();
    this.sleep = options.sleep ?? realSleep;
  }

  /** El RUC ocupa 13 dígitos a partir de la posición 10 en la clave de acceso (49 díg.). Port de `BatchProcessor::throttleKey()`. */
  private throttleKey(item: BatchItem): string {
    return item.claveAcceso.length >= 23 ? item.claveAcceso.slice(10, 23) : 'sri';
  }

  /**
   * Avanza un item UN paso. Idempotente: los terminales se devuelven sin
   * cambios. Port exacto de `BatchProcessor::step()`.
   *
   * Nota (heredada del PHP): si el proceso falla entre un `enviar` exitoso y
   * el `repository.put`, una re-ejecución reenviará el item (todavía
   * `PENDING`). La reconciliación real (consultar autorización antes de
   * re-enviar) es un refinamiento planeado, no cubierto aquí.
   */
  async step(item: BatchItem): Promise<BatchItem> {
    if (isTerminal(item.state)) {
      return item;
    }

    try {
      if (item.state === 'PENDING') {
        await this.rateLimiter.throttle(this.throttleKey(item));
        const r = await this.transport.enviar(item.signedXml, this.ambiente);
        return r.estado === 'RECIBIDA' ? markSent(item, r.mensajes) : markRejected(item, r.mensajes);
      }

      // SENT o IN_PROCESS → consultar autorización.
      await this.rateLimiter.throttle(this.throttleKey(item));
      const a = await this.transport.autorizar(item.claveAcceso, this.ambiente);
      switch (a.estado.toUpperCase()) {
        case 'AUTORIZADO':
          return markAuthorized(item, a.numeroAutorizacion, a.comprobante, a.mensajes);
        case 'EN PROCESO':
        case 'EN PROCESAMIENTO':
          return this.retryPolicy.shouldRetry(item.attempts + 1)
            ? markInProcess(item, a.mensajes)
            : markFailed(incrementAttempts(item), a.mensajes);
        default:
          return markRejected(item, a.mensajes); // NO AUTORIZADO
      }
    } catch (err) {
      if (!(err instanceof CommunicationError)) {
        throw err;
      }
      const next = incrementAttempts(item);
      return this.retryPolicy.shouldRetry(next.attempts)
        ? next
        : markFailed(next, [{ identificador: '', mensaje: err.message }]);
    }
  }

  /**
   * Recorre los pendientes del repositorio avanzándolos paso a paso hasta que
   * no queden pendientes o se agote `maxPasses`. Port de
   * `BatchProcessor::process()`, con una diferencia deliberada: cuando una
   * pasada completa no logra progreso de estado (p. ej. todos los items
   * quedan `IN_PROCESS`, o un fallo de comunicación solo incrementó
   * `attempts`), el PHP simplemente retorna (delega el reintento a un caller
   * externo que lo re-invoque más tarde); aquí se espera el backoff de
   * {@link RetryPolicy} (`sleep`, real por defecto, inyectable en tests) y se
   * continúa dentro de la misma llamada — así `run()` puede resolver un lote
   * completo (incluyendo varias vueltas de `EN PROCESO`) sin que el caller
   * tenga que reinvocarlo en un bucle. Sigue siendo reanudable: si
   * `maxPasses` se agota antes de llegar a un estado terminal, una llamada
   * posterior a `process()`/`run()` retoma exactamente donde quedó.
   */
  async process(repository: ComprobanteRepository, maxPasses = 20): Promise<void> {
    let noProgressStreak = 0;

    for (let pass = 0; pass < maxPasses; pass++) {
      const pending = repository.pending();
      if (pending.length === 0) {
        return;
      }

      let stateChanged = false;
      for (const item of pending) {
        const next = await this.step(item);
        if (next.state !== item.state || next.attempts !== item.attempts) {
          repository.put(next);
        }
        if (next.state !== item.state) {
          stateChanged = true;
        }
      }

      if (stateChanged) {
        noProgressStreak = 0;
        continue;
      }

      noProgressStreak += 1;
      if (pass === maxPasses - 1) {
        return; // presupuesto de pasadas agotado; una corrida posterior reanuda.
      }
      await this.sleep(this.retryPolicy.delaySeconds(noProgressStreak) * 1000);
    }
  }
}
