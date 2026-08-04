/**
 * Punto de entrada público de `@amephia/sri-ec`. Re-exporta cada módulo
 * interno tal cual (mismo patrón de barrel que `documents/index.ts`,
 * `xml/index.ts`, etc.) más {@link SriClient}, la fachada de orquestación
 * de Task 12, y `batch` ({@link BatchEmitter}, Task 13) — no hay superficie
 * pública fuera de lo que se exporta aquí.
 */
export * from './batch/index.js';
export * from './catalogs/index.js';
export * from './catalogs/forma-pago.js';
export * from './documents/index.js';
export * from './emission/index.js';
export * from './errors/index.js';
export * from './schemas/index.js';
export * from './signing/index.js';
export * from './transport/index.js';
export * from './utils/clave-acceso.js';
export * from './utils/money.js';
export * from './xml/index.js';
export * from './sri-client.js';
