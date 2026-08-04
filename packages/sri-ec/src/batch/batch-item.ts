import type { Message } from '../emission/index.js';

/**
 * Estado de un comprobante dentro del flujo de envío masivo. Port de
 * `Teran\Sri\Batch\ComprobanteState` (enum PHP) — mismos seis valores, mismos
 * literales de wire (usados tal cual como claves de {@link BatchEmitter.status}).
 *
 * Transiciones válidas: `PENDING` → `SENT` (recepción OK) | `REJECTED`
 * (recepción devuelta); `SENT`/`IN_PROCESS` → `AUTHORIZED` | `REJECTED` |
 * `IN_PROCESS` (sigue en proceso) | `FAILED` (reintentos de `RetryPolicy`
 * agotados, tanto por `EN PROCESO` persistente como por fallos de
 * comunicación transitorios).
 */
export type ComprobanteState = 'PENDING' | 'SENT' | 'AUTHORIZED' | 'REJECTED' | 'IN_PROCESS' | 'FAILED';

/** Los tres estados terminales: no se vuelven a procesar (`BatchProcessor.step` los devuelve sin cambios). */
const TERMINAL_STATES: ReadonlySet<ComprobanteState> = new Set(['AUTHORIZED', 'REJECTED', 'FAILED']);

/** Port de `ComprobanteState::isTerminal()`. Función libre (no método) porque `BatchItem` es una interfaz plana, no una clase. */
export function isTerminal(state: ComprobanteState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Entidad inmutable de un comprobante en el flujo masivo (contrato canónico,
 * `contratos.md`). Port de `Teran\Sri\Batch\BatchItem`, pero como interfaz de
 * datos plana en vez de una clase `readonly` — las transiciones (`markSent`,
 * `markAuthorized`, etc.) son funciones libres que devuelven una NUEVA
 * instancia en vez de métodos de instancia, ya que una interfaz TS no puede
 * declarar comportamiento. El resultado es el mismo: ningún estado se muta,
 * cada transición es una función pura auditable de forma aislada.
 */
export interface BatchItem {
  readonly claveAcceso: string;
  readonly signedXml: string;
  readonly state: ComprobanteState;
  readonly attempts: number;
  readonly numeroAutorizacion?: string;
  readonly authorizedXml?: string;
  readonly messages: Message[];
}

/** Crea un `BatchItem` nuevo en estado `PENDING`, 0 intentos, sin mensajes. */
export function createBatchItem(claveAcceso: string, signedXml: string): BatchItem {
  return { claveAcceso, signedXml, state: 'PENDING', attempts: 0, messages: [] };
}

/** Recepción exitosa (`RECIBIDA`): `PENDING` → `SENT`. No incrementa `attempts` (mismo criterio que PHP). */
export function markSent(item: BatchItem, messages: Message[] = []): BatchItem {
  return { ...item, state: 'SENT', messages };
}

/**
 * Autorización concedida: `SENT`/`IN_PROCESS` → `AUTHORIZED` (terminal).
 * `numeroAutorizacion`/`authorizedXml` caen de vuelta al valor previo del
 * item cuando llegan `undefined` — mismo `?? $this->...` defensivo del PHP.
 */
export function markAuthorized(
  item: BatchItem,
  numeroAutorizacion: string | undefined,
  authorizedXml: string | undefined,
  messages: Message[],
): BatchItem {
  return {
    ...item,
    state: 'AUTHORIZED',
    numeroAutorizacion: numeroAutorizacion ?? item.numeroAutorizacion,
    authorizedXml: authorizedXml ?? item.authorizedXml,
    messages,
  };
}

/** Rechazo (en recepción `DEVUELTA`, o en autorización `NO AUTORIZADO`): estado terminal, sin reintento. */
export function markRejected(item: BatchItem, messages: Message[]): BatchItem {
  return { ...item, state: 'REJECTED', messages };
}

/** El SRI sigue procesando (`EN PROCESO`/`EN PROCESAMIENTO`) y `RetryPolicy` todavía permite reintentar: incrementa `attempts`. */
export function markInProcess(item: BatchItem, messages: Message[]): BatchItem {
  return { ...item, state: 'IN_PROCESS', attempts: item.attempts + 1, messages };
}

/** Reintentos agotados (`EN PROCESO` persistente o fallo de comunicación transitorio): estado terminal. */
export function markFailed(item: BatchItem, messages: Message[]): BatchItem {
  return { ...item, state: 'FAILED', messages };
}

/** Cuenta un intento sin cambiar de estado (usado en el manejo de `CommunicationError` de `BatchProcessor.step`). */
export function incrementAttempts(item: BatchItem): BatchItem {
  return { ...item, attempts: item.attempts + 1 };
}
