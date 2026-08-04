import type { Ambiente } from '../catalogs/index.js';
import type { Message } from '../emission/index.js';

/**
 * Resultado de `validarComprobante` (recepción). Port de
 * `Teran\Sri\Transport\ReceptionOutcome`. `estado` es el string crudo que
 * devuelve el SRI en el wire (`RECIBIDA` | `DEVUELTA`, u otro valor no
 * documentado que el SRI decida enviar) — la normalización a
 * `EmissionStatus` interno es responsabilidad de `SriClient` (fuera de
 * alcance de este módulo).
 */
export interface ReceptionOutcome {
  estado: string;
  mensajes: Message[];
}

/**
 * Resultado de `autorizacionComprobante` (autorización). Port de
 * `Teran\Sri\Transport\AuthorizationOutcome`. Cuando el SRI todavía no tiene
 * ningún nodo `<autorizacion>` que devolver (recién `RECIBIDA`, o
 * `numeroComprobantes=0`), `estado` es `'EN PROCESO'` y el resto de campos
 * quedan `undefined` — ver `parseAuthorization()` en `soap-response-parser.ts`.
 */
export interface AuthorizationOutcome {
  estado: string;
  numeroAutorizacion?: string;
  fechaAutorizacion?: string;
  comprobante?: string;
  mensajes: Message[];
}

/**
 * Contrato de transporte hacia los web services SOAP offline del SRI. Port
 * de `Teran\Sri\Transport\SriTransportInterface`. `FetchSoapTransport` es la
 * implementación por defecto (basada en `fetch` nativo); `SriClient` acepta
 * cualquier otra implementación vía inyección (p.ej. para tests).
 */
export interface SriTransport {
  enviar(
    signedXml: string,
    ambiente: Ambiente,
    opts?: { signal?: AbortSignal },
  ): Promise<ReceptionOutcome>;

  autorizar(
    claveAcceso: string,
    ambiente: Ambiente,
    opts?: { signal?: AbortSignal },
  ): Promise<AuthorizationOutcome>;
}
