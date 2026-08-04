import type { DynamicModule, Provider } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { type Certificate, loadCertificate, SriClient } from '@amephia/sri-ec';

import type { SriModuleAsyncOptions, SriModuleOptions, SriRuntimeOptions } from './interfaces.js';
import { SriService } from './sri.service.js';
import { SRI_CLIENT, SRI_MODULE_OPTIONS } from './tokens.js';

/** `true` si `certificate` es el par `.p12`/contraseña crudo, en vez de un `Certificate` ya cargado. */
function isP12Certificate(
  certificate: SriModuleOptions['certificate'],
): certificate is { p12: Uint8Array; password: string } {
  return 'p12' in certificate;
}

/** Resuelve `SriModuleOptions.certificate` a un `Certificate` cargando el `.p12` cuando haga falta. */
function resolveCertificate(certificate: SriModuleOptions['certificate']): Certificate {
  return isP12Certificate(certificate) ? loadCertificate(certificate.p12, certificate.password) : certificate;
}

/**
 * Descompone las `SriModuleOptions` crudas en (a) el `SriClient` ya
 * construido y (b) la configuración **no sensible** que sí puede vivir en el
 * contenedor.
 *
 * Es el punto donde el `.p12` y su contraseña dejan de existir: se consumen
 * aquí, en una variable local, y ni el objeto de opciones original ni el
 * certificado resuelto se registran bajo ningún token. Registrar las opciones
 * crudas —como se hacía antes— dejaba la contraseña del certificado
 * recuperable desde cualquier volcado del contenedor o traza de error de Nest.
 */
function splitOptions(options: SriModuleOptions): { client: SriClient; runtime: SriRuntimeOptions } {
  const client = new SriClient({
    ambiente: options.ambiente,
    certificate: resolveCertificate(options.certificate),
    transport: options.transport,
    validate: options.validate,
  });

  const runtime: SriRuntimeOptions = { ambiente: options.ambiente };
  if (options.transport !== undefined) {
    runtime.transport = options.transport;
  }
  if (options.validate !== undefined) {
    runtime.validate = options.validate;
  }

  return { client, runtime };
}

type ResolvedSetup = ReturnType<typeof splitOptions>;

/**
 * Token **interno** (no exportado por el paquete) del resultado de
 * `splitOptions()` en el camino asíncrono: `forRootAsync` no puede resolver el
 * certificado antes de compilar el módulo, así que lo hace dentro de un único
 * provider que consume las opciones crudas y solo publica lo ya saneado. La
 * `useFactory` del consumidor se invoca exactamente una vez.
 */
const SRI_RESOLVED_SETUP = Symbol('SRI_RESOLVED_SETUP');

const asyncClientProvider: Provider = {
  provide: SRI_CLIENT,
  useFactory: (setup: ResolvedSetup): SriClient => setup.client,
  inject: [SRI_RESOLVED_SETUP],
};

const asyncRuntimeOptionsProvider: Provider = {
  provide: SRI_MODULE_OPTIONS,
  useFactory: (setup: ResolvedSetup): SriRuntimeOptions => setup.runtime,
  inject: [SRI_RESOLVED_SETUP],
};

/**
 * Módulo NestJS de `@amephia/sri-ec`: wiring de DI puro (sin lógica de
 * negocio propia) que expone {@link SriService}/`SRI_CLIENT` configurados a
 * partir de {@link SriModuleOptions}. Mismo patrón `forRoot()`/
 * `forRootAsync()` que `ConfigModule`/`TypeOrmModule` en el ecosistema Nest.
 *
 * Ni el `.p12` ni su contraseña llegan nunca al contenedor: se consumen al
 * construir el `SriClient` y lo único que queda registrado bajo
 * `SRI_MODULE_OPTIONS` es {@link SriRuntimeOptions} (`ambiente`, `transport`,
 * `validate`).
 */
@Module({})
export class SriModule {
  /** Registro síncrono: `options` ya trae `ambiente`/`certificate` resueltos. */
  static forRoot(options: SriModuleOptions): DynamicModule {
    // El certificado se resuelve aquí, fuera del contenedor: los providers
    // solo ven el cliente ya construido y la configuración no sensible.
    const { client, runtime } = splitOptions(options);

    return {
      module: SriModule,
      global: options.isGlobal ?? false,
      providers: [
        { provide: SRI_MODULE_OPTIONS, useValue: runtime },
        { provide: SRI_CLIENT, useValue: client },
        SriService,
      ],
      exports: [SriService, SRI_CLIENT],
    };
  }

  /** Registro asíncrono: `useFactory` (con `inject`/`imports`) produce las `SriModuleOptions`, p.ej. leyendo un `ConfigService`. */
  static forRootAsync(options: SriModuleAsyncOptions): DynamicModule {
    return {
      module: SriModule,
      global: options.isGlobal ?? false,
      imports: options.imports ?? [],
      providers: [
        {
          provide: SRI_RESOLVED_SETUP,
          useFactory: async (...args: unknown[]): Promise<ResolvedSetup> =>
            splitOptions(await options.useFactory(...args)),
          inject: options.inject ?? [],
        },
        asyncClientProvider,
        asyncRuntimeOptionsProvider,
        SriService,
      ],
      exports: [SriService, SRI_CLIENT],
    };
  }
}
