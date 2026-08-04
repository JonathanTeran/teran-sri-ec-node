/**
 * Construcción de los envelopes SOAP 1.1 que esperan los web services
 * offline del SRI. Port literal de `Teran\Sri\Transport\SoapEnvelopeBuilder`
 * — mismos namespaces, mismos nombres de operación/parámetro.
 */
import { ValidationError } from '../errors/index.js';
import { escapeXml } from '../xml/xml-builder.js';

/** Una clave de acceso del SRI son exactamente 49 dígitos decimales. */
const CLAVE_ACCESO_PATTERN = /^\d{49}$/;

/**
 * Frontera de confianza del transporte: valida que `claveAcceso` sea
 * literalmente 49 dígitos antes de interpolarla en el envelope SOAP.
 *
 * La clave puede llegar de un caller arbitrario (`SriClient.authorize()`,
 * `BatchEmitter`, una fila de base de datos, un parámetro HTTP), y el
 * envelope se construye por concatenación de strings: sin esta comprobación,
 * un valor como `</claveAccesoComprobante><algo>…` reescribiría el cuerpo
 * SOAP enviado al SRI. Se valida (y no solo se escapa) porque cualquier cosa
 * que no sean 49 dígitos es, por definición, una clave inválida: no hay caso
 * legítimo que perder.
 *
 * @throws ValidationError si `claveAcceso` no son exactamente 49 dígitos.
 */
export function assertClaveAccesoWireSegura(claveAcceso: string): string {
  if (!CLAVE_ACCESO_PATTERN.test(claveAcceso)) {
    throw new ValidationError('Clave de acceso inválida para consulta al SRI', [
      'claveAcceso debe ser exactamente 49 dígitos decimales.',
    ]);
  }
  return claveAcceso;
}

/**
 * Envelope de `validarComprobante` (recepción). El XML firmado va en base64
 * dentro de `<xml>` — el SRI decodifica ese base64 y valida el XSD/firma del
 * comprobante resultante. Port de `SoapEnvelopeBuilder::reception()`.
 */
export function buildReceptionEnvelope(signedXml: string): string {
  const b64 = Buffer.from(signedXml, 'utf-8').toString('base64');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.recepcion">\n' +
    '   <soapenv:Header/>\n' +
    '   <soapenv:Body>\n' +
    '      <ec:validarComprobante>\n' +
    `         <xml>${b64}</xml>\n` +
    '      </ec:validarComprobante>\n' +
    '   </soapenv:Body>\n' +
    '</soapenv:Envelope>'
  );
}

/**
 * Envelope de `autorizacionComprobante` (consulta de autorización por clave
 * de acceso). Port de `SoapEnvelopeBuilder::authorization()`.
 *
 * `claveAcceso` se valida con {@link assertClaveAccesoWireSegura} y además se
 * escapa con `escapeXml()` (defensa en profundidad: si la validación se
 * relajara alguna vez, el escape seguiría impidiendo la inyección XML). Para
 * una clave legítima de 49 dígitos el escape es la identidad, así que el
 * envelope resultante es byte a byte el mismo que producía el PHP.
 *
 * @throws ValidationError si `claveAcceso` no son exactamente 49 dígitos.
 */
export function buildAuthorizationEnvelope(claveAcceso: string): string {
  assertClaveAccesoWireSegura(claveAcceso);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.autorizacion">\n' +
    '   <soapenv:Header/>\n' +
    '   <soapenv:Body>\n' +
    '      <ec:autorizacionComprobante>\n' +
    `         <claveAccesoComprobante>${escapeXml(claveAcceso)}</claveAccesoComprobante>\n` +
    '      </ec:autorizacionComprobante>\n' +
    '   </soapenv:Body>\n' +
    '</soapenv:Envelope>'
  );
}
