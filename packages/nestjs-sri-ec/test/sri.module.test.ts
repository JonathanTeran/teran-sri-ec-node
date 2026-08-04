import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

/**
 * Se re-envuelve `loadCertificate` con un espía que delega en la
 * implementación real (no un stub): así se puede verificar que el provider
 * de `SRI_CLIENT` la invoca con el `.p12`/contraseña correctos cuando
 * `certificate` viene en esa forma (en vez de un `Certificate` ya cargado),
 * sin dejar de ejercitar la carga real del certificado de prueba.
 */
vi.mock('sri-ec', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sri-ec')>();
  return { ...actual, loadCertificate: vi.fn(actual.loadCertificate) };
});

import * as sriEc from 'sri-ec';
import { Ambiente, type Certificate, type SriTransport } from 'sri-ec';

import { SriModule } from '../src/sri.module.js';
import { SriService } from '../src/sri.service.js';
import { SRI_CLIENT, SRI_MODULE_OPTIONS } from '../src/tokens.js';

const FIXTURES_DIR = fileURLToPath(new URL('../../sri-ec/test/fixtures/', import.meta.url));
const PASSWORD = 'test1234';

function fixtureBytes(name: string): Uint8Array {
  return readFileSync(join(FIXTURES_DIR, name));
}

function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

function stubTransport(): SriTransport {
  return {
    enviar: vi.fn(async () => ({ estado: 'RECIBIDA', mensajes: [] })),
    autorizar: vi.fn(async () => ({ estado: 'AUTORIZADO', mensajes: [] })),
  };
}

describe('SriModule.forRoot', () => {
  it('expone SriService y SRI_CLIENT cuando certificate ya es un Certificate cargado', async () => {
    const certificate: Certificate = sriEc.loadCertificate(fixtureBytes('test-cert.p12'), PASSWORD);

    const moduleRef = await Test.createTestingModule({
      imports: [SriModule.forRoot({ ambiente: Ambiente.Pruebas, certificate })],
    }).compile();

    const service = moduleRef.get(SriService);
    const client = moduleRef.get(SRI_CLIENT);

    expect(service).toBeInstanceOf(SriService);
    expect(client).toBeInstanceOf(sriEc.SriClient);
    expect(service.client).toBe(client);
  });

  it('con isGlobal: true produce un DynamicModule global', () => {
    const certificate: Certificate = sriEc.loadCertificate(fixtureBytes('test-cert.p12'), PASSWORD);

    const dynamicModule = SriModule.forRoot({
      ambiente: Ambiente.Pruebas,
      certificate,
      isGlobal: true,
    });

    expect(dynamicModule.global).toBe(true);
  });

  it('con isGlobal omitido, el DynamicModule no es global', () => {
    const certificate: Certificate = sriEc.loadCertificate(fixtureBytes('test-cert.p12'), PASSWORD);

    const dynamicModule = SriModule.forRoot({ ambiente: Ambiente.Pruebas, certificate });

    expect(dynamicModule.global).toBe(false);
  });

  it('cuando certificate es { p12, password }, el provider llama loadCertificate() con esos valores', async () => {
    vi.mocked(sriEc.loadCertificate).mockClear();
    const p12 = fixtureBytes('test-cert.p12');

    const moduleRef = await Test.createTestingModule({
      imports: [SriModule.forRoot({ ambiente: Ambiente.Pruebas, certificate: { p12, password: PASSWORD } })],
    }).compile();

    // Forzar instanciación del provider SRI_CLIENT (los providers de Nest son lazy hasta que se resuelven).
    moduleRef.get(SRI_CLIENT);

    expect(sriEc.loadCertificate).toHaveBeenCalledWith(p12, PASSWORD);
  });

  it('el SriService.sign() producido funciona con el certificado cargado desde p12+password', async () => {
    const p12 = fixtureBytes('test-cert.p12');

    const moduleRef = await Test.createTestingModule({
      imports: [SriModule.forRoot({ ambiente: Ambiente.Pruebas, certificate: { p12, password: PASSWORD } })],
    }).compile();

    const service = moduleRef.get(SriService);
    const signed = service.sign(fixtureText('factura.xml'));

    expect(signed).toContain('<ds:Signature');
  });

  it('createBatch() produce un BatchEmitter preconfigurado con el ambiente/transport del módulo', async () => {
    const certificate: Certificate = sriEc.loadCertificate(fixtureBytes('test-cert.p12'), PASSWORD);
    const transport = stubTransport();

    const moduleRef = await Test.createTestingModule({
      imports: [SriModule.forRoot({ ambiente: Ambiente.Pruebas, certificate, transport })],
    }).compile();

    const service = moduleRef.get(SriService);
    const batch = service.createBatch();

    expect(batch).toBeInstanceOf(sriEc.BatchEmitter);

    batch.add('clave-1', '<signed/>');
    await batch.run();

    expect(transport.enviar).toHaveBeenCalledWith('<signed/>', Ambiente.Pruebas);
    expect(batch.status().AUTHORIZED).toBe(1);
  });
});

describe('SRI_MODULE_OPTIONS no expone material sensible', () => {
  /** Serializa el valor registrado para inspeccionarlo como lo haría un volcado/logger del contenedor. */
  function dump(value: unknown): string {
    return JSON.stringify(value, (_k, v: unknown) =>
      v instanceof Uint8Array ? `Uint8Array(${v.length})` : v,
    );
  }

  it('forRoot con { p12, password }: el valor registrado no contiene ni el p12 ni la contraseña', async () => {
    const p12 = fixtureBytes('test-cert.p12');

    const moduleRef = await Test.createTestingModule({
      imports: [
        SriModule.forRoot({ ambiente: Ambiente.Pruebas, certificate: { p12, password: PASSWORD } }),
      ],
    }).compile();

    const options = moduleRef.get<Record<string, unknown>>(SRI_MODULE_OPTIONS);

    expect(options).toEqual({ ambiente: Ambiente.Pruebas });
    expect(Object.keys(options)).not.toContain('p12');
    expect(Object.keys(options)).not.toContain('password');
    expect(Object.keys(options)).not.toContain('certificate');
    expect(dump(options)).not.toContain(PASSWORD);
  });

  it('forRoot con un Certificate ya cargado: tampoco se registra el certificado', async () => {
    const certificate: Certificate = sriEc.loadCertificate(fixtureBytes('test-cert.p12'), PASSWORD);
    const transport = stubTransport();

    const moduleRef = await Test.createTestingModule({
      imports: [
        SriModule.forRoot({
          ambiente: Ambiente.Produccion,
          certificate,
          transport,
          validate: false,
        }),
      ],
    }).compile();

    const options = moduleRef.get<Record<string, unknown>>(SRI_MODULE_OPTIONS);

    // Solo la configuración que SriService necesita aguas abajo.
    expect(options).toEqual({ ambiente: Ambiente.Produccion, transport, validate: false });
    expect(dump(options)).not.toContain('PRIVATE KEY');
    expect(dump(options)).not.toContain(certificate.certPem);
  });

  it('forRootAsync: la useFactory se invoca una sola vez y su resultado crudo no queda registrado', async () => {
    const p12 = fixtureBytes('test-cert.p12');
    const useFactory = vi.fn(() => ({
      ambiente: Ambiente.Pruebas,
      certificate: { p12, password: PASSWORD },
    }));

    const moduleRef = await Test.createTestingModule({
      imports: [SriModule.forRootAsync({ useFactory })],
    }).compile();

    const options = moduleRef.get<Record<string, unknown>>(SRI_MODULE_OPTIONS);
    const client = moduleRef.get(SRI_CLIENT);

    expect(client).toBeInstanceOf(sriEc.SriClient);
    expect(useFactory).toHaveBeenCalledTimes(1);
    expect(options).toEqual({ ambiente: Ambiente.Pruebas });
    expect(dump(options)).not.toContain(PASSWORD);
  });
});

describe('SriModule.forRootAsync', () => {
  it('resuelve SriModuleOptions vía useFactory + inject', async () => {
    const CONFIG_TOKEN = Symbol('CONFIG_TOKEN');
    const certificate: Certificate = sriEc.loadCertificate(fixtureBytes('test-cert.p12'), PASSWORD);

    /**
     * `forRootAsync` construye un `DynamicModule` propio, distinto del
     * módulo raíz de test — por el encapsulamiento estándar de Nest, su
     * `useFactory`/`inject` solo ven providers declarados en sus propios
     * `imports` (nunca los del módulo que lo importa). Mismo patrón que
     * `ConfigModule.forRootAsync({ imports: [OtroModule], inject: [...] })`
     * en apps reales.
     */
    @Module({
      providers: [{ provide: CONFIG_TOKEN, useValue: { ambiente: Ambiente.Pruebas } }],
      exports: [CONFIG_TOKEN],
    })
    class FakeConfigModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        SriModule.forRootAsync({
          imports: [FakeConfigModule],
          inject: [CONFIG_TOKEN],
          useFactory: (config: { ambiente: Ambiente }) => ({
            ambiente: config.ambiente,
            certificate,
          }),
        }),
      ],
    }).compile();

    const service = moduleRef.get(SriService);
    const client = moduleRef.get(SRI_CLIENT);

    expect(service).toBeInstanceOf(SriService);
    expect(client).toBeInstanceOf(sriEc.SriClient);
  });

  it('soporta useFactory asíncrono', async () => {
    const certificate: Certificate = sriEc.loadCertificate(fixtureBytes('test-cert.p12'), PASSWORD);

    const moduleRef = await Test.createTestingModule({
      imports: [
        SriModule.forRootAsync({
          useFactory: async () => {
            await Promise.resolve();
            return { ambiente: Ambiente.Pruebas, certificate };
          },
        }),
      ],
    }).compile();

    const service = moduleRef.get(SriService);

    expect(service).toBeInstanceOf(SriService);
  });

  it('con isGlobal: true produce un DynamicModule global', () => {
    const dynamicModule = SriModule.forRootAsync({
      isGlobal: true,
      useFactory: () => ({ ambiente: Ambiente.Pruebas, certificate: {} as Certificate }),
    });

    expect(dynamicModule.global).toBe(true);
  });
});
