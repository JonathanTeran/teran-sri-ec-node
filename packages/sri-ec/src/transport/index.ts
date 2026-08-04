/**
 * Punto de entrada del módulo `transport`: envelopes SOAP, parser de
 * respuestas, URLs por ambiente y el transporte por defecto sobre `fetch`
 * nativo (análogo a `Teran\Sri\Transport\*` en el paquete PHP).
 */
export * from './types.js';
export * from './urls.js';
export * from './soap-envelope.js';
export * from './soap-response-parser.js';
export * from './fetch-soap-transport.js';
