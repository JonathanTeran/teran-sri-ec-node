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

export interface BatchProcessorOptions {
  retryPolicy?: RetryPolicy;
  rateLimiter?: RateLimiter;
}

/**
 * Conduce la máquina de estados del envío masivo de forma idempotente: enviar
 * → autorizar, con reintentos ({@link RetryPolicy}) y rate-limit. Port de
 * `Teran\Sri\Batch\BatchProcessor`.
 *
 * Pacing y reinvocación son responsabilidad del caller, igual que en el PHP:
 * `process()` (y `BatchEmitter.run()`, que delega en él) nunca espera
 * internamente. Cuando una pasada no logra progreso de estado (p. ej. todos
 * los items pendientes quedan `EN PROCESO`, o un fallo de comunicación solo
 * incrementó `attempts`), retorna de inmediato en vez de reintentar dentro de
 * la misma llamada. Un worker de cola (o cron) debe reinvocar `process()`/
 * `run()` más tarde — {@link RetryPolicy.delaySeconds} está expuesto
 * justamente para que ese caller calcule cuánto esperar antes de la próxima
 * invocación.
 */
export class BatchProcessor {
  private readonly transport: SriTransport;
  private readonly ambiente: Ambiente;
  private readonly retryPolicy: RetryPolicy;
  private readonly rateLimiter: RateLimiter;

  constructor(transport: SriTransport, ambiente: Ambiente, options: BatchProcessorOptions = {}) {
    this.transport = transport;
    this.ambiente = ambiente;
    this.retryPolicy = options.retryPolicy ?? new RetryPolicy();
    this.rateLimiter = options.rateLimiter ?? new NullRateLimiter();
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
   * Recorre los pendientes del repositorio avanzándolos paso a paso mientras
   * cada pasada logre progreso de estado, hasta que no queden pendientes, se
   * agote `maxPasses`, o una pasada completa no cambie el estado de ningún
   * item. Port exacto de `BatchProcessor::process()`: cuando no hay progreso
   * (p. ej. todos los pendientes quedan `EN PROCESO`, o un fallo de
   * comunicación transitorio solo incrementó `attempts` sin cambiar de
   * estado), retorna de inmediato — nunca espera ni reintenta dentro de la
   * misma llamada — dejando la re-invocación a un caller externo (worker de
   * cola, cron). Sigue siendo reanudable: una llamada posterior a
   * `process()`/`run()` retoma exactamente donde quedó, sea porque no hubo
   * progreso o porque se agotó `maxPasses`.
   */
  async process(repository: ComprobanteRepository, maxPasses = 20): Promise<void> {
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

      if (!stateChanged) {
        return; // sin progreso (p. ej. todo EN PROCESO) — reintentar más tarde
      }
    }
  }
}
