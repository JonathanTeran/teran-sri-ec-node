/**
 * Construcción de los envelopes SOAP 1.1 que esperan los web services
 * offline del SRI. Port literal de `Teran\Sri\Transport\SoapEnvelopeBuilder`
 * — mismos namespaces, mismos nombres de operación/parámetro.
 */

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
 */
export function buildAuthorizationEnvelope(claveAcceso: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.autorizacion">\n' +
    '   <soapenv:Header/>\n' +
    '   <soapenv:Body>\n' +
    '      <ec:autorizacionComprobante>\n' +
    `         <claveAccesoComprobante>${claveAcceso}</claveAccesoComprobante>\n` +
    '      </ec:autorizacionComprobante>\n' +
    '   </soapenv:Body>\n' +
    '</soapenv:Envelope>'
  );
}
