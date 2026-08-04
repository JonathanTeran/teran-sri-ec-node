import { describe, expect, it, vi } from 'vitest';

import { Ambiente, TipoComprobante } from '../src/catalogs/index.js';
import type { Comprobante } from '../src/documents/index.js';
import { CommunicationError, ValidationError } from '../src/errors/index.js';
import type { Certificate } from '../src/signing/certificate.js';
import { XadesSigner } from '../src/signing/xades-signer.js';
import { SriClient, type SriClientOptions } from '../src/sri-client.js';
import type { AuthorizationOutcome, ReceptionOutcome, SriTransport } from '../src/transport/types.js';
import { calcularDigitoVerificador, generarClaveAcceso } from '../src/utils/clave-acceso.js';
import { facturaFixture, guiaRemisionFixture } from './documents.test.js';

/**
 * `SriClientOptions.signer` es un `XadesSigner` concreto (no una interfaz),
 * así que en vez de un doble a mano se instancia uno real y se espía
 * `.sign()` — evita depender de un certificado/clave real (eso ya lo cubre
 * exhaustivamente `xades-signer.test.ts`); aquí solo interesa contar
 * llamadas y devolver un XML "firmado" predecible.
 */
function stubSigner() {
  const signer = new XadesSigner();
  const sign = vi.spyOn(signer, 'sign').mockImplementation((xml) => `<signed>${xml}</signed>`);
  return { signer, sign };
}

/** Nunca se usa criptográficamente (el signer está espiado): solo debe satisfacer la forma de `Certificate`. */
const FAKE_CERTIFICATE: Certificate = {
  certPem: 'fake-cert-pem',
  privateKeyPem: 'fake-key-pem',
  extraCerts: [],
};

function mockTransport(overrides: {
  enviar?: SriTransport['enviar'];
  autorizar?: SriTransport['autorizar'];
} = {}) {
  const enviar = vi.fn(
    overrides.enviar ?? (async (): Promise<ReceptionOutcome> => ({ estado: 'RECIBIDA', mensajes: [] })),
  );
  const autorizar = vi.fn(
    overrides.autorizar ??
      (async (): Promise<AuthorizationOutcome> => ({ estado: 'EN PROCESO', mensajes: [] })),
  );
  return { enviar, autorizar };
}

function buildClient(
  options: Partial<SriClientOptions> & { transport: SriTransport; signer: XadesSigner },
): SriClient {
  return new SriClient({
    ambiente: Ambiente.Pruebas,
    certificate: FAKE_CERTIFICATE,
    ...options,
  });
}

/**
 * Clave de acceso coherente con un comprobante concreto: desde que
 * `SriClient` verifica las claves provistas por el caller (formato + dígito
 * verificador + campos embebidos), los tests no pueden inventar un string
 * cualquiera — se deriva del propio fixture, igual que haría un caller real
 * que persiste la clave antes de emitir.
 */
function claveDe(
  doc: Comprobante,
  fecha: string,
  codigoNum = '12345678',
  ambiente: Ambiente = Ambiente.Pruebas,
): string {
  const info = doc.infoTributaria;
  return generarClaveAcceso({
    fecha,
    tipoComprobante: doc.tipo,
    ruc: info.ruc,
    ambiente,
    serie: `${info.estab}${info.ptoEmi}`,
    numero: info.secuencial,
    codigoNum,
    tipoEmision: info.tipoEmision,
  });
}

const CLAVE = claveDe(facturaFixture, '03/08/2026');

describe('SriClient.emit', () => {
  it('flujo completo autorizado: RECIBIDA + AUTORIZADO produce un EmissionResult con numeroAutorizacion y authorizedXml', async () => {
    const { signer, sign } = stubSigner();
    const transport = mockTransport({
      autorizar: async () => ({
        estado: 'AUTORIZADO',
        numeroAutorizacion: CLAVE,
        fechaAutorizacion: '2026-08-03T10:00:00-05:00',
        comprobante: '<factura id="comprobante">...</factura>',
        mensajes: [],
      }),
    });
    const client = buildClient({ transport, signer });

    const result = await client.emit(facturaFixture, CLAVE);

    expect(result.status).toBe('AUTORIZADO');
    expect(result.claveAcceso).toBe(CLAVE);
    expect(result.numeroAutorizacion).toBe(CLAVE);
    expect(result.fechaAutorizacion).toBe('2026-08-03T10:00:00-05:00');
    expect(result.authorizedXml).toBe('<factura id="comprobante">...</factura>');
    expect(result.signedXml).toContain('<signed>');
    expect(result.rejectedStage).toBeUndefined();
    expect(sign).toHaveBeenCalledTimes(1);
    expect(transport.enviar).toHaveBeenCalledTimes(1);
    expect(transport.autorizar).toHaveBeenCalledTimes(1);
  });

  it('DEVUELTA en recepción → RECHAZADO/RECEPCION, y autorizar NO se llama', async () => {
    const { signer } = stubSigner();
    const transport = mockTransport({
      enviar: async () => ({
        estado: 'DEVUELTA',
        mensajes: [{ identificador: '43', mensaje: 'RUC del emisor no existe', tipo: 'ERROR' }],
      }),
    });
    const client = buildClient({ transport, signer });

    const result = await client.emit(facturaFixture, CLAVE);

    expect(result.status).toBe('RECHAZADO');
    expect(result.rejectedStage).toBe('RECEPCION');
    expect(result.messages).toEqual([
      { identificador: '43', mensaje: 'RUC del emisor no existe', tipo: 'ERROR' },
    ]);
    expect(result.numeroAutorizacion).toBeUndefined();
    expect(transport.autorizar).not.toHaveBeenCalled();
  });

  it('NO AUTORIZADO en autorización → RECHAZADO/AUTORIZACION', async () => {
    const { signer } = stubSigner();
    const transport = mockTransport({
      autorizar: async () => ({
        estado: 'NO AUTORIZADO',
        mensajes: [{ identificador: '45', mensaje: 'Comprobante ya registrado', tipo: 'ERROR' }],
      }),
    });
    const client = buildClient({ transport, signer });

    const result = await client.emit(facturaFixture, CLAVE);

    expect(result.status).toBe('RECHAZADO');
    expect(result.rejectedStage).toBe('AUTORIZACION');
    expect(result.messages).toHaveLength(1);
  });

  it.each(['EN PROCESO', 'EN PROCESAMIENTO', 'en proceso'])(
    "'%s' en autorización → EN_PROCESO (case-insensitive), sin rejectedStage",
    async (estadoCrudo) => {
      const { signer } = stubSigner();
      const transport = mockTransport({
        autorizar: async () => ({ estado: estadoCrudo, mensajes: [] }),
      });
      const client = buildClient({ transport, signer });

      const result = await client.emit(facturaFixture, CLAVE);

      expect(result.status).toBe('EN_PROCESO');
      expect(result.rejectedStage).toBeUndefined();
    },
  );

  it('sin claveAcceso explícita, genera una de 49 dígitos con dígito verificador y prefijo fecha/tipo/ruc correctos', async () => {
    const { signer } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer });

    const result = await client.emit(facturaFixture);

    expect(result.claveAcceso).toHaveLength(49);
    expect(result.claveAcceso).toMatch(/^\d{49}$/);

    const clave48 = result.claveAcceso.slice(0, 48);
    const dv = Number(result.claveAcceso.slice(48));
    expect(dv).toBe(calcularDigitoVerificador(clave48));

    // dd/mm/yyyy '03/08/2026' -> 'ddmmyyyy' '03082026', luego codDoc '01', luego RUC.
    expect(result.claveAcceso.slice(0, 8)).toBe('03082026');
    expect(result.claveAcceso.slice(8, 10)).toBe('01');
    expect(result.claveAcceso.slice(10, 23)).toBe(facturaFixture.infoTributaria.ruc);
  });

  it('GuiaRemision (sin fechaEmision) usa fechaIniTransporte como fecha de la clave de acceso generada', async () => {
    const { signer } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer });

    const result = await client.emit(guiaRemisionFixture);

    expect(result.claveAcceso).toHaveLength(49);
    expect(result.claveAcceso.slice(0, 8)).toBe('03082026'); // fechaIniTransporte: '03/08/2026'
    expect(result.claveAcceso.slice(8, 10)).toBe('06'); // codDoc GuiaRemision
  });

  it('doc inválido → lanza ValidationError antes de firmar o de tocar el transporte', async () => {
    const { signer, sign } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer });

    const docInvalido: Comprobante = { ...facturaFixture, totalSinImpuestos: 'no-es-un-monto' };

    await expect(client.emit(docInvalido)).rejects.toBeInstanceOf(ValidationError);
    expect(sign).not.toHaveBeenCalled();
    expect(transport.enviar).not.toHaveBeenCalled();
    expect(transport.autorizar).not.toHaveBeenCalled();
  });

  it('validate: false salta assertValid y emite el doc igualmente inválido', async () => {
    const { signer, sign } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer, validate: false });

    // RUC con código de establecimiento '000': pasa el regex estructural de
    // zod (13 dígitos) pero viola la regla de negocio `esRucLocalValido` —
    // a diferencia de un monto mal formado, esto no rompe la serialización
    // (el RUC se escribe tal cual, sin pasar por `formatMonto`), así que
    // permite comprobar que `validate: false` de verdad deja pasar un doc
    // inválido hasta el final del flujo.
    const docConRucInvalido: Comprobante = {
      ...facturaFixture,
      infoTributaria: { ...facturaFixture.infoTributaria, ruc: '1790011001000' },
    };

    const result = await client.emit(docConRucInvalido);

    expect(result.status).toBe('EN_PROCESO');
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('validate: false NO desactiva la verificación de ambiente: sigue lanzando ValidationError sin firmar', async () => {
    const { signer, sign } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({
      transport,
      signer,
      validate: false,
      ambiente: Ambiente.Produccion,
    });

    // facturaFixture declara infoTributaria.ambiente = Pruebas.
    await expect(client.emit(facturaFixture)).rejects.toBeInstanceOf(ValidationError);
    expect(sign).not.toHaveBeenCalled();
    expect(transport.enviar).not.toHaveBeenCalled();
  });

  it('EN_PROCESO conserva los mensajes devueltos por autorizar()', async () => {
    const { signer } = stubSigner();
    const transport = mockTransport({
      autorizar: async () => ({
        estado: 'EN PROCESO',
        mensajes: [
          {
            identificador: '70',
            mensaje: 'COMPROBANTE EN PROCESAMIENTO',
            tipo: 'INFORMATIVO',
            informacionAdicional: 'Consulte más tarde',
          },
        ],
      }),
    });
    const client = buildClient({ transport, signer });

    const result = await client.emit(facturaFixture, CLAVE);

    expect(result.status).toBe('EN_PROCESO');
    expect(result.rejectedStage).toBeUndefined();
    expect(result.messages).toEqual([
      {
        identificador: '70',
        mensaje: 'COMPROBANTE EN PROCESAMIENTO',
        tipo: 'INFORMATIVO',
        informacionAdicional: 'Consulte más tarde',
      },
    ]);
  });

  it('ambiente de infoTributaria distinto del ambiente del cliente → ValidationError, sin firmar', async () => {
    const { signer, sign } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer, ambiente: Ambiente.Produccion });

    await expect(client.emit(facturaFixture)).rejects.toBeInstanceOf(ValidationError);
    expect(sign).not.toHaveBeenCalled();
    expect(transport.enviar).not.toHaveBeenCalled();
  });

  it('CommunicationError de transport.enviar se propaga (no es un EmissionResult) con claveAcceso y signedXml adjuntos', async () => {
    const { signer } = stubSigner();
    const fallo = new CommunicationError('timeout hablando con el SRI');
    const transport = mockTransport({
      enviar: async () => {
        throw fallo;
      },
    });
    const client = buildClient({ transport, signer });

    const err = await client.emit(facturaFixture, CLAVE).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CommunicationError);
    const commErr = err as CommunicationError;
    expect(commErr.message).toBe('timeout hablando con el SRI');
    expect(commErr.claveAcceso).toBe(CLAVE);
    expect(commErr.signedXml).toContain('<signed>');
    expect(commErr.cause).toBe(fallo);
    expect(transport.autorizar).not.toHaveBeenCalled();
  });

  it('CommunicationError de transport.autorizar también se propaga con el contexto del comprobante', async () => {
    const { signer } = stubSigner();
    const causaOriginal = new TypeError('fetch failed');
    const fallo = new CommunicationError('timeout en autorización', causaOriginal);
    const transport = mockTransport({
      autorizar: async () => {
        throw fallo;
      },
    });
    const client = buildClient({ transport, signer });

    const err = await client.emit(facturaFixture, CLAVE).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CommunicationError);
    const commErr = err as CommunicationError;
    expect(commErr.claveAcceso).toBe(CLAVE);
    expect(commErr.signedXml).toContain('<signed>');
    // El `cause` original del transporte se preserva (no se pisa con el CommunicationError intermedio).
    expect(commErr.cause).toBe(causaOriginal);
  });

  it('un error que NO es CommunicationError se propaga intacto (sin envolver)', async () => {
    const { signer } = stubSigner();
    const fallo = new RangeError('bug en un transporte propio');
    const transport = mockTransport({
      enviar: async () => {
        throw fallo;
      },
    });
    const client = buildClient({ transport, signer });

    await expect(client.emit(facturaFixture, CLAVE)).rejects.toBe(fallo);
  });
});

describe('SriClient.emit — validación de la claveAcceso provista', () => {
  it('rechaza una clave que no son 49 dígitos, sin firmar ni tocar el transporte', async () => {
    const { signer, sign } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer });

    await expect(client.emit(facturaFixture, 'CLAVE-BASURA')).rejects.toBeInstanceOf(ValidationError);
    expect(sign).not.toHaveBeenCalled();
    expect(transport.enviar).not.toHaveBeenCalled();
  });

  it('rechaza una clave de 49 dígitos con dígito verificador incorrecto', async () => {
    const { signer, sign } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer });

    const dvMalo = String((Number(CLAVE.slice(48)) + 1) % 10);
    const claveConDvMalo = CLAVE.slice(0, 48) + dvMalo;

    await expect(client.emit(facturaFixture, claveConDvMalo)).rejects.toThrow(
      /dígito verificador/i,
    );
    expect(sign).not.toHaveBeenCalled();
  });

  it.each([
    [
      'ruc',
      { ...facturaFixture, infoTributaria: { ...facturaFixture.infoTributaria, ruc: '1790011002001' } },
    ],
    [
      'secuencial',
      {
        ...facturaFixture,
        infoTributaria: { ...facturaFixture.infoTributaria, secuencial: '000000999' },
      },
    ],
    ['fecha (ddmmyyyy)', { ...facturaFixture, fechaEmision: '04/08/2026' }],
  ])('rechaza una clave cuyo %s contradice al documento', async (campo, doc) => {
    const { signer, sign } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer });

    // CLAVE está construida sobre facturaFixture; `doc` cambia uno de sus campos.
    const err = await client.emit(doc as Comprobante, CLAVE).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).errors.join(' ')).toContain(campo);
    expect(sign).not.toHaveBeenCalled();
  });

  it('rechaza una clave calculada para el otro ambiente', async () => {
    const { signer } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer });

    const claveProduccion = claveDe(facturaFixture, '03/08/2026', '12345678', Ambiente.Produccion);

    await expect(client.emit(facturaFixture, claveProduccion)).rejects.toThrow(/ambiente/i);
  });

  it('acepta una clave coherente y la usa tal cual', async () => {
    const { signer } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer });

    const result = await client.emit(facturaFixture, CLAVE);

    expect(result.claveAcceso).toBe(CLAVE);
    expect(transport.enviar).toHaveBeenCalledTimes(1);
  });
});

describe('SriClient.prepare', () => {
  it('devuelve el XML firmado y una clave de 49 dígitos coherente con el documento', () => {
    const { signer, sign } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer });

    const { claveAcceso, signedXml } = client.prepare(facturaFixture);

    expect(claveAcceso).toMatch(/^\d{49}$/);
    expect(Number(claveAcceso.slice(48))).toBe(calcularDigitoVerificador(claveAcceso.slice(0, 48)));
    expect(claveAcceso.slice(0, 8)).toBe('03082026');
    expect(claveAcceso.slice(8, 10)).toBe(TipoComprobante.Factura);
    expect(claveAcceso.slice(10, 23)).toBe(facturaFixture.infoTributaria.ruc);
    expect(claveAcceso.slice(23, 24)).toBe(Ambiente.Pruebas);

    // El XML firmado embebe exactamente esa clave y pasó por el firmador.
    expect(signedXml).toContain('<signed>');
    expect(signedXml).toContain(`<claveAcceso>${claveAcceso}</claveAcceso>`);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('no toca el transporte: prepare() es puramente local', () => {
    const { signer } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer });

    client.prepare(facturaFixture);

    expect(transport.enviar).not.toHaveBeenCalled();
    expect(transport.autorizar).not.toHaveBeenCalled();
  });

  it('reusa la clave provista cuando es coherente, y la rechaza cuando no lo es', () => {
    const { signer } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer });

    expect(client.prepare(facturaFixture, CLAVE).claveAcceso).toBe(CLAVE);
    expect(() => client.prepare(facturaFixture, 'CLAVE-BASURA')).toThrow(ValidationError);
  });

  it('valida el documento igual que emit()', () => {
    const { signer } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer });

    const docInvalido: Comprobante = { ...facturaFixture, totalSinImpuestos: 'no-es-un-monto' };

    expect(() => client.prepare(docInvalido)).toThrow(ValidationError);
  });
});

describe('SriClient.authorize', () => {
  it('pasa directo a transport.autorizar() con el ambiente del cliente', async () => {
    const { signer } = stubSigner();
    const outcome: AuthorizationOutcome = { estado: 'AUTORIZADO', mensajes: [] };
    const transport = mockTransport({ autorizar: async () => outcome });
    const client = buildClient({ transport, signer, ambiente: Ambiente.Produccion });

    const result = await client.authorize(CLAVE);

    expect(result).toBe(outcome);
    expect(transport.autorizar).toHaveBeenCalledWith(CLAVE, Ambiente.Produccion);
  });
});

describe('SriClient.sign', () => {
  it('delega en signer.sign() con el certificado del cliente', () => {
    const { signer, sign } = stubSigner();
    const transport = mockTransport();
    const client = buildClient({ transport, signer });

    const signed = client.sign('<factura/>');

    expect(signed).toBe('<signed><factura/></signed>');
    expect(sign).toHaveBeenCalledWith('<factura/>', FAKE_CERTIFICATE);
  });
});
