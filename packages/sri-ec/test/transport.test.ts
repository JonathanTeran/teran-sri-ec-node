import { describe, expect, it, vi } from 'vitest';

import { Ambiente } from '../src/catalogs/index.js';
import { CommunicationError } from '../src/errors/index.js';
import { buildAuthorizationEnvelope, buildReceptionEnvelope } from '../src/transport/soap-envelope.js';
import { parseAuthorization, parseReception } from '../src/transport/soap-response-parser.js';
import { FetchSoapTransport } from '../src/transport/fetch-soap-transport.js';
import { SRI_URLS } from '../src/transport/urls.js';

// ---------------------------------------------------------------------------
// Fixtures — respuestas SOAP reales del SRI (offline), como strings.
// ---------------------------------------------------------------------------

const RECIBIDA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion">
      <RespuestaRecepcionComprobante>
        <estado>RECIBIDA</estado>
        <comprobantes/>
      </RespuestaRecepcionComprobante>
    </ns2:validarComprobanteResponse>
  </soap:Body>
</soap:Envelope>`;

const DEVUELTA_UN_MENSAJE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion">
      <RespuestaRecepcionComprobante>
        <estado>DEVUELTA</estado>
        <comprobantes>
          <comprobante>
            <claveAcceso>2601202601179001100112345678901234567890123456</claveAcceso>
            <mensajes>
              <mensaje>
                <identificador>43</identificador>
                <mensaje>RUC del emisor no existe</mensaje>
                <tipo>ERROR</tipo>
                <informacionAdicional>1790011001001</informacionAdicional>
              </mensaje>
            </mensajes>
          </comprobante>
        </comprobantes>
      </RespuestaRecepcionComprobante>
    </ns2:validarComprobanteResponse>
  </soap:Body>
</soap:Envelope>`;

const DEVUELTA_VARIOS_MENSAJES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion">
      <RespuestaRecepcionComprobante>
        <estado>DEVUELTA</estado>
        <comprobantes>
          <comprobante>
            <claveAcceso>2601202601179001100112345678901234567890123456</claveAcceso>
            <mensajes>
              <mensaje>
                <identificador>35</identificador>
                <mensaje>Firma inválida</mensaje>
                <tipo>ERROR</tipo>
                <informacionAdicional></informacionAdicional>
              </mensaje>
              <mensaje>
                <identificador>43</identificador>
                <mensaje>RUC del emisor no existe</mensaje>
                <tipo>ERROR</tipo>
                <informacionAdicional>1790011001001</informacionAdicional>
              </mensaje>
            </mensajes>
          </comprobante>
        </comprobantes>
      </RespuestaRecepcionComprobante>
    </ns2:validarComprobanteResponse>
  </soap:Body>
</soap:Envelope>`;

const SOAP_FAULT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Server</faultcode>
      <faultstring>Error de esquema</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;

const AUTORIZADO_CDATA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion">
      <RespuestaAutorizacionComprobante>
        <claveAccesoConsultada>2601202601179001100112345678901234567890123456</claveAccesoConsultada>
        <numeroComprobantes>1</numeroComprobantes>
        <autorizaciones>
          <autorizacion>
            <estado>AUTORIZADO</estado>
            <numeroAutorizacion>2601202601179001100112345678901234567890123456</numeroAutorizacion>
            <fechaAutorizacion>2026-01-26T10:00:00-05:00</fechaAutorizacion>
            <ambiente>PRUEBAS</ambiente>
            <comprobante><![CDATA[<factura id="comprobante" version="1.1.0"><infoTributaria><ruc>1790011001001</ruc></infoTributaria></factura>]]></comprobante>
            <mensajes/>
          </autorizacion>
        </autorizaciones>
      </RespuestaAutorizacionComprobante>
    </ns2:autorizacionComprobanteResponse>
  </soap:Body>
</soap:Envelope>`;

const NO_AUTORIZADO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion">
      <RespuestaAutorizacionComprobante>
        <claveAccesoConsultada>2601202601179001100112345678901234567890123456</claveAccesoConsultada>
        <numeroComprobantes>1</numeroComprobantes>
        <autorizaciones>
          <autorizacion>
            <estado>NO AUTORIZADO</estado>
            <ambiente>PRUEBAS</ambiente>
            <mensajes>
              <mensaje>
                <identificador>45</identificador>
                <mensaje>Comprobante ya registrado con otra clave de acceso</mensaje>
                <tipo>ERROR</tipo>
                <informacionAdicional>Comprobante duplicado</informacionAdicional>
              </mensaje>
              <mensaje>
                <identificador>70</identificador>
                <mensaje>Fecha de emisión fuera de plazo</mensaje>
                <tipo>ERROR</tipo>
                <informacionAdicional></informacionAdicional>
              </mensaje>
            </mensajes>
          </autorizacion>
        </autorizaciones>
      </RespuestaAutorizacionComprobante>
    </ns2:autorizacionComprobanteResponse>
  </soap:Body>
</soap:Envelope>`;

/** Recién `RECIBIDA`, aún no procesada, o clave inexistente: ambos casos son indistinguibles desde este XML (`numeroComprobantes=0`, sin nodo `<autorizacion>`). */
const CLAVE_NO_ENCONTRADA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion">
      <RespuestaAutorizacionComprobante>
        <claveAccesoConsultada>2601202601179001100112345678901234567890123456</claveAccesoConsultada>
        <numeroComprobantes>0</numeroComprobantes>
        <autorizaciones/>
      </RespuestaAutorizacionComprobante>
    </ns2:autorizacionComprobanteResponse>
  </soap:Body>
</soap:Envelope>`;

/** Misma estructura que `AUTORIZADO_CDATA_XML` pero SIN el wrapper `RespuestaAutorizacionComprobante` (paridad con el fix de la commit 675ac68: el parser no debe depender de ese wrapper para encontrar `<autorizacion>`). */
const AUTORIZADO_SIN_WRAPPER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <autorizaciones>
      <autorizacion>
        <estado>AUTORIZADO</estado>
        <numeroAutorizacion>2601202601179001100112345678901234567890123456</numeroAutorizacion>
        <fechaAutorizacion>2026-01-26T10:00:00-05:00</fechaAutorizacion>
        <comprobante>&lt;factura/&gt;</comprobante>
        <mensajes/>
      </autorizacion>
    </autorizaciones>
  </soap:Body>
</soap:Envelope>`;

const MALFORMED_XML = `<soap:Envelope><soap:Body><oops></soap:Body>`;

describe('soap-envelope', () => {
  it('buildReceptionEnvelope codifica el XML firmado en base64 dentro de <xml>', () => {
    const signed = '<factura>áé&</factura>';
    const env = buildReceptionEnvelope(signed);

    expect(env).toContain('http://ec.gob.sri.ws.recepcion');
    expect(env).toContain('validarComprobante');
    expect(env).toContain(`<xml>${Buffer.from(signed, 'utf-8').toString('base64')}</xml>`);
  });

  it('buildAuthorizationEnvelope lleva la clave de acceso sin transformar', () => {
    const env = buildAuthorizationEnvelope('2601202601179001100112345678901234567890123456');

    expect(env).toContain('http://ec.gob.sri.ws.autorizacion');
    expect(env).toContain('autorizacionComprobante');
    expect(env).toContain(
      '<claveAccesoComprobante>2601202601179001100112345678901234567890123456</claveAccesoComprobante>',
    );
  });
});

describe('parseReception', () => {
  it('parsea RECIBIDA sin mensajes', () => {
    const outcome = parseReception(RECIBIDA_XML);

    expect(outcome.estado).toBe('RECIBIDA');
    expect(outcome.mensajes).toEqual([]);
  });

  it('parsea DEVUELTA con un único mensaje (objeto suelto, no array, en fast-xml-parser)', () => {
    const outcome = parseReception(DEVUELTA_UN_MENSAJE_XML);

    expect(outcome.estado).toBe('DEVUELTA');
    expect(outcome.mensajes).toHaveLength(1);
    expect(outcome.mensajes[0]).toEqual({
      identificador: '43',
      mensaje: 'RUC del emisor no existe',
      tipo: 'ERROR',
      informacionAdicional: '1790011001001',
    });
  });

  it('parsea DEVUELTA con varios mensajes (array) y normaliza informacionAdicional vacío a cadena vacía', () => {
    const outcome = parseReception(DEVUELTA_VARIOS_MENSAJES_XML);

    expect(outcome.estado).toBe('DEVUELTA');
    expect(outcome.mensajes).toHaveLength(2);
    expect(outcome.mensajes[0]?.identificador).toBe('35');
    expect(outcome.mensajes[0]?.informacionAdicional).toBe('');
    expect(outcome.mensajes[1]?.identificador).toBe('43');
    expect(outcome.mensajes[1]?.informacionAdicional).toBe('1790011001001');
  });

  it('lanza CommunicationError con el faultstring cuando la respuesta es un SOAP Fault', () => {
    expect(() => parseReception(SOAP_FAULT_XML)).toThrow(CommunicationError);
    try {
      parseReception(SOAP_FAULT_XML);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CommunicationError);
      expect((err as CommunicationError).message).toContain('Error de esquema');
    }
  });

  it('lanza CommunicationError ante XML malformado', () => {
    expect(() => parseReception(MALFORMED_XML)).toThrow(CommunicationError);
  });
});

describe('parseAuthorization', () => {
  it('parsea AUTORIZADO desenvolviendo el CDATA del comprobante', () => {
    const outcome = parseAuthorization(AUTORIZADO_CDATA_XML);

    expect(outcome.estado).toBe('AUTORIZADO');
    expect(outcome.numeroAutorizacion).toBe('2601202601179001100112345678901234567890123456');
    expect(outcome.fechaAutorizacion).toBe('2026-01-26T10:00:00-05:00');
    expect(outcome.comprobante).toBe(
      '<factura id="comprobante" version="1.1.0"><infoTributaria><ruc>1790011001001</ruc></infoTributaria></factura>',
    );
    expect(outcome.mensajes).toEqual([]);
  });

  it('numeroAutorizacion largo se conserva como string exacto (no como number/notación científica)', () => {
    const outcome = parseAuthorization(AUTORIZADO_CDATA_XML);

    expect(outcome.numeroAutorizacion).toBe('2601202601179001100112345678901234567890123456');
    expect(typeof outcome.numeroAutorizacion).toBe('string');
  });

  it('parsea NO AUTORIZADO con varios mensajes (array) y sin numeroAutorizacion/comprobante', () => {
    const outcome = parseAuthorization(NO_AUTORIZADO_XML);

    expect(outcome.estado).toBe('NO AUTORIZADO');
    expect(outcome.numeroAutorizacion).toBeUndefined();
    expect(outcome.comprobante).toBeUndefined();
    expect(outcome.mensajes).toHaveLength(2);
    expect(outcome.mensajes[0]).toEqual({
      identificador: '45',
      mensaje: 'Comprobante ya registrado con otra clave de acceso',
      tipo: 'ERROR',
      informacionAdicional: 'Comprobante duplicado',
    });
    expect(outcome.mensajes[1]?.informacionAdicional).toBe('');
  });

  it('parsea EN PROCESO cuando el SRI aún no tiene autorización (numeroComprobantes=0 / clave no encontrada)', () => {
    const outcome = parseAuthorization(CLAVE_NO_ENCONTRADA_XML);

    expect(outcome.estado).toBe('EN PROCESO');
    expect(outcome.numeroAutorizacion).toBeUndefined();
    expect(outcome.fechaAutorizacion).toBeUndefined();
    expect(outcome.comprobante).toBeUndefined();
    expect(outcome.mensajes).toEqual([]);
  });

  it('encuentra <autorizacion> incluso sin el wrapper RespuestaAutorizacionComprobante (paridad con la commit 675ac68)', () => {
    const outcome = parseAuthorization(AUTORIZADO_SIN_WRAPPER_XML);

    expect(outcome.estado).toBe('AUTORIZADO');
    expect(outcome.numeroAutorizacion).toBe('2601202601179001100112345678901234567890123456');
    expect(outcome.comprobante).toBe('<factura/>');
  });

  it('lanza CommunicationError con el faultstring cuando la respuesta es un SOAP Fault', () => {
    try {
      parseAuthorization(SOAP_FAULT_XML);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CommunicationError);
      expect((err as CommunicationError).message).toContain('Error de esquema');
    }
  });

  it('lanza CommunicationError ante XML malformado', () => {
    expect(() => parseAuthorization(MALFORMED_XML)).toThrow(CommunicationError);
  });
});

// ---------------------------------------------------------------------------
// FetchSoapTransport
// ---------------------------------------------------------------------------

function okResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

describe('FetchSoapTransport', () => {
  it('enviar() hace POST a la URL de recepción de pruebas con los headers y el XML en base64', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => okResponse(RECIBIDA_XML));
    const transport = new FetchSoapTransport({ fetch: fetchMock as unknown as typeof fetch });

    const outcome = await transport.enviar('<factura/>', Ambiente.Pruebas);

    expect(outcome.estado).toBe('RECIBIDA');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(SRI_URLS[Ambiente.Pruebas].recepcion);
    expect(String(url)).toContain('celcer.sri.gob.ec');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('text/xml; charset=utf-8');
    expect((init?.headers as Record<string, string>)['SOAPAction']).toBe('');
    expect(String(init?.body)).toContain(
      `<xml>${Buffer.from('<factura/>', 'utf-8').toString('base64')}</xml>`,
    );
  });

  it('autorizar() usa el endpoint de producción (cel, no celcer) para Ambiente.Produccion', async () => {
    const fetchMock = vi.fn(async () => okResponse(AUTORIZADO_CDATA_XML));
    const transport = new FetchSoapTransport({ fetch: fetchMock as unknown as typeof fetch });

    const outcome = await transport.autorizar(
      '2601202601179001100112345678901234567890123456',
      Ambiente.Produccion,
    );

    expect(outcome.estado).toBe('AUTORIZADO');
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe(SRI_URLS[Ambiente.Produccion].autorizacion);
    expect(String(url)).toContain('cel.sri.gob.ec');
    expect(String(url)).not.toContain('celcer');
  });

  it('HTTP 500 lanza CommunicationError con el código de estado en el mensaje', async () => {
    const fetchMock = vi.fn(async () => new Response('Internal Server Error', { status: 500 }));
    const transport = new FetchSoapTransport({ fetch: fetchMock as unknown as typeof fetch });

    await expect(transport.enviar('<factura/>', Ambiente.Pruebas)).rejects.toThrow(CommunicationError);
    await expect(transport.enviar('<factura/>', Ambiente.Pruebas)).rejects.toThrow('HTTP 500');
  });

  it('el rechazo del fetch subyacente (red caída) se envuelve en CommunicationError', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const transport = new FetchSoapTransport({ fetch: fetchMock as unknown as typeof fetch });

    await expect(transport.enviar('<factura/>', Ambiente.Pruebas)).rejects.toThrow(CommunicationError);
    await expect(transport.enviar('<factura/>', Ambiente.Pruebas)).rejects.toThrow(
      'Error de comunicación con el SRI',
    );
  });

  it('timeout (AbortSignal por timeoutMs) lanza CommunicationError', async () => {
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
        // Nunca resuelve por sí sola: solo el abort debe destrabar la promesa.
        setTimeout(() => resolve(okResponse(RECIBIDA_XML)), 60_000);
      });
    });
    const transport = new FetchSoapTransport({
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 10,
    });

    await expect(transport.enviar('<factura/>', Ambiente.Pruebas)).rejects.toThrow(CommunicationError);
  });

  it('un AbortSignal externo cancelado también resulta en CommunicationError', async () => {
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const transport = new FetchSoapTransport({ fetch: fetchMock as unknown as typeof fetch });
    const controller = new AbortController();

    const promise = transport.enviar('<factura/>', Ambiente.Pruebas, { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow(CommunicationError);
  });

  it('un cuerpo de respuesta con XML malformado también resulta en CommunicationError', async () => {
    const fetchMock = vi.fn(async () => okResponse(MALFORMED_XML));
    const transport = new FetchSoapTransport({ fetch: fetchMock as unknown as typeof fetch });

    await expect(transport.enviar('<factura/>', Ambiente.Pruebas)).rejects.toThrow(CommunicationError);
  });
});
