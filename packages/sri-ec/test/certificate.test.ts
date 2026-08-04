import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import forge from 'node-forge';
import { describe, expect, it } from 'vitest';

import { CertificateError } from '../src/errors/index.js';
import type { Certificate } from '../src/signing/certificate.js';
import { certificateInfo, loadCertificate, selectCredential } from '../src/signing/certificate.js';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const PASSWORD = 'test1234';

function fixture(name: string): Uint8Array {
  return readFileSync(join(FIXTURES_DIR, name));
}

/**
 * `openssl x509 -serial`, convertido a decimal, sobre un PEM ya extraído:
 * ground truth independiente para verificar `serialNumberDecimal`.
 */
function opensslSerialDecimal(certPem: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sri-ec-cert-test-'));
  try {
    const pemPath = join(dir, 'cert.pem');
    writeFileSync(pemPath, certPem);
    const output = execFileSync('openssl', ['x509', '-in', pemPath, '-noout', '-serial'], {
      encoding: 'utf8',
    });
    const match = /serial=([0-9a-fA-F]+)/.exec(output);
    if (!match) {
      throw new Error(`No se pudo extraer el serial de la salida de openssl: ${output}`);
    }
    return BigInt(`0x${match[1]}`).toString(10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('loadCertificate', () => {
  it('carga un .p12 moderno (AES-256-CBC/PBKDF2) y produce PEMs válidos', () => {
    const cert: Certificate = loadCertificate(fixture('test-cert.p12'), PASSWORD);

    expect(cert.certPem.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
    expect(cert.certPem.trim().endsWith('-----END CERTIFICATE-----')).toBe(true);
    expect(cert.privateKeyPem).toMatch(/-----BEGIN (RSA )?PRIVATE KEY-----/);
    expect(cert.extraCerts).toEqual([]);
  });

  it('carga un .p12 legacy (RC2-40/3DES vía -legacy) y produce PEMs válidos', () => {
    const cert = loadCertificate(fixture('test-cert-legacy.p12'), PASSWORD);

    expect(cert.certPem.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
    expect(cert.privateKeyPem).toMatch(/-----BEGIN (RSA )?PRIVATE KEY-----/);
  });

  it('el .p12 moderno y el legacy contienen el mismo certificado', () => {
    const modern = loadCertificate(fixture('test-cert.p12'), PASSWORD);
    const legacy = loadCertificate(fixture('test-cert-legacy.p12'), PASSWORD);

    expect(certificateInfo(modern).serialNumberDecimal).toBe(
      certificateInfo(legacy).serialNumberDecimal,
    );
  });

  it('lanza CertificateError con contraseña incorrecta (.p12 moderno)', () => {
    expect(() => loadCertificate(fixture('test-cert.p12'), 'contraseña-incorrecta')).toThrow(
      CertificateError,
    );
  });

  it('lanza CertificateError con contraseña incorrecta (.p12 legacy)', () => {
    expect(() =>
      loadCertificate(fixture('test-cert-legacy.p12'), 'contraseña-incorrecta'),
    ).toThrow(CertificateError);
  });

  it('el mensaje de CertificateError es claro sobre contraseña/archivo', () => {
    expect.assertions(2);
    try {
      loadCertificate(fixture('test-cert.p12'), 'mala-contraseña');
    } catch (err) {
      expect(err).toBeInstanceOf(CertificateError);
      expect((err as Error).message).toMatch(/contraseña/i);
    }
  });

  it('lanza CertificateError con datos que no son un .p12 en absoluto', () => {
    expect(() => loadCertificate(new Uint8Array([1, 2, 3, 4]), PASSWORD)).toThrow(
      CertificateError,
    );
  });
});

describe('certificateInfo', () => {
  it('serialNumberDecimal coincide con `openssl x509 -serial` (.p12 moderno)', () => {
    const cert = loadCertificate(fixture('test-cert.p12'), PASSWORD);
    const info = certificateInfo(cert);

    expect(info.serialNumberDecimal).toMatch(/^[0-9]+$/);
    expect(info.serialNumberDecimal).toBe(opensslSerialDecimal(cert.certPem));
  });

  it('serialNumberDecimal coincide con `openssl x509 -serial` (.p12 legacy)', () => {
    const cert = loadCertificate(fixture('test-cert-legacy.p12'), PASSWORD);
    const info = certificateInfo(cert);

    expect(info.serialNumberDecimal).toBe(opensslSerialDecimal(cert.certPem));
  });

  it('issuerRfc4514 sigue el formato RFC 2253 (orden inverso al de -subj)', () => {
    // Fixture generado con -subj "/C=EC/O=Amephia Test/CN=sri-ec-test"
    // (ver scripts/gen-test-p12.sh). RFC 2253 emite las RDN en orden
    // INVERSO al de la codificación DER, que a su vez sigue el orden dado
    // a -subj: C, O, CN -> invertido: CN, O, C.
    const cert = loadCertificate(fixture('test-cert.p12'), PASSWORD);
    const info = certificateInfo(cert);

    expect(info.issuerRfc4514).toBe('CN=sri-ec-test,O=Amephia Test,C=EC');
  });

  it('notAfter es una fecha (10 años de validez, en el futuro)', () => {
    const cert = loadCertificate(fixture('test-cert.p12'), PASSWORD);
    const info = certificateInfo(cert);

    expect(info.notAfter).toBeInstanceOf(Date);
    expect(info.notAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it('keyType es RSA para el certificado de prueba (RSA 2048)', () => {
    const cert = loadCertificate(fixture('test-cert.p12'), PASSWORD);
    const info = certificateInfo(cert);

    expect(info.keyType).toBe('RSA');
  });
});

/**
 * Bags de PKCS#12 sintéticos (no requieren un .p12 real) para poder testear
 * la heurística de selección de credencial de forma aislada: generar un
 * .p12 con MÚLTIPLES pares cert/key es difícil con la CLI de `openssl`
 * (`pkcs12 -export` solo acepta un `-inkey`/`-in` por invocación). Solo
 * necesitan exponer los campos que `selectCredential` realmente lee
 * (`type`, `attributes`, `key`, `cert.publicKey.n`, `cert.getExtension`).
 */
type FakeBag = forge.pkcs12.Bag;

function makeKeyBag(opts: {
  localKeyId?: string;
  friendlyName?: string;
  key?: unknown;
}): FakeBag {
  return {
    type: 'keyBag-fake',
    attributes: {
      ...(opts.localKeyId !== undefined ? { localKeyId: [opts.localKeyId] } : {}),
      ...(opts.friendlyName !== undefined ? { friendlyName: [opts.friendlyName] } : {}),
    },
    key: opts.key ?? { n: { toString: () => 'modulus' } },
  } as unknown as FakeBag;
}

function makeCertBag(opts: {
  localKeyId?: string;
  friendlyName?: string;
  signingKeyUsage?: boolean;
  publicKeyN?: string;
}): FakeBag {
  return {
    type: 'certBag-fake',
    attributes: {
      ...(opts.localKeyId !== undefined ? { localKeyId: [opts.localKeyId] } : {}),
      ...(opts.friendlyName !== undefined ? { friendlyName: [opts.friendlyName] } : {}),
    },
    cert: {
      publicKey: { n: { toString: () => opts.publicKeyN ?? 'modulus' } },
      getExtension: (name: string) =>
        name === 'keyUsage' && opts.signingKeyUsage
          ? { digitalSignature: true, nonRepudiation: true }
          : undefined,
    },
  } as unknown as FakeBag;
}

describe('selectCredential (heurística de selección, portada de CertificateLoader.php)', () => {
  it('con una sola clave y un solo certificado, los toma directamente', () => {
    const keyBag = makeKeyBag({ localKeyId: 'aa' });
    const certBag = makeCertBag({ localKeyId: 'aa' });

    const result = selectCredential([keyBag], [certBag]);

    expect(result.keyBag).toBe(keyBag);
    expect(result.certBag).toBe(certBag);
    expect(result.extraCertBags).toEqual([]);
  });

  it('con una sola clave y varios certificados, empareja por localKeyId y el resto va a extraCerts', () => {
    const keyBag = makeKeyBag({ localKeyId: 'aa' });
    const matching = makeCertBag({ localKeyId: 'aa' });
    const ca = makeCertBag({ localKeyId: 'bb' });

    const result = selectCredential([keyBag], [ca, matching]);

    expect(result.certBag).toBe(matching);
    expect(result.extraCertBags).toEqual([ca]);
  });

  it('sin localKeyId, empareja por coincidencia de módulo RSA', () => {
    const keyBag = makeKeyBag({ key: { n: { toString: () => 'deadbeef' } } });
    const wrong = makeCertBag({ publicKeyN: 'otromodulo' });
    const right = makeCertBag({ publicKeyN: 'deadbeef' });

    const result = selectCredential([keyBag], [wrong, right]);

    expect(result.certBag).toBe(right);
  });

  it('con varias claves, prefiere la que tiene keyUsage de firma en su certificado', () => {
    const keyA = makeKeyBag({ localKeyId: 'aa' });
    const certA = makeCertBag({ localKeyId: 'aa', signingKeyUsage: false });
    const keyB = makeKeyBag({ localKeyId: 'bb' });
    const certB = makeCertBag({ localKeyId: 'bb', signingKeyUsage: true });

    const result = selectCredential([keyA, keyB], [certA, certB]);

    expect(result.keyBag).toBe(keyB);
    expect(result.certBag).toBe(certB);
  });

  it('con varias claves y sin keyUsage de firma, prefiere la que tiene friendlyName', () => {
    const keyA = makeKeyBag({ localKeyId: 'aa' });
    const certA = makeCertBag({ localKeyId: 'aa' });
    const keyB = makeKeyBag({ localKeyId: 'bb', friendlyName: 'mi credencial de firma' });
    const certB = makeCertBag({ localKeyId: 'bb' });

    const result = selectCredential([keyA, keyB], [certA, certB]);

    expect(result.keyBag).toBe(keyB);
  });

  it('lanza CertificateError si no hay ninguna clave privada', () => {
    expect(() => selectCredential([], [makeCertBag({})])).toThrow(CertificateError);
  });

  it('lanza CertificateError si no hay ningún certificado', () => {
    expect(() => selectCredential([makeKeyBag({})], [])).toThrow(CertificateError);
  });
});
