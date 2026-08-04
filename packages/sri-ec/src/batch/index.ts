/**
 * Punto de entrada del módulo `batch`: motor de envío masivo (port de
 * `Teran\Sri\Batch\*`) — estado inmutable (`BatchItem`), repositorio,
 * política de reintentos, el conductor de la máquina de estados
 * (`BatchProcessor`) y la fachada pública (`BatchEmitter`).
 */
export * from './batch-item.js';
export * from './comprobante-repository.js';
export * from './retry-policy.js';
export * from './batch-processor.js';
export * from './batch-emitter.js';
