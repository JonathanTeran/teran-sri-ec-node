import forge from 'node-forge';

import { CertificateError } from '../errors/index.js';
import { parseCertificateFields } from './x509-der.js';

/**
 * Certificado de firma ya extraído de un `.p12`: la hoja (leaf) en PEM, su
 * clave privada en PEM y, opcionalmente, la cadena de CAs intermedias.
 *
 * Equivalente a `Teran\Sri\Signing\Certificate` (PHP), pero como interfaz de
 * datos plana (sin invariantes en el constructor) — la validación de que el
 * `.p12` produjo un cert/key utilizables ocurre en `loadCertificate()`.
 */
export interface Certificate {
  certPem: string;
  privateKeyPem: string;
  /** CAs intermedias en PEM. */
  extraCerts: string[];
}

export interface CertificateInfo {
  /** Número de serie como decimal de precisión arbitraria. */
  serialNumberDecimal: string;
  /** DN del emisor en formato RFC 2253 (estilo Java X500Principal, el que espera el SRI). */
  issuerRfc4514: string;
  notAfter: Date;
  keyType: 'RSA' | 'EC';
}

type Pkcs12Bag = forge.pkcs12.Bag;

const KEY_BAG_TYPES = new Set<string>([
  forge.pki.oids['keyBag']!,
  forge.pki.oids['pkcs8ShroudedKeyBag']!,
]);
const CERT_BAG_TYPE = forge.pki.oids['certBag']!;

/**
 * Carga un `.p12` con node-forge (JS puro): a diferencia del `CertificateLoader`
 * de PHP, esto NO necesita un fallback a la CLI de OpenSSL para certificados
 * legacy (RC2/3DES pre-2024) — node-forge implementa esos algoritmos de PBE de
 * forma nativa y descifra ambos formatos igual. Por eso no existe aquí un
 * equivalente a `loadViaOpensslCli`: node-forge ya cubre ese caso.
 */
export function loadCertificate(p12: Uint8Array, password: string): Certificate {
  const pfx = parsePfx(p12, password);

  const bags = pfx.safeContents.flatMap((sc) => sc.safeBags);
  const keyBags = bags.filter((bag): boolean => KEY_BAG_TYPES.has(bag.type) && Boolean(bag.key));
  const certBags = bags.filter((bag) => bag.type === CERT_BAG_TYPE);

  const { keyBag, certBag, extraCertBags } = selectCredential(keyBags, certBags);

  return {
    certPem: certBagToPem(certBag),
    privateKeyPem: forge.pki.privateKeyToPem(keyBag.key!),
    extraCerts: extraCertBags.map(certBagToPem),
  };
}

export interface CredentialSelection {
  keyBag: Pkcs12Bag;
  certBag: Pkcs12Bag;
  extraCertBags: Pkcs12Bag[];
}

/**
 * Heurística de selección de credencial, aislada para poder testearla sin
 * depender de un `.p12` real con varias claves (difícil de generar con la
 * CLI de `openssl`, que solo exporta un par cert/key por invocación).
 *
 * Caso común (un único par cert/key, la inmensa mayoría de los `.p12` del
 * SRI): se toma directamente. Con varias claves, ver `pickBestKeyBag`.
 */
export function selectCredential(
  keyBags: Pkcs12Bag[],
  certBags: Pkcs12Bag[],
): CredentialSelection {
  if (keyBags.length === 0) {
    throw new CertificateError(
      'El archivo .p12 no contiene ninguna clave privada (o su tipo de clave no es soportado).',
    );
  }
  if (certBags.length === 0) {
    throw new CertificateError('El archivo .p12 no contiene ningún certificado.');
  }

  const keyBag = keyBags.length === 1 ? keyBags[0]! : pickBestKeyBag(keyBags, certBags);
  const certBag = matchCertBagForKey(keyBag, certBags);
  const extraCertBags = certBags.filter((bag) => bag !== certBag);

  return { keyBag, certBag, extraCertBags };
}

/**
 * Parsea los campos de `certificateInfo` re-leyendo el DER del `certPem`
 * directamente (ver `x509-der.ts`): evita depender de node-forge para esta
 * parte, ya que `forge.pki.certificateFromAsn1` rechaza certificados con
 * clave pública EC incluso cuando solo se necesitan metadatos del emisor.
 */
export function certificateInfo(cert: Certificate): CertificateInfo {
  return parseCertificateFields(cert.certPem);
}

function parsePfx(p12: Uint8Array, password: string): forge.pkcs12.Pkcs12Pfx {
  try {
    const binary = Buffer.from(p12).toString('binary');
    const asn1 = forge.asn1.fromDer(binary);
    return forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch (err) {
    throw new CertificateError(
      `No se pudo leer el certificado .p12. Verifique la contraseña y el archivo. (${errorMessage(err)})`,
    );
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Hex del atributo `localKeyId` de un bag, si lo tiene. */
function localKeyIdHex(bag: Pkcs12Bag): string | undefined {
  const raw = (bag.attributes as Record<string, string[] | undefined> | undefined)?.[
    'localKeyId'
  ]?.[0];
  if (typeof raw !== 'string' || raw === '') {
    return undefined;
  }
  let hex = '';
  for (let i = 0; i < raw.length; i++) {
    hex += raw.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

function hasFriendlyName(bag: Pkcs12Bag): boolean {
  const raw = (bag.attributes as Record<string, string[] | undefined> | undefined)?.[
    'friendlyName'
  ]?.[0];
  return typeof raw === 'string' && raw !== '';
}

/** true si el certBag tiene keyUsage de firma (digitalSignature o nonRepudiation). */
function hasSigningKeyUsage(certBag: Pkcs12Bag): boolean {
  const cert = certBag.cert;
  if (!cert) {
    return false;
  }
  const ku = cert.getExtension('keyUsage') as
    | { digitalSignature?: boolean; nonRepudiation?: boolean }
    | undefined;
  if (!ku) {
    return false;
  }
  return Boolean(ku.digitalSignature) || Boolean(ku.nonRepudiation);
}

/** Compara el módulo RSA de un certificado contra el de una clave privada. */
function sameRsaModulus(certBag: Pkcs12Bag, keyBag: Pkcs12Bag): boolean {
  const publicKey = certBag.cert?.publicKey as { n?: { toString(radix: number): string } };
  const privateKey = keyBag.key as { n?: { toString(radix: number): string } } | undefined;
  if (!publicKey?.n || !privateKey?.n) {
    return false;
  }
  return publicKey.n.toString(16) === privateKey.n.toString(16);
}

/**
 * Encuentra el certificado que corresponde a una clave privada dada:
 * primero por `localKeyId` (el mecanismo estándar de PKCS#12 para vincular
 * bags), luego por coincidencia del módulo RSA, y como último recurso el
 * primer certificado disponible.
 */
function matchCertBagForKey(keyBag: Pkcs12Bag, certBags: Pkcs12Bag[]): Pkcs12Bag {
  const keyId = localKeyIdHex(keyBag);
  if (keyId !== undefined) {
    const byId = certBags.find((certBag) => localKeyIdHex(certBag) === keyId);
    if (byId) {
      return byId;
    }
  }

  const byModulus = certBags.find((certBag) => sameRsaModulus(certBag, keyBag));
  if (byModulus) {
    return byModulus;
  }

  return certBags[0]!;
}

/**
 * Heurística de selección de credencial cuando el `.p12` trae varias claves
 * privadas (caso raro, pero contemplado por `CertificateLoader` en PHP a
 * través del comportamiento interno de `openssl_pkcs12_read`/`PKCS12_parse`):
 * se prefiere la clave cuyo certificado asociado tiene keyUsage de firma
 * (`digitalSignature`/`nonRepudiation`) y, en segundo lugar, la que tiene un
 * `friendlyName` (indicio de que fue etiquetada explícitamente por la CA/el
 * usuario como la credencial "principal").
 */
function pickBestKeyBag(keyBags: Pkcs12Bag[], certBags: Pkcs12Bag[]): Pkcs12Bag {
  let best = keyBags[0]!;
  let bestScore = -1;

  for (const keyBag of keyBags) {
    const matchedCert = matchCertBagForKey(keyBag, certBags);
    let score = 0;
    if (hasSigningKeyUsage(matchedCert)) {
      score += 2;
    }
    if (hasFriendlyName(keyBag) || hasFriendlyName(matchedCert)) {
      score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = keyBag;
    }
  }

  return best;
}

/** Serializa un certBag a PEM, incluso si node-forge no pudo parsearlo semánticamente (p.ej. clave EC). */
function certBagToPem(bag: Pkcs12Bag): string {
  if (bag.cert) {
    return forge.pki.certificateToPem(bag.cert);
  }
  if (bag.asn1) {
    const der = Buffer.from(forge.asn1.toDer(bag.asn1).getBytes(), 'binary');
    return pemEncode('CERTIFICATE', der);
  }
  throw new CertificateError(
    'No se pudo serializar un certificado del .p12 (tipo de certificado no soportado).',
  );
}

function pemEncode(label: string, der: Buffer): string {
  const base64 = der.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.slice(i, i + 64));
  }
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}
