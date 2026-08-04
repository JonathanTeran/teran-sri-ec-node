/**
 * Punto de entrada del módulo `signing`: carga de certificados `.p12` y firma
 * XAdES-BES (análogo a `Teran\Sri\Signing\*` en el paquete PHP).
 *
 * `c14n.ts` (canonicalización C14N + serialización estilo libxml) queda fuera
 * de la API pública: es un detalle interno del firmador.
 */
export * from './certificate.js';
export * from './clock.js';
export * from './x509-der.js';
export * from './xades-signer.js';
