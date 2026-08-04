import { CertificateError } from '../errors/index.js';

/**
 * Parseo mínimo de DER/X.509 hecho a mano, sin depender de node-forge para
 * esta parte. Es un port directo de `Teran\Sri\Signing\IssuerName` (PHP),
 * extendido para también extraer `serialNumber`, `notAfter` y el OID del
 * algoritmo de la clave pública — todo lo que necesita `certificateInfo()`.
 *
 * ¿Por qué no usar `forge.pki.certificateFromAsn1`/`certificateFromPem`? Esa
 * función de node-forge exige que la SubjectPublicKeyInfo sea RSA
 * (`if (oid !== pki.oids.rsaEncryption) throw ...`) — un certificado con
 * clave EC hace que *toda* la función falle, no solo la parte de la clave.
 * Parseando el DER nosotros mismos evitamos esa limitación y, de paso,
 * replicamos EXACTAMENTE el formato RFC 2253 (estilo Java X500Principal)
 * que exige el validador XAdES del SRI para `<ds:X509IssuerName>` — ver el
 * comentario de cabecera de `IssuerName.php` para el detalle de por qué el
 * formato de OpenSSL no sirve.
 */

/** OIDs de SubjectPublicKeyInfo.algorithm que representan una clave RSA. */
const RSA_ALGORITHM_OIDS = new Set([
  '1.2.840.113549.1.1.1', // rsaEncryption
  '1.2.840.113549.1.1.10', // RSASSA-PSS
]);

/** OID de SubjectPublicKeyInfo.algorithm para claves EC (id-ecPublicKey). */
const EC_ALGORITHM_OID = '1.2.840.10045.2.1';

/**
 * OIDs que RFC 2253 (y X500Principal) representan con palabra clave.
 * Cualquier OID fuera de este mapa se emite como `oid.numerico=#hexDER`.
 */
const KEYWORDS: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'STREET',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '0.9.2342.19200300.100.1.25': 'DC',
  '0.9.2342.19200300.100.1.1': 'UID',
};

export interface ParsedCertificateFields {
  /** Número de serie como decimal de precisión arbitraria (sin signo). */
  serialNumberDecimal: string;
  /** DN del emisor en formato RFC 2253 (estilo Java X500Principal). */
  issuerRfc4514: string;
  notAfter: Date;
  keyType: 'RSA' | 'EC';
}

/**
 * Parsea los campos de un certificado X.509 en PEM que necesita
 * `certificateInfo()`, sin pasar por node-forge.
 */
export function parseCertificateFields(certificatePem: string): ParsedCertificateFields {
  const der = pemToDer(certificatePem);
  const fields = extractFields(der);

  let keyType: 'RSA' | 'EC';
  if (RSA_ALGORITHM_OIDS.has(fields.publicKeyAlgorithmOid)) {
    keyType = 'RSA';
  } else if (fields.publicKeyAlgorithmOid === EC_ALGORITHM_OID) {
    keyType = 'EC';
  } else {
    throw new CertificateError(
      `Certificate: tipo de clave pública no soportado (OID ${fields.publicKeyAlgorithmOid}).`,
    );
  }

  return {
    serialNumberDecimal: hexToDecimalString(fields.serialNumberHex),
    issuerRfc4514: fields.issuerRfc4514,
    notAfter: fields.notAfter,
    keyType,
  };
}

function pemToDer(certificate: string): Uint8Array {
  if (certificate.includes('-----BEGIN')) {
    const body = certificate.replace(/-----[^-]+-----|\s+/g, '');
    if (body === '') {
      throw new CertificateError('El certificado PEM no contiene base64 válido.');
    }
    const der = Buffer.from(body, 'base64');
    if (der.length === 0) {
      throw new CertificateError('El certificado PEM no contiene base64 válido.');
    }
    return der;
  }
  throw new CertificateError('El certificado está vacío o no está en formato PEM.');
}

interface RawFields {
  serialNumberHex: string;
  issuerRfc4514: string;
  notAfter: Date;
  publicKeyAlgorithmOid: string;
}

/**
 * Navega Certificate -> tbsCertificate, extrayendo serialNumber, issuer
 * (RDNSequence), validity.notAfter y subjectPublicKeyInfo.algorithm.
 */
function extractFields(der: Uint8Array): RawFields {
  const certificate = readTlv(der, 0); // Certificate ::= SEQUENCE
  const tbs = readTlv(der, certificate.cs); // tbsCertificate ::= SEQUENCE

  let pos = tbs.cs;
  let node = readTlv(der, pos);
  if (node.tag === 0xa0) {
    // [0] EXPLICIT version (opcional)
    pos = node.next;
    node = readTlv(der, pos);
  }

  // serialNumber ::= INTEGER
  const serialNumberTlv = node;
  const serialNumberHex = bytesToHex(der.subarray(serialNumberTlv.cs, serialNumberTlv.next));
  pos = serialNumberTlv.next;

  // signature ::= AlgorithmIdentifier (SEQUENCE) — se omite.
  pos = readTlv(der, pos).next;

  // issuer ::= Name (RDNSequence = SEQUENCE)
  const issuer = readTlv(der, pos);
  if (issuer.tag !== 0x30) {
    throw new CertificateError(
      'Estructura del certificado inválida: no se encontró el emisor (RDNSequence).',
    );
  }
  pos = issuer.next;
  const issuerRfc4514 = formatRdnSequence(der, issuer.cs, issuer.next);

  // validity ::= SEQUENCE { notBefore Time, notAfter Time }
  const validity = readTlv(der, pos);
  pos = validity.next;
  const notBeforeTlv = readTlv(der, validity.cs);
  const notAfterTlv = readTlv(der, notBeforeTlv.next);
  const notAfter = decodeTime(notAfterTlv.tag, der.subarray(notAfterTlv.cs, notAfterTlv.next));

  // subject ::= Name (RDNSequence) — se omite.
  const subject = readTlv(der, pos);
  pos = subject.next;

  // subjectPublicKeyInfo ::= SEQUENCE { algorithm AlgorithmIdentifier, ... }
  const spki = readTlv(der, pos);
  const algorithmId = readTlv(der, spki.cs); // AlgorithmIdentifier ::= SEQUENCE
  const algorithmOidTlv = readTlv(der, algorithmId.cs); // algorithm ::= OID
  const publicKeyAlgorithmOid = decodeOid(
    der.subarray(algorithmOidTlv.cs, algorithmOidTlv.next),
  );

  return { serialNumberHex, issuerRfc4514, notAfter, publicKeyAlgorithmOid };
}

interface Tlv {
  tag: number;
  /** content start */
  cs: number;
  len: number;
  /** offset justo después del contenido (inicio del siguiente TLV) */
  next: number;
}

/** Lee una estructura TLV (Tag-Length-Value) DER con validación de límites. */
function readTlv(der: Uint8Array, offset: number): Tlv {
  const size = der.length;
  if (offset < 0 || offset + 2 > size) {
    throw new CertificateError('DER truncado al leer la cabecera TLV.');
  }

  const tag = der[offset]!;
  const lengthByte = der[offset + 1]!;

  let contentStart: number;
  let length: number;
  if (lengthByte < 0x80) {
    contentStart = offset + 2;
    length = lengthByte;
  } else {
    const numBytes = lengthByte & 0x7f;
    if (numBytes === 0 || numBytes > 4 || offset + 2 + numBytes > size) {
      throw new CertificateError('DER con longitud inválida.');
    }
    length = 0;
    for (let i = 0; i < numBytes; i++) {
      length = (length << 8) | der[offset + 2 + i]!;
    }
    contentStart = offset + 2 + numBytes;
  }

  if (contentStart + length > size) {
    throw new CertificateError('DER truncado: el contenido excede el tamaño del certificado.');
  }

  return { tag, cs: contentStart, len: length, next: contentStart + length };
}

/** Serializa una RDNSequence en orden inverso (RFC 2253). */
function formatRdnSequence(der: Uint8Array, start: number, end: number): string {
  const rdns: string[] = [];
  let pos = start;

  while (pos < end) {
    const set = readTlv(der, pos); // RelativeDistinguishedName ::= SET OF
    const avas: string[] = [];
    let inner = set.cs;

    while (inner < set.next) {
      const ava = readTlv(der, inner); // AttributeTypeAndValue ::= SEQUENCE
      const oidTlv = readTlv(der, ava.cs);
      const oid = decodeOid(der.subarray(oidTlv.cs, oidTlv.next));
      const valueTlv = readTlv(der, oidTlv.next);

      const keyword = KEYWORDS[oid];
      if (keyword !== undefined) {
        const value = decodeDirectoryString(
          valueTlv.tag,
          der.subarray(valueTlv.cs, valueTlv.next),
        );
        avas.push(`${keyword}=${escapeRdnValue(value)}`);
      } else {
        // OID desconocido: el valor se emite como #<DER en hex minúscula> (tag+long+valor).
        const valueDer = der.subarray(oidTlv.next, valueTlv.next);
        avas.push(`${oid}=#${bytesToHex(valueDer)}`);
      }

      inner = ava.next;
    }

    rdns.push(avas.join('+'));
    pos = set.next;
  }

  return rdns.reverse().join(',');
}

/** Decodifica los bytes de un OBJECT IDENTIFIER a su forma con puntos. */
function decodeOid(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    throw new CertificateError('OID vacío en el certificado.');
  }

  // El primer subidentificador codifica 40*arco1 + arco2 y puede ocupar
  // varios bytes (base 128, bit 0x80 = continúa).
  let index = 0;
  let first = 0;
  let more: boolean;
  do {
    first = (first << 7) | (bytes[index]! & 0x7f);
    more = (bytes[index]! & 0x80) !== 0;
    index++;
  } while (more && index < bytes.length);

  const arc1 = first < 40 ? 0 : first < 80 ? 1 : 2;
  const arcs = [arc1, first - 40 * arc1];

  let value = 0;
  for (; index < bytes.length; index++) {
    value = (value << 7) | (bytes[index]! & 0x7f);
    if ((bytes[index]! & 0x80) === 0) {
      arcs.push(value);
      value = 0;
    }
  }

  return arcs.join('.');
}

/** Decodifica el valor de un AttributeValue de tipo DirectoryString a UTF-8/JS string. */
function decodeDirectoryString(tag: number, content: Uint8Array): string {
  if (tag === 0x1e) {
    // BMPString (UTF-16BE)
    return utf16BeToString(content);
  }
  if (tag === 0x1c) {
    // UniversalString (UTF-32BE)
    return utf32BeToString(content);
  }
  // UTF8String (0x0C), PrintableString (0x13), IA5String (0x16),
  // TeletexString (0x14), VisibleString (0x1A), etc.: bytes ya son
  // UTF-8/ASCII compatibles.
  return Buffer.from(content).toString('utf-8');
}

function utf16BeToString(bytes: Uint8Array): string {
  const le = Buffer.alloc(bytes.length - (bytes.length % 2));
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    le[i] = bytes[i + 1]!;
    le[i + 1] = bytes[i]!;
  }
  return le.toString('utf16le');
}

function utf32BeToString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    const codePoint =
      ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0;
    out += String.fromCodePoint(codePoint);
  }
  return out;
}

/**
 * Escapa un valor de DN igual que `X500Principal.getName("RFC2253")`: los
 * caracteres `, + " \ < > ; = #` se escapan en cualquier posición, y un
 * espacio al inicio o al final también.
 */
function escapeRdnValue(value: string): string {
  const specials = new Set([',', '+', '"', '\\', '<', '>', ';', '=', '#']);
  const chars = Array.from(value);
  const length = chars.length;
  let out = '';

  for (let i = 0; i < length; i++) {
    const char = chars[i]!;
    if (specials.has(char)) {
      out += '\\' + char;
    } else if (char === ' ' && (i === 0 || i === length - 1)) {
      out += '\\' + char;
    } else {
      out += char;
    }
  }

  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Convierte un hex sin signo (posible '00' de padding incluido) a decimal. */
function hexToDecimalString(hex: string): string {
  if (hex === '') {
    return '0';
  }
  return BigInt(`0x${hex}`).toString(10);
}

function decodeTime(tag: number, bytes: Uint8Array): Date {
  const str = Buffer.from(bytes).toString('ascii');

  if (tag === 0x17) {
    // UTCTime ::= YYMMDDHHMMSSZ
    const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(str);
    if (!m) {
      throw new CertificateError(`Formato de UTCTime inválido en el certificado: "${str}".`);
    }
    const [, yy, mm, dd, hh, mi, ss] = m as unknown as [string, string, string, string, string, string, string];
    const year = Number(yy) < 50 ? 2000 + Number(yy) : 1900 + Number(yy);
    return new Date(Date.UTC(year, Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)));
  }

  if (tag === 0x18) {
    // GeneralizedTime ::= YYYYMMDDHHMMSS[.fff]Z
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z$/.exec(str);
    if (!m) {
      throw new CertificateError(
        `Formato de GeneralizedTime inválido en el certificado: "${str}".`,
      );
    }
    const [, yyyy, mm, dd, hh, mi, ss] = m as unknown as [string, string, string, string, string, string, string];
    return new Date(
      Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)),
    );
  }

  throw new CertificateError(
    `Tipo de tiempo ASN.1 no soportado (tag 0x${tag.toString(16)}) en el certificado.`,
  );
}
