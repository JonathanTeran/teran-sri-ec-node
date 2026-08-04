import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

import type { Document, Element } from '@xmldom/xmldom';

import { SignatureError } from '../errors/index.js';
import { canonicalize, parseXml, serializeDocument, stripIgnorableWhitespace } from './c14n.js';
import type { Certificate } from './certificate.js';
import { SystemClock, type Clock } from './clock.js';
import { parseCertificateFields } from './x509-der.js';

/**
 * Firma XAdES-BES para los comprobantes electrónicos del SRI de Ecuador.
 * Port línea a línea de `Teran\Sri\Signing\XadesSigner` (PHP), que es la
 * implementación en producción aceptada por el SRI: la estructura de nodos, el
 * orden, los ids, los algoritmos y la canonicalización se replican tal cual.
 *
 * Diferencias de plataforma documentadas (ninguna cambia el XML resultante):
 *  - PHP usa `DOMDocument` (libxml); aquí se usa `@xmldom/xmldom` como árbol y
 *    serializadores propios en `c14n.ts` que imitan a libxml (`saveXML` con
 *    `LIBXML_NOEMPTYTAG`, `preserveWhiteSpace = false`, `C14N()` inclusiva).
 *  - El sufijo aleatorio de los ids sale de `sha1(fechaFirma + certPem)`; como
 *    el PEM que produce node-forge usa CRLF y el de OpenSSL LF, el sufijo
 *    concreto difiere del que daría PHP con el mismo certificado y la misma
 *    hora. Es un identificador opaco: no afecta a la validez de la firma.
 */

// Espacios de nombres XML Signature / XAdES
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';
const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';
const NS_DSIG11 = 'http://www.w3.org/2009/xmldsig11#';
const NS_XMLNS = 'http://www.w3.org/2000/xmlns/';

// Canonicalización
const ALG_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
// Digest
const ALG_SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';
const ALG_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
// Firma RSA
const ALG_RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const ALG_RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
// Firma ECDSA
const ALG_ECDSA_SHA1 = 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha1';
const ALG_ECDSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256';
// Tipos XAdES
const ALG_ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const TYPE_SIGNED_PROPS = 'http://uri.etsi.org/01903#SignedProperties';

const DEFAULT_DESCRIPTION = 'Comprobante electrónico SRI Ecuador';

export type DigestAlgorithm = 'sha1' | 'sha256';

/** Port de `Teran\Sri\Signing\SignatureOptions`. */
export interface SignatureOptions {
  /** `sha1` por defecto: es lo que valida el SRI. */
  digestAlgorithm?: DigestAlgorithm;
  /** Contenido de `etsi:Description`. */
  description?: string;
}

interface CertificateData {
  /** Base64 del DER, sin cabeceras PEM ni saltos de línea. */
  cleanCert: string;
  /** Digest del DER del certificado, en base64. */
  certDigest: string;
  issuerName: string;
  serialNumber: string;
  keyType: 'RSA' | 'EC';
  modulus?: string;
  exponent?: string;
  curve?: string;
  publicKey?: string;
}

interface SignatureIds {
  signature: string;
  signatureValue: string;
  signedInfo: string;
  keyInfo: string;
  signedProperties: string;
  object: string;
  docRef: string;
  signedPropsRef: string;
  keyInfoRef: string;
}

export class XadesSigner {
  private readonly digestAlgorithm: DigestAlgorithm;
  private readonly description: string;
  private readonly clock: Clock;

  /** El parseo del certificado no cambia entre documentos: se memoiza. */
  private readonly certificateCache = new Map<string, CertificateData>();
  /** Igual con la clave privada ya parseada (evita re-parsear el PEM por firma). */
  private readonly privateKeyCache = new Map<string, KeyObject>();

  constructor(options: SignatureOptions = {}, clock: Clock = new SystemClock()) {
    const digestAlgorithm = (options.digestAlgorithm ?? 'sha1').toLowerCase();
    if (digestAlgorithm !== 'sha1' && digestAlgorithm !== 'sha256') {
      throw new SignatureError(
        `Algoritmo de digest no soportado: ${options.digestAlgorithm}. Use sha1 o sha256.`,
      );
    }
    this.digestAlgorithm = digestAlgorithm;
    this.description = options.description ?? DEFAULT_DESCRIPTION;
    this.clock = clock;
  }

  /** Firma el XML con XAdES-BES y devuelve el documento firmado completo. */
  sign(xmlContent: string, cert: Certificate): string {
    const doc = parseXml(xmlContent);
    stripIgnorableWhitespace(doc);

    const root = doc.documentElement;
    if (!root) {
      throw new SignatureError('El XML no tiene elemento raíz.');
    }

    // Id del comprobante referenciado por la firma.
    const docId = root.getAttribute('id') || 'comprobante';

    // El instante de firma se captura UNA vez: alimenta tanto el sufijo de los
    // ids como `etsi:SigningTime`, garantizando que ambos sean consistentes.
    const signingTime = this.clock.now();
    const signingTimeText = formatSigningTime(signingTime);
    const suffix = createHash('sha1')
      .update(signingTimeText + cert.certPem, 'utf8')
      .digest('hex')
      .slice(0, 6);

    const ids: SignatureIds = {
      signature: `Signature${suffix}`,
      signatureValue: `SignatureValue${suffix}`,
      signedInfo: `Signature-SignedInfo${suffix}`,
      keyInfo: `Certificate${suffix}`,
      signedProperties: `Signature${suffix}-SignedProperties${suffix}`,
      object: `Signature${suffix}-Object${suffix}`,
      docRef: `Reference-ID-${suffix}`,
      signedPropsRef: `SignedPropertiesID${suffix}`,
      keyInfoRef: `CertificateRef-${suffix}`,
    };

    const certInfo = this.certificateData(cert);
    const signatureAlgorithm = this.signatureAlgorithm(certInfo.keyType);
    const digestAlgorithmUri = this.digestAlgorithmUri();

    // 1. Nodo Signature (declara los prefijos ds/etsi para todo el subárbol).
    const signature = doc.createElementNS(NS_DS, 'ds:Signature');
    signature.setAttributeNS(NS_XMLNS, 'xmlns:ds', NS_DS);
    signature.setAttributeNS(NS_XMLNS, 'xmlns:etsi', NS_XADES);
    signature.setAttribute('Id', ids.signature);
    root.appendChild(signature);

    // 2. Estructura completa con placeholders.
    const signedInfo = doc.createElementNS(NS_DS, 'ds:SignedInfo');
    signedInfo.setAttribute('Id', ids.signedInfo);
    signature.appendChild(signedInfo);

    signedInfo.appendChild(algorithmNode(doc, 'ds:CanonicalizationMethod', ALG_C14N));
    signedInfo.appendChild(algorithmNode(doc, 'ds:SignatureMethod', signatureAlgorithm));

    // Referencia a SignedProperties (primera, igual que en PHP).
    const refProps = doc.createElementNS(NS_DS, 'ds:Reference');
    refProps.setAttribute('Id', ids.signedPropsRef);
    refProps.setAttribute('Type', TYPE_SIGNED_PROPS);
    refProps.setAttribute('URI', `#${ids.signedProperties}`);
    refProps.appendChild(algorithmNode(doc, 'ds:DigestMethod', digestAlgorithmUri));
    const signedPropsDigestNode = doc.createElementNS(NS_DS, 'ds:DigestValue');
    refProps.appendChild(signedPropsDigestNode);
    signedInfo.appendChild(refProps);

    // Referencia al comprobante, con la transformada enveloped-signature.
    const refDoc = doc.createElementNS(NS_DS, 'ds:Reference');
    refDoc.setAttribute('Id', ids.docRef);
    refDoc.setAttribute('URI', `#${docId}`);
    const transforms = doc.createElementNS(NS_DS, 'ds:Transforms');
    transforms.appendChild(algorithmNode(doc, 'ds:Transform', ALG_ENVELOPED));
    refDoc.appendChild(transforms);
    refDoc.appendChild(algorithmNode(doc, 'ds:DigestMethod', digestAlgorithmUri));
    const docDigestNode = doc.createElementNS(NS_DS, 'ds:DigestValue');
    refDoc.appendChild(docDigestNode);
    signedInfo.appendChild(refDoc);

    // SignatureValue (placeholder).
    const signatureValueNode = doc.createElementNS(NS_DS, 'ds:SignatureValue');
    signatureValueNode.setAttribute('Id', ids.signatureValue);
    signature.appendChild(signatureValueNode);

    // KeyInfo y Object/QualifyingProperties/SignedProperties.
    signature.appendChild(this.buildKeyInfo(doc, ids.keyInfo, certInfo, cert));

    const object = doc.createElementNS(NS_DS, 'ds:Object');
    object.setAttribute('Id', ids.object);
    signature.appendChild(object);

    const qualifyingProps = doc.createElementNS(NS_XADES, 'etsi:QualifyingProperties');
    qualifyingProps.setAttribute('Target', `#${ids.signature}`);
    object.appendChild(qualifyingProps);

    const signedProps = this.buildSignedProperties(
      doc,
      ids.signedProperties,
      ids.docRef,
      certInfo,
      signingTimeText,
    );
    qualifyingProps.appendChild(signedProps);

    // 3. FASE DE CÁLCULO.

    // A. Digest del comprobante: se desprende la firma (equivale a aplicar la
    //    transformada enveloped-signature) y se canonicaliza el documento.
    root.removeChild(signature);
    setText(doc, docDigestNode, this.digestBase64(Buffer.from(canonicalize(doc), 'utf8')));
    root.appendChild(signature);

    // B. Digest de SignedProperties (C14N inclusiva: hereda xmlns:ds/xmlns:etsi).
    setText(
      doc,
      signedPropsDigestNode,
      this.digestBase64(Buffer.from(canonicalize(signedProps), 'utf8')),
    );

    // C. SignatureValue sobre el SignedInfo canonicalizado.
    const signedInfoCanonical = Buffer.from(canonicalize(signedInfo), 'utf8');
    let rawSignature: Buffer;
    try {
      rawSignature = cryptoSign(this.digestAlgorithm, signedInfoCanonical, this.privateKey(cert));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new SignatureError(`Error al firmar el documento: ${detail}`);
    }
    setText(
      doc,
      signatureValueNode,
      chunkSplit(rawSignature.toString('base64'), 76, '\n').trim(),
    );

    return serializeDocument(doc);
  }

  /** Port de `XadesSigner::buildKeyInfo()`. */
  private buildKeyInfo(
    doc: Document,
    keyInfoId: string,
    certInfo: CertificateData,
    cert: Certificate,
  ): Element {
    const keyInfo = doc.createElementNS(NS_DS, 'ds:KeyInfo');
    keyInfo.setAttribute('Id', keyInfoId);

    const x509Data = doc.createElementNS(NS_DS, 'ds:X509Data');
    keyInfo.appendChild(x509Data);

    // 1. Certificado firmante, partido a 76 columnas.
    x509Data.appendChild(
      textElement(doc, NS_DS, 'ds:X509Certificate', chunkSplit(certInfo.cleanCert, 76, '\n').trim()),
    );

    // 2. Intermedias, si las hay. OJO: PHP NO recorta el salto final aquí
    //    (`chunk_split` sin `trim`); se replica el mismo byte a byte.
    for (const extraCert of cert.extraCerts) {
      const cleanExtra = cleanCertificate(extraCert);
      if (cleanExtra !== certInfo.cleanCert) {
        x509Data.appendChild(
          textElement(doc, NS_DS, 'ds:X509Certificate', chunkSplit(cleanExtra, 76, '\n')),
        );
      }
    }

    const keyValue = doc.createElementNS(NS_DS, 'ds:KeyValue');
    keyInfo.appendChild(keyValue);

    if (certInfo.keyType === 'RSA') {
      const rsaKeyValue = doc.createElementNS(NS_DS, 'ds:RSAKeyValue');
      keyValue.appendChild(rsaKeyValue);
      rsaKeyValue.appendChild(
        textElement(doc, NS_DS, 'ds:Modulus', chunkSplit(certInfo.modulus ?? '', 76, '\n').trim()),
      );
      rsaKeyValue.appendChild(textElement(doc, NS_DS, 'ds:Exponent', certInfo.exponent ?? ''));
    } else {
      // ECKeyValue vive en el espacio de nombres xmldsig11. libxml declara el
      // prefijo en el propio ECKeyValue (es el primer nodo de ese namespace
      // dentro del subárbol de KeyInfo): se replica.
      const ecKeyValue = doc.createElementNS(NS_DSIG11, 'dsig11:ECKeyValue');
      ecKeyValue.setAttributeNS(NS_XMLNS, 'xmlns:dsig11', NS_DSIG11);
      keyValue.appendChild(ecKeyValue);

      const curveName = certInfo.curve ?? '';
      if (curveName !== '') {
        const namedCurve = doc.createElementNS(NS_DSIG11, 'dsig11:NamedCurve');
        namedCurve.setAttribute('URI', curveUri(curveName));
        ecKeyValue.appendChild(namedCurve);
      }

      const publicKey = certInfo.publicKey ?? '';
      if (publicKey !== '') {
        ecKeyValue.appendChild(
          textElement(doc, NS_DSIG11, 'dsig11:PublicKey', chunkSplit(publicKey, 76, '\n')),
        );
      }
    }

    return keyInfo;
  }

  /** Port de `XadesSigner::buildSignedProperties()`. */
  private buildSignedProperties(
    doc: Document,
    signedPropsId: string,
    docRefId: string,
    certInfo: CertificateData,
    signingTimeText: string,
  ): Element {
    const signedProps = doc.createElementNS(NS_XADES, 'etsi:SignedProperties');
    signedProps.setAttribute('Id', signedPropsId);

    const signedSigProps = doc.createElementNS(NS_XADES, 'etsi:SignedSignatureProperties');
    signedProps.appendChild(signedSigProps);

    signedSigProps.appendChild(textElement(doc, NS_XADES, 'etsi:SigningTime', signingTimeText));

    const signingCert = doc.createElementNS(NS_XADES, 'etsi:SigningCertificate');
    signedSigProps.appendChild(signingCert);

    const certNode = doc.createElementNS(NS_XADES, 'etsi:Cert');
    signingCert.appendChild(certNode);

    const certDigestNode = doc.createElementNS(NS_XADES, 'etsi:CertDigest');
    certNode.appendChild(certDigestNode);

    // Los nodos `ds:` de aquí abajo se construyen en un subárbol que todavía no
    // cuelga de ds:Signature: libxml les añade su propio `xmlns:ds` y NO lo
    // elimina al insertarlos después. Se replica para mantener paridad de bytes
    // con PHP (la C14N los normaliza, así que el digest no cambia). El orden
    // importa: libxml serializa las declaraciones de namespace ANTES que los
    // atributos, así que `xmlns:ds` se añade primero.
    const digestMethod = doc.createElementNS(NS_DS, 'ds:DigestMethod');
    digestMethod.setAttributeNS(NS_XMLNS, 'xmlns:ds', NS_DS);
    digestMethod.setAttribute('Algorithm', this.digestAlgorithmUri());
    certDigestNode.appendChild(digestMethod);

    const digestValue = textElement(doc, NS_DS, 'ds:DigestValue', certInfo.certDigest);
    digestValue.setAttributeNS(NS_XMLNS, 'xmlns:ds', NS_DS);
    certDigestNode.appendChild(digestValue);

    const issuerSerial = doc.createElementNS(NS_XADES, 'etsi:IssuerSerial');
    certNode.appendChild(issuerSerial);

    const issuerName = textElement(doc, NS_DS, 'ds:X509IssuerName', certInfo.issuerName);
    issuerName.setAttributeNS(NS_XMLNS, 'xmlns:ds', NS_DS);
    issuerSerial.appendChild(issuerName);

    const serialNumber = textElement(doc, NS_DS, 'ds:X509SerialNumber', certInfo.serialNumber);
    serialNumber.setAttributeNS(NS_XMLNS, 'xmlns:ds', NS_DS);
    issuerSerial.appendChild(serialNumber);

    const signedDataObjProps = doc.createElementNS(NS_XADES, 'etsi:SignedDataObjectProperties');
    signedProps.appendChild(signedDataObjProps);

    const dataObjFormat = doc.createElementNS(NS_XADES, 'etsi:DataObjectFormat');
    dataObjFormat.setAttribute('ObjectReference', `#${docRefId}`);
    signedDataObjProps.appendChild(dataObjFormat);

    dataObjFormat.appendChild(textElement(doc, NS_XADES, 'etsi:Description', this.description));
    dataObjFormat.appendChild(textElement(doc, NS_XADES, 'etsi:MimeType', 'text/xml'));

    return signedProps;
  }

  /** Port de `XadesSigner::extractCertificateInfo()` (memoizado por PEM). */
  private certificateData(cert: Certificate): CertificateData {
    const cached = this.certificateCache.get(cert.certPem);
    if (cached) {
      return cached;
    }
    const computed = this.computeCertificateData(cert);
    this.certificateCache.set(cert.certPem, computed);
    return computed;
  }

  private computeCertificateData(cert: Certificate): CertificateData {
    const cleanCert = cleanCertificate(cert.certPem);
    if (cleanCert === '') {
      throw new SignatureError('No se pudo leer el certificado X.509');
    }

    const der = Buffer.from(cleanCert, 'base64');
    const fields = parseCertificateFields(cert.certPem);

    let publicKey;
    try {
      publicKey = createPublicKey(cert.certPem).export({ format: 'jwk' });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new SignatureError(
        `No se pudo extraer la clave pública del certificado: ${detail}`,
      );
    }

    const data: CertificateData = {
      cleanCert,
      certDigest: this.digestBase64(der),
      issuerName: fields.issuerRfc4514,
      serialNumber: fields.serialNumberDecimal,
      keyType: fields.keyType,
    };

    if (fields.keyType === 'RSA') {
      data.modulus = base64UrlToBase64(publicKey.n ?? '');
      data.exponent = base64UrlToBase64(publicKey.e ?? '');
    } else {
      data.curve = publicKey.crv ?? '';
      if (publicKey.x !== undefined && publicKey.y !== undefined) {
        // Punto sin comprimir: 04 || X || Y (igual que el PHP).
        const point = Buffer.concat([
          Buffer.from([0x04]),
          Buffer.from(publicKey.x, 'base64url'),
          Buffer.from(publicKey.y, 'base64url'),
        ]);
        data.publicKey = point.toString('base64');
      }
    }

    return data;
  }

  private privateKey(cert: Certificate): KeyObject {
    const cached = this.privateKeyCache.get(cert.privateKeyPem);
    if (cached) {
      return cached;
    }
    let key: KeyObject;
    try {
      // El PEM del .p12 llega en PKCS#1 (`BEGIN RSA PRIVATE KEY`);
      // `createPrivateKey` lo acepta sin conversión previa.
      key = createPrivateKey(cert.privateKeyPem);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new SignatureError(`No se pudo cargar la clave privada para firmar. (${detail})`);
    }
    this.privateKeyCache.set(cert.privateKeyPem, key);
    return key;
  }

  private signatureAlgorithm(keyType: 'RSA' | 'EC'): string {
    if (keyType === 'EC') {
      return this.digestAlgorithm === 'sha256' ? ALG_ECDSA_SHA256 : ALG_ECDSA_SHA1;
    }
    return this.digestAlgorithm === 'sha256' ? ALG_RSA_SHA256 : ALG_RSA_SHA1;
  }

  private digestAlgorithmUri(): string {
    return this.digestAlgorithm === 'sha256' ? ALG_SHA256 : ALG_SHA1;
  }

  private digestBase64(content: Buffer): string {
    return createHash(this.digestAlgorithm).update(content).digest('base64');
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function algorithmNode(doc: Document, name: string, algorithm: string): Element {
  const node = doc.createElementNS(NS_DS, name);
  node.setAttribute('Algorithm', algorithm);
  return node;
}

function textElement(doc: Document, ns: string, name: string, text: string): Element {
  const element = doc.createElementNS(ns, name);
  if (text !== '') {
    element.appendChild(doc.createTextNode(text));
  }
  return element;
}

function setText(doc: Document, element: Element, text: string): void {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  element.appendChild(doc.createTextNode(text));
}

/** Deja solo el base64 del PEM (port de `XadesSigner::cleanCertificate()`). */
function cleanCertificate(cert: string): string {
  return cert
    .split('-----BEGIN CERTIFICATE-----')
    .join('')
    .split('-----END CERTIFICATE-----')
    .join('')
    .replace(/[\n\r ]/g, '');
}

/** Port de `chunk_split()` de PHP: trocea e intercala el separador (también al final). */
function chunkSplit(value: string, length: number, separator: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += length) {
    out += value.slice(i, i + length) + separator;
  }
  return out;
}

function base64UrlToBase64(value: string): string {
  return Buffer.from(value, 'base64url').toString('base64');
}

/**
 * Formatea la fecha como el `'Y-m-d\TH:i:sP'` de PHP: fecha local del proceso
 * con el offset de su zona horaria (`-05:00` en Ecuador).
 */
function formatSigningTime(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new SignatureError('El reloj devolvió una fecha inválida.');
  }
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);

  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

/** Port de `XadesSigner::getCurveUri()`, con los nombres de curva de JWK. */
function curveUri(curveName: string): string {
  const curves: Record<string, string> = {
    'P-256': 'urn:oid:1.2.840.10045.3.1.7',
    prime256v1: 'urn:oid:1.2.840.10045.3.1.7',
    secp256r1: 'urn:oid:1.2.840.10045.3.1.7',
    'P-384': 'urn:oid:1.3.132.0.34',
    secp384r1: 'urn:oid:1.3.132.0.34',
    'P-521': 'urn:oid:1.3.132.0.35',
    secp521r1: 'urn:oid:1.3.132.0.35',
  };
  return curves[curveName] ?? `urn:oid:${curveName}`;
}
