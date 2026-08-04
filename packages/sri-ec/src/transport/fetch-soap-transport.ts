import type { Ambiente } from '../catalogs/index.js';
import { CommunicationError } from '../errors/index.js';
import { buildAuthorizationEnvelope, buildReceptionEnvelope } from './soap-envelope.js';
import { parseAuthorization, parseReception } from './soap-response-parser.js';
import type { AuthorizationOutcome, ReceptionOutcome, SriTransport } from './types.js';
import { SRI_URLS } from './urls.js';

export interface FetchSoapTransportOptions {
  /** Timeout por llamada, en milisegundos. Por defecto 30000 (igual que `SriSoapClient::$timeout` en PHP, en segundos allá). */
  timeoutMs?: number;
  /** `fetch` a usar — inyectable para tests (mock) o para runtimes sin `fetch` global. Por defecto `globalThis.fetch`. */
  fetch?: typeof fetch;
}

/**
 * Transporte SOAP sobre `fetch` nativo: POST directo del envelope XML a los
 * web services offline del SRI, sin WSDL ni `ext-soap`. Port funcional de
 * `Teran\Sri\Transport\Psr18SoapTransport` (mismos headers, mismo criterio
 * de error, mismas URLs por ambiente) pero sobre `fetch` en vez de PSR-18.
 */
export class FetchSoapTransport implements SriTransport {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FetchSoapTransportOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async enviar(
    signedXml: string,
    ambiente: Ambiente,
    opts?: { signal?: AbortSignal },
  ): Promise<ReceptionOutcome> {
    const body = await this.post(
      SRI_URLS[ambiente].recepcion,
      buildReceptionEnvelope(signedXml),
      opts?.signal,
    );
    return parseReception(body);
  }

  async autorizar(
    claveAcceso: string,
    ambiente: Ambiente,
    opts?: { signal?: AbortSignal },
  ): Promise<AuthorizationOutcome> {
    const body = await this.post(
      SRI_URLS[ambiente].autorizacion,
      buildAuthorizationEnvelope(claveAcceso),
      opts?.signal,
    );
    return parseAuthorization(body);
  }

  /**
   * POST del envelope SOAP con los mismos headers que `Psr18SoapTransport::post()`
   * (`Content-Type: text/xml; charset=utf-8`, `SOAPAction: ''`). Combina el
   * timeout propio con el `AbortSignal` opcional del caller: cualquiera de
   * los dos que dispare primero aborta el `fetch`, y ambos casos (igual que
   * cualquier otro fallo de red) se reportan de manera uniforme como
   * `CommunicationError` — el caller no tiene forma de distinguir, desde
   * este XML de respuesta, un timeout de una cancelación manual.
   */
  private async post(url: string, soapBody: string, externalSignal?: AbortSignal): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onExternalAbort = (): void => controller.abort();

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort);
      }
    }

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '',
        },
        body: soapBody,
        signal: controller.signal,
      });

      if (response.status !== 200) {
        throw new CommunicationError(`El SRI respondió HTTP ${response.status}`);
      }

      return await response.text();
    } catch (err) {
      if (err instanceof CommunicationError) {
        throw err;
      }
      throw new CommunicationError(`Error de comunicación con el SRI: ${errorMessage(err)}`, err);
    } finally {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
