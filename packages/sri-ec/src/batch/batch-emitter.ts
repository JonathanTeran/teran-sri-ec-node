import type { Ambiente } from '../catalogs/index.js';
import { FetchSoapTransport, type SriTransport } from '../transport/index.js';
import { createBatchItem, type BatchItem, type ComprobanteState } from './batch-item.js';
import { BatchProcessor, type RateLimiter, type Sleep } from './batch-processor.js';
import { InMemoryComprobanteRepository, type ComprobanteRepository } from './comprobante-repository.js';
import { RetryPolicy } from './retry-policy.js';

/** Opciones de construcción de {@link BatchEmitter} (contrato canónico, `contratos.md`, extendido con hooks de testabilidad). */
export interface BatchEmitterOptions {
  ambiente: Ambiente;
  /** Por defecto `new FetchSoapTransport()`, igual que `SriClient`. */
  transport?: SriTransport;
  retryPolicy?: RetryPolicy;
  /** Por defecto `new InMemoryComprobanteRepository()` — inyectable para persistir el lote en otro backend (DB, cola). */
  repository?: ComprobanteRepository;
  rateLimiter?: RateLimiter;
  /** Inyectable para tests — evita esperar los backoffs reales de `RetryPolicy`. Por defecto `setTimeout` real. */
  sleep?: Sleep;
}

/**
 * Fachada del envío masivo: agrega comprobantes firmados, procesa y consulta
 * estado. Port de `Teran\Sri\Batch\BatchEmitter`. El firmado por tipo lo hace
 * el caller (serializador + `XadesSigner`); este motor es agnóstico al tipo
 * de comprobante — opera solo sobre `claveAcceso` + XML ya firmado.
 *
 * A diferencia del PHP (que recibe `BatchProcessor`/`ComprobanteRepositoryInterface`
 * ya construidos), este constructor arma ambos internamente a partir de
 * `ambiente`/`transport`/`retryPolicy` — mismo patrón que `SriClient`, donde
 * el caller solo provee lo que quiere personalizar.
 */
export class BatchEmitter {
  private readonly repository: ComprobanteRepository;
  private readonly processor: BatchProcessor;

  constructor(opts: BatchEmitterOptions) {
    this.repository = opts.repository ?? new InMemoryComprobanteRepository();
    this.processor = new BatchProcessor(opts.transport ?? new FetchSoapTransport(), opts.ambiente, {
      retryPolicy: opts.retryPolicy,
      rateLimiter: opts.rateLimiter,
      sleep: opts.sleep,
    });
  }

  /** Agrega un comprobante firmado. Idempotente por clave de acceso: si ya existe un item con esa clave, no lo duplica ni lo reemplaza. */
  add(claveAcceso: string, signedXml: string): void {
    if (this.repository.get(claveAcceso) === undefined) {
      this.repository.put(createBatchItem(claveAcceso, signedXml));
    }
  }

  /**
   * Procesa todos los pendientes. Re-llamable: reanuda donde quedó (items ya
   * terminales no se reprocesan; los que siguen `PENDING`/`SENT`/`IN_PROCESS`
   * continúan su máquina de estados).
   */
  run(opts: { maxPasses?: number } = {}): Promise<void> {
    return this.processor.process(this.repository, opts.maxPasses ?? 20);
  }

  /** Conteo por estado (siempre los seis, con 0 para los que no tienen items). */
  status(): Record<ComprobanteState, number> {
    return this.repository.counts();
  }

  /** El `BatchItem` actual de `claveAcceso`, o `undefined` si nunca se agregó. */
  result(claveAcceso: string): BatchItem | undefined {
    return this.repository.get(claveAcceso);
  }
}
