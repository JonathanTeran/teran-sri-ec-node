import { isTerminal, type BatchItem, type ComprobanteState } from './batch-item.js';

/**
 * Almacén de `BatchItem` para el motor de envío masivo. Port de
 * `Teran\Sri\Batch\ComprobanteRepositoryInterface`, con nombres idiomáticos
 * de mapa (`get`/`put`) en vez de `find`/`save` — mismo contrato semántico
 * (upsert por `claveAcceso`).
 */
export interface ComprobanteRepository {
  /** Inserta o reemplaza (upsert) el item, indexado por `claveAcceso`. */
  put(item: BatchItem): void;
  /** `undefined` si no existe ningún item con esa clave de acceso. */
  get(claveAcceso: string): BatchItem | undefined;
  /** Items no terminales (`PENDING`, `SENT`, `IN_PROCESS`) — los que `BatchProcessor` todavía debe avanzar. */
  pending(): BatchItem[];
  /** Conteo por estado. A diferencia del `array<string,int>` disperso de PHP, siempre trae los seis estados (0 si no hay items en ese estado). */
  counts(): Record<ComprobanteState, number>;
}

const EMPTY_COUNTS: Record<ComprobanteState, number> = {
  PENDING: 0,
  SENT: 0,
  AUTHORIZED: 0,
  REJECTED: 0,
  IN_PROCESS: 0,
  FAILED: 0,
};

/** Port de `Teran\Sri\Batch\InMemoryComprobanteRepository`: `Map` en vez de array asociativo PHP, mismo comportamiento de upsert. */
export class InMemoryComprobanteRepository implements ComprobanteRepository {
  private readonly items = new Map<string, BatchItem>();

  put(item: BatchItem): void {
    this.items.set(item.claveAcceso, item);
  }

  get(claveAcceso: string): BatchItem | undefined {
    return this.items.get(claveAcceso);
  }

  pending(): BatchItem[] {
    return [...this.items.values()].filter((item) => !isTerminal(item.state));
  }

  counts(): Record<ComprobanteState, number> {
    const counts = { ...EMPTY_COUNTS };
    for (const item of this.items.values()) {
      counts[item.state] += 1;
    }
    return counts;
  }
}
