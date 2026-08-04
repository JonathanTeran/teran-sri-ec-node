import type { DynamicModule, Provider } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { type Certificate, loadCertificate, SriClient } from '@amephia/sri-ec';

import type { SriModuleAsyncOptions, SriModuleOptions } from './interfaces.js';
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

/** Provider de `SRI_CLIENT`: arma el `SriClient` a partir de las `SriModuleOptions` ya resueltas (`SRI_MODULE_OPTIONS`). */
const sriClientProvider: Provider = {
  provide: SRI_CLIENT,
  useFactory: (options: SriModuleOptions): SriClient =>
    new SriClient({
      ambiente: options.ambiente,
      certificate: resolveCertificate(options.certificate),
      transport: options.transport,
      validate: options.validate,
    }),
  inject: [SRI_MODULE_OPTIONS],
};

/**
 * Módulo NestJS de `@amephia/sri-ec`: wiring de DI puro (sin lógica de
 * negocio propia) que expone {@link SriService}/`SRI_CLIENT` configurados a
 * partir de {@link SriModuleOptions}. Mismo patrón `forRoot()`/
 * `forRootAsync()` que `ConfigModule`/`TypeOrmModule` en el ecosistema Nest.
 */
@Module({})
export class SriModule {
  /** Registro síncrono: `options` ya trae `ambiente`/`certificate` resueltos. */
  static forRoot(options: SriModuleOptions): DynamicModule {
    return {
      module: SriModule,
      global: options.isGlobal ?? false,
      providers: [{ provide: SRI_MODULE_OPTIONS, useValue: options }, sriClientProvider, SriService],
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
        { provide: SRI_MODULE_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
        sriClientProvider,
        SriService,
      ],
      exports: [SriService, SRI_CLIENT],
    };
  }
}
