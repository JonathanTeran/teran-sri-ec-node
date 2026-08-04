// El formato de `etsi:SigningTime` ('Y-m-d\TH:i:sP' en PHP) lleva el offset de
// la zona horaria LOCAL del proceso, igual que `DateTimeImmutable` en PHP. Se
// fija a la zona del SRI (Ecuador, UTC-5 todo el año) para que el fixture
// generado por PHP y la salida de TS sean comparables byte a byte.
process.env['TZ'] = 'America/Guayaquil';

import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Element } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';

import { SignatureError } from '../src/errors/index.js';
import { canonicalize, parseXml } from '../src/signing/c14n.js';
import type { Certificate } from '../src/signing/certificate.js';
import { certificateInfo, loadCertificate } from '../src/signing/certificate.js';
import { SystemClock, type Clock } from '../src/signing/clock.js';
import { XadesSigner } from '../src/signing/xades-signer.js';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const PASSWORD = 'test1234';
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';
const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';

/** Mismo instante que usa `scripts/gen-signed-fixture.php`. */
const FIXED_INSTANT = '2026-08-03T12:34:56-05:00';

function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

function fixtureBytes(name: string): Uint8Array {
  return readFileSync(join(FIXTURES_DIR, name));
}

class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}
  now(): Date {
    return new Date(this.instant.getTime());
  }
}

function testCertificate(): Certificate {
  return loadCertificate(fixtureBytes('test-cert.p12'), PASSWORD);
}

function fixedSigner(options?: ConstructorParameters<typeof XadesSigner>[0]): XadesSigner {
  return new XadesSigner(options, new FixedClock(new Date(FIXED_INSTANT)));
}

function signFactura(options?: ConstructorParameters<typeof XadesSigner>[0]): string {
  return fixedSigner(options).sign(fixtureText('factura.xml'), testCertificate());
}

/** Sufijo aleatorio de los ids de la firma (`Id="Signature<sufijo>"`). */
function signatureSuffix(signedXml: string): string {
  const match = /Id="Signature([0-9a-f]{6})"/.exec(signedXml);
  if (!match) {
    throw new Error('No se encontró el Id de ds:Signature en el XML firmado.');
  }
  return match[1]!;
}

function elements(xml: string, ns: string, localName: string): Element[] {
  const doc = parseXml(xml);
  return Array.from(
    doc.getElementsByTagNameNS(ns, localName) as unknown as ArrayLike<Element>,
  );
}

function textOf(xml: string, ns: string, localName: string): string {
  const [el] = elements(xml, ns, localName);
  if (!el) {
    throw new Error(`No se encontró <${localName}> en el XML firmado.`);
  }
  return el.textContent ?? '';
}

describe('XadesSigner — estructura del XAdES-BES', () => {
  it('inserta <ds:Signature> justo antes del cierre de la raíz', () => {
    const signed = signFactura();

    expect(signed.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<factura ')).toBe(true);
    expect(signed.endsWith('</ds:Signature></factura>\n')).toBe(true);
  });

  it('funciona con cualquiera de las 6 raíces (comprobanteRetencion)', () => {
    const signed = fixedSigner().sign(fixtureText('retencion.xml'), testCertificate());

    expect(signed.endsWith('</ds:Signature></comprobanteRetencion>\n')).toBe(true);
    expect(elements(signed, NS_DS, 'Reference')[1]?.getAttribute('URI')).toBe('#comprobante');
  });

  // OJO: el plan hablaba de TRES ds:Reference (#comprobante, #SignedProperties,
  // #Certificate). El `XadesSigner.php` — fuente de verdad, en producción con el
  // SRI — emite solo DOS: SignedProperties y el comprobante. El `ds:KeyInfo`
  // lleva Id="Certificate<sufijo>" pero NO está referenciado desde SignedInfo.
  // Se porta el PHP tal cual.
  it('emite exactamente 2 ds:Reference (SignedProperties y #comprobante), igual que el PHP', () => {
    const signed = signFactura();
    const suffix = signatureSuffix(signed);
    const refs = elements(signed, NS_DS, 'Reference');

    expect(refs).toHaveLength(2);
    expect(refs[0]!.getAttribute('URI')).toBe(`#Signature${suffix}-SignedProperties${suffix}`);
    expect(refs[0]!.getAttribute('Id')).toBe(`SignedPropertiesID${suffix}`);
    expect(refs[0]!.getAttribute('Type')).toBe('http://uri.etsi.org/01903#SignedProperties');
    expect(refs[1]!.getAttribute('URI')).toBe('#comprobante');
    expect(refs[1]!.getAttribute('Id')).toBe(`Reference-ID-${suffix}`);
  });

  it('solo la referencia al comprobante lleva la transformada enveloped-signature', () => {
    const signed = signFactura();
    const refs = elements(signed, NS_DS, 'Reference');

    expect(refs[0]!.getElementsByTagNameNS(NS_DS, 'Transforms')).toHaveLength(0);
    const transforms = refs[1]!.getElementsByTagNameNS(NS_DS, 'Transform');
    expect(transforms).toHaveLength(1);
    expect(transforms[0]!.getAttribute('Algorithm')).toBe(
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
    );
  });

  it('el ds:KeyInfo lleva Id="Certificate<sufijo>" con X509Certificate y RSAKeyValue', () => {
    const signed = signFactura();
    const suffix = signatureSuffix(signed);
    const [keyInfo] = elements(signed, NS_DS, 'KeyInfo');

    expect(keyInfo!.getAttribute('Id')).toBe(`Certificate${suffix}`);
    expect(elements(signed, NS_DS, 'X509Certificate')).toHaveLength(1);
    expect(elements(signed, NS_DS, 'RSAKeyValue')).toHaveLength(1);
    expect(textOf(signed, NS_DS, 'Exponent')).toBe('AQAB');
    // Modulus y certificado en base64 partido a 76 columnas (chunk_split de PHP).
    const modulus = textOf(signed, NS_DS, 'Modulus');
    expect(modulus.split('\n').every((line) => line.length <= 76)).toBe(true);
    expect(modulus.endsWith('\n')).toBe(false);
  });

  it('todos los ids derivan del mismo sufijo de 6 hex', () => {
    const signed = signFactura();
    const suffix = signatureSuffix(signed);

    expect(suffix).toMatch(/^[0-9a-f]{6}$/);
    expect(signed).toContain(`Id="Signature-SignedInfo${suffix}"`);
    expect(signed).toContain(`Id="SignatureValue${suffix}"`);
    expect(signed).toContain(`Id="Signature${suffix}-Object${suffix}"`);
    expect(signed).toContain(`Id="Signature${suffix}-SignedProperties${suffix}"`);
    expect(signed).toContain(`Target="#Signature${suffix}"`);
    expect(signed).toContain(`ObjectReference="#Reference-ID-${suffix}"`);
  });

  it('el sufijo cambia con el instante de firma (ids no colisionan entre firmas)', () => {
    const cert = testCertificate();
    const a = new XadesSigner(undefined, new FixedClock(new Date(FIXED_INSTANT))).sign(
      fixtureText('factura.xml'),
      cert,
    );
    const b = new XadesSigner(
      undefined,
      new FixedClock(new Date('2026-08-03T12:34:57-05:00')),
    ).sign(fixtureText('factura.xml'), cert);

    expect(signatureSuffix(a)).not.toBe(signatureSuffix(b));
  });

  it('etsi:SigningTime es el instante del Clock inyectado, con offset local', () => {
    const signed = signFactura();

    expect(textOf(signed, NS_XADES, 'SigningTime')).toBe(FIXED_INSTANT);
  });

  it('etsi:Description por defecto es "Comprobante electrónico SRI Ecuador"', () => {
    const signed = signFactura();

    expect(textOf(signed, NS_XADES, 'Description')).toBe('Comprobante electrónico SRI Ecuador');
    expect(textOf(signed, NS_XADES, 'MimeType')).toBe('text/xml');
  });

  it('etsi:Description es configurable por SignatureOptions', () => {
    const signed = signFactura({ description: 'Factura de ACME S.A.' });

    expect(textOf(signed, NS_XADES, 'Description')).toBe('Factura de ACME S.A.');
  });

  it('IssuerSerial usa el DN RFC 2253 y el serial decimal del certificado', () => {
    const cert = testCertificate();
    const info = certificateInfo(cert);
    const signed = fixedSigner().sign(fixtureText('factura.xml'), cert);

    expect(textOf(signed, NS_DS, 'X509IssuerName')).toBe(info.issuerRfc4514);
    expect(textOf(signed, NS_DS, 'X509SerialNumber')).toBe(info.serialNumberDecimal);
  });

  it('el CertDigest es el hash del DER del certificado', () => {
    const cert = testCertificate();
    const signed = fixedSigner().sign(fixtureText('factura.xml'), cert);
    const der = Buffer.from(
      cert.certPem.replace(/-----[^-]+-----|\s+/g, ''),
      'base64',
    );

    const certDigest = elements(signed, NS_XADES, 'CertDigest')[0]!
      .getElementsByTagNameNS(NS_DS, 'DigestValue')[0]!.textContent;
    expect(certDigest).toBe(createHash('sha1').update(der).digest('base64'));
  });

  it('por defecto usa RSA-SHA1 y SHA1 como digest (lo que exige el SRI)', () => {
    const signed = signFactura();

    expect(elements(signed, NS_DS, 'SignatureMethod')[0]!.getAttribute('Algorithm')).toBe(
      'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    );
    expect(elements(signed, NS_DS, 'CanonicalizationMethod')[0]!.getAttribute('Algorithm')).toBe(
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    );
    for (const method of elements(signed, NS_DS, 'DigestMethod')) {
      expect(method.getAttribute('Algorithm')).toBe('http://www.w3.org/2000/09/xmldsig#sha1');
    }
  });

  it('digestAlgorithm "sha256" cambia los URIs de firma y digest', () => {
    const signed = signFactura({ digestAlgorithm: 'sha256' });

    expect(elements(signed, NS_DS, 'SignatureMethod')[0]!.getAttribute('Algorithm')).toBe(
      'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    );
    for (const method of elements(signed, NS_DS, 'DigestMethod')) {
      expect(method.getAttribute('Algorithm')).toBe('http://www.w3.org/2001/04/xmlenc#sha256');
    }
  });

  it('rechaza un algoritmo de digest no soportado', () => {
    expect(
      () => new XadesSigner({ digestAlgorithm: 'md5' as unknown as 'sha1' }),
    ).toThrow(SignatureError);
  });

  it('lanza SignatureError si el XML no es válido', () => {
    expect(() => fixedSigner().sign('<factura><a></factura>', testCertificate())).toThrow(
      SignatureError,
    );
  });

  it('SystemClock devuelve la hora actual', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe('XadesSigner — verificación criptográfica', () => {
  it('el .p12 entrega la clave en PKCS#1 y node:crypto la usa sin conversión', () => {
    const cert = testCertificate();

    expect(cert.privateKeyPem).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/);
    expect(() => fixedSigner().sign(fixtureText('factura.xml'), cert)).not.toThrow();
  });

  it('el SignatureValue verifica contra la clave pública del certificado', () => {
    const cert = testCertificate();
    const signed = fixedSigner().sign(fixtureText('factura.xml'), cert);

    // Se re-parsea el XML EMITIDO y se canonicaliza el SignedInfo tal cual
    // quedó serializado: prueba que los bytes firmados son recuperables desde
    // la salida (que es lo que hará el validador del SRI).
    const doc = parseXml(signed);
    const signedInfo = doc.getElementsByTagNameNS(NS_DS, 'SignedInfo')[0]!;
    const canonical = canonicalize(signedInfo);

    const verifier = createVerify('sha1');
    verifier.update(Buffer.from(canonical, 'utf8'));
    const signatureValue = Buffer.from(
      textOf(signed, NS_DS, 'SignatureValue').replace(/\s+/g, ''),
      'base64',
    );

    expect(verifier.verify(cert.certPem, signatureValue)).toBe(true);
  });

  it('el SignedInfo canonicalizado hereda los xmlns de ds:Signature', () => {
    const signed = fixedSigner().sign(fixtureText('factura.xml'), testCertificate());
    const doc = parseXml(signed);
    const canonical = canonicalize(doc.getElementsByTagNameNS(NS_DS, 'SignedInfo')[0]!);

    expect(canonical.startsWith(`<ds:SignedInfo xmlns:ds="${NS_DS}" xmlns:etsi="${NS_XADES}" Id=`)).toBe(
      true,
    );
  });

  it('el digest de la referencia #comprobante es recomputable (transformada enveloped)', () => {
    const signed = fixedSigner().sign(fixtureText('factura.xml'), testCertificate());
    const doc = parseXml(signed);
    const signature = doc.getElementsByTagNameNS(NS_DS, 'Signature')[0]!;
    signature.parentNode!.removeChild(signature);

    const recomputed = createHash('sha1').update(canonicalize(doc), 'utf8').digest('base64');
    const declared = elements(signed, NS_DS, 'Reference')[1]!
      .getElementsByTagNameNS(NS_DS, 'DigestValue')[0]!.textContent;

    expect(recomputed).toBe(declared);
  });

  it('el digest de SignedProperties es recomputable', () => {
    const signed = fixedSigner().sign(fixtureText('factura.xml'), testCertificate());
    const doc = parseXml(signed);
    const signedProps = doc.getElementsByTagNameNS(NS_XADES, 'SignedProperties')[0]!;

    const recomputed = createHash('sha1')
      .update(canonicalize(signedProps), 'utf8')
      .digest('base64');
    const declared = elements(signed, NS_DS, 'Reference')[0]!
      .getElementsByTagNameNS(NS_DS, 'DigestValue')[0]!.textContent;

    expect(recomputed).toBe(declared);
  });

  it('con digestAlgorithm sha256 la firma también verifica', () => {
    const cert = testCertificate();
    const signed = fixedSigner({ digestAlgorithm: 'sha256' }).sign(
      fixtureText('factura.xml'),
      cert,
    );
    const doc = parseXml(signed);
    const canonical = canonicalize(doc.getElementsByTagNameNS(NS_DS, 'SignedInfo')[0]!);

    const verifier = createVerify('sha256');
    verifier.update(Buffer.from(canonical, 'utf8'));

    expect(
      verifier.verify(
        cert.certPem,
        Buffer.from(textOf(signed, NS_DS, 'SignatureValue').replace(/\s+/g, ''), 'base64'),
      ),
    ).toBe(true);
  });
});

/**
 * Paridad con el firmador PHP (`test/fixtures/factura-signed-php.xml`, generado
 * por `scripts/gen-signed-fixture.php` con el MISMO .p12 y el MISMO reloj fijo).
 *
 * El único valor que no puede coincidir es el sufijo aleatorio de los ids:
 * se deriva de `sha1(fechaFirma . certPem)` y el `certPem` de node-forge usa
 * CRLF mientras que el de OpenSSL/PHP usa LF. Normalizando ese sufijo, todo lo
 * demás debe ser idéntico byte a byte salvo los dos valores que dependen de él:
 * el digest de SignedProperties (los ids van dentro del contenido firmado) y,
 * por lo tanto, el SignatureValue.
 */
describe('XadesSigner — paridad con el firmador PHP', () => {
  function normalize(signedXml: string): string {
    const normalized = signedXml.split(signatureSuffix(signedXml)).join('{SUFFIX}');
    return normalized
      .replace(
        /(<ds:SignatureValue Id="SignatureValue\{SUFFIX\}">)[\s\S]*?(<\/ds:SignatureValue>)/,
        '$1{SIGNATURE-VALUE}$2',
      )
      .replace(
        /(<ds:Reference Id="SignedPropertiesID\{SUFFIX\}"[\s\S]*?<ds:DigestValue>)[^<]*(<\/ds:DigestValue>)/,
        '$1{SIGNED-PROPS-DIGEST}$2',
      );
  }

  function digestOfComprobante(xml: string): string {
    return elements(xml, NS_DS, 'Reference')[1]!.getElementsByTagNameNS(NS_DS, 'DigestValue')[0]!
      .textContent!;
  }

  // - `c14n-edge-cases.xml` ejercita lo que puede desviarse entre libxml y una
  //   implementación propia: entidades, comillas y `>` en atributos,
  //   normalización de tabuladores en valores de atributo, CDATA, comentarios,
  //   elementos vacíos/autocerrados, contenido mixto, `xml:space="preserve"` y
  //   texto solo-espacios.
  // - `factura-xml-lang.xml` lleva `xml:lang`/`xml:base` en la raíz: obliga a
  //   que la C14N de un SUBÁRBOL herede los atributos `xml:*` de los ancestros
  //   que quedan fuera del node-set (C14N 1.0 §2.2).
  for (const [unsigned, phpFixture] of [
    ['factura.xml', 'factura-signed-php.xml'],
    ['c14n-edge-cases.xml', 'c14n-edge-cases-signed-php.xml'],
    ['factura-xml-lang.xml', 'factura-xml-lang-signed-php.xml'],
  ] as const) {
    it(`el digest del comprobante de ${unsigned} coincide con el de PHP (C14N idéntica a libxml)`, () => {
      const signed = fixedSigner().sign(fixtureText(unsigned), testCertificate());

      expect(digestOfComprobante(signed)).toBe(digestOfComprobante(fixtureText(phpFixture)));
    });

    it(`la salida de ${unsigned} es byte a byte igual a la de PHP salvo el sufijo y lo que depende de él`, () => {
      const signed = fixedSigner().sign(fixtureText(unsigned), testCertificate());

      expect(normalize(signed)).toBe(normalize(fixtureText(phpFixture)));
    });

    // ORÁCULO EXTERNO. Los dos tests anteriores comparan la C14N del DOCUMENTO
    // completo; estos dos fijan la C14N de SUBÁRBOL contra libxml+OpenSSL: si
    // `canonicalize()` produjera un solo byte distinto del que canonicalizó
    // libxml, ni la firma de PHP verificaría ni el digest coincidiría. Es la
    // única forma de detectar un fallo de canonicalización que sea
    // "consistente consigo mismo" (firmar y verificar con la misma función
    // errónea siempre cuadra).
    it(`la C14N de TS reproduce el ds:SignedInfo que firmó PHP en ${phpFixture}`, () => {
      const php = fixtureText(phpFixture);
      const doc = parseXml(php);
      const canonical = canonicalize(doc.getElementsByTagNameNS(NS_DS, 'SignedInfo')[0]!);

      const verifier = createVerify('sha1');
      verifier.update(Buffer.from(canonical, 'utf8'));

      expect(
        verifier.verify(
          testCertificate().certPem,
          Buffer.from(textOf(php, NS_DS, 'SignatureValue').replace(/\s+/g, ''), 'base64'),
        ),
      ).toBe(true);
    });

    it(`la C14N de TS recomputa el digest de etsi:SignedProperties de ${phpFixture}`, () => {
      const php = fixtureText(phpFixture);
      const doc = parseXml(php);
      const signedProps = doc.getElementsByTagNameNS(NS_XADES, 'SignedProperties')[0]!;

      const recomputed = createHash('sha1')
        .update(canonicalize(signedProps), 'utf8')
        .digest('base64');

      expect(recomputed).toBe(
        elements(php, NS_DS, 'Reference')[0]!.getElementsByTagNameNS(NS_DS, 'DigestValue')[0]!
          .textContent,
      );
    });
  }

  it('con xml:lang/xml:base en la raíz, la firma de TS sigue cerrando (round-trip)', () => {
    const cert = testCertificate();
    const signed = fixedSigner().sign(fixtureText('factura-xml-lang.xml'), cert);
    const doc = parseXml(signed);

    const verifier = createVerify('sha1');
    verifier.update(
      Buffer.from(canonicalize(doc.getElementsByTagNameNS(NS_DS, 'SignedInfo')[0]!), 'utf8'),
    );
    expect(
      verifier.verify(
        cert.certPem,
        Buffer.from(textOf(signed, NS_DS, 'SignatureValue').replace(/\s+/g, ''), 'base64'),
      ),
    ).toBe(true);

    const signedProps = doc.getElementsByTagNameNS(NS_XADES, 'SignedProperties')[0]!;
    expect(createHash('sha1').update(canonicalize(signedProps), 'utf8').digest('base64')).toBe(
      elements(signed, NS_DS, 'Reference')[0]!.getElementsByTagNameNS(NS_DS, 'DigestValue')[0]!
        .textContent,
    );
  });

  it('una misma instancia de XadesSigner puede firmar varios documentos (cachés de cert/clave)', () => {
    const signer = fixedSigner();
    const cert = testCertificate();

    const first = signer.sign(fixtureText('factura.xml'), cert);
    const second = signer.sign(fixtureText('factura.xml'), cert);
    const other = signer.sign(fixtureText('nota-credito.xml'), cert);

    expect(second).toBe(first);
    expect(other.endsWith('</ds:Signature></notaCredito>\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cachés internos: acotados y sin material sensible como clave
// ---------------------------------------------------------------------------

/** Vista de solo lectura de un caché interno del firmador, para inspeccionarlo desde el test. */
interface CacheProbe {
  size: number;
  keys(): string[];
}

function cachesOf(signer: XadesSigner): { privateKeyCache: CacheProbe; certificateCache: CacheProbe } {
  return signer as unknown as { privateKeyCache: CacheProbe; certificateCache: CacheProbe };
}

/**
 * Claves privadas EC distintas (rápidas de generar, a diferencia de RSA):
 * el certificado que las acompaña es el real del fixture, porque al firmador
 * solo le interesa que `certPem` sea parseable — lo que se está ejercitando
 * aquí es el caché de claves privadas, no la coherencia cert↔clave.
 */
function certificadosConClavesDistintas(n: number): Certificate[] {
  const { certPem } = testCertificate();
  return Array.from({ length: n }, () => ({
    certPem,
    privateKeyPem: generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey,
    extraCerts: [],
  }));
}

describe('XadesSigner — cachés internos', () => {
  it('firmar con más certificados que la capacidad deja el caché acotado (LRU)', () => {
    const signer = fixedSigner();
    const xml = fixtureText('factura.xml');
    const certificados = certificadosConClavesDistintas(40);

    for (const cert of certificados) {
      signer.sign(xml, cert);
    }

    const { privateKeyCache } = cachesOf(signer);
    expect(privateKeyCache.size).toBe(32);
    expect(privateKeyCache.size).toBeLessThan(certificados.length);
  });

  it('ninguna clave del caché contiene material del PEM (son digests SHA-256)', () => {
    const signer = fixedSigner();
    const xml = fixtureText('factura.xml');

    for (const cert of certificadosConClavesDistintas(5)) {
      signer.sign(xml, cert);
    }

    const { privateKeyCache, certificateCache } = cachesOf(signer);
    const todas = [...privateKeyCache.keys(), ...certificateCache.keys()];

    expect(todas.length).toBeGreaterThan(0);
    for (const key of todas) {
      expect(key).not.toContain('PRIVATE KEY');
      expect(key).not.toContain('BEGIN');
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('el mismo certificado no ocupa entradas nuevas por firma (memoización efectiva)', () => {
    const signer = fixedSigner();
    const cert = testCertificate();

    for (let i = 0; i < 10; i++) {
      signer.sign(fixtureText('factura.xml'), cert);
    }

    const { privateKeyCache, certificateCache } = cachesOf(signer);
    expect(privateKeyCache.size).toBe(1);
    expect(certificateCache.size).toBe(1);
  });
});
