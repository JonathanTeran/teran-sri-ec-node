/** Opciones de construcción de {@link RetryPolicy} — mismos tres campos que el PHP, todos opcionales con el mismo valor por defecto. */
export interface RetryPolicyOptions {
  maxAttempts?: number;
  baseDelaySeconds?: number;
  maxDelaySeconds?: number;
}

/**
 * Política de reintentos para fallos transitorios y estado `EN PROCESO`. Port
 * exacto de `Teran\Sri\Batch\RetryPolicy`: backoff exponencial
 * `delay = baseDelaySeconds * 2^(attempt-1)`, acotado por `maxDelaySeconds`.
 *
 * `BatchProcessor.process()` nunca espera internamente (igual que el PHP):
 * cuando una pasada no logra progreso de estado, retorna de inmediato y deja
 * la reinvocación a un caller externo (worker de cola, cron). `delaySeconds()`
 * está expuesto justamente para que ese caller calcule cuánto esperar antes
 * de volver a invocar `process()`/`BatchEmitter.run()`.
 */
export class RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelaySeconds: number;
  readonly maxDelaySeconds: number;

  constructor(options: RetryPolicyOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseDelaySeconds = options.baseDelaySeconds ?? 3;
    this.maxDelaySeconds = options.maxDelaySeconds ?? 600;
  }

  /** `true` mientras `attempts` no alcance `maxAttempts` (mismo `<` estricto que el PHP). */
  shouldRetry(attempts: number): boolean {
    return attempts < this.maxAttempts;
  }

  /** Segundos de espera antes del intento número `attempt` (1-indexado, igual que el PHP). */
  delaySeconds(attempt: number): number {
    const delay = this.baseDelaySeconds * 2 ** (attempt - 1);
    return Math.min(delay, this.maxDelaySeconds);
  }
}
