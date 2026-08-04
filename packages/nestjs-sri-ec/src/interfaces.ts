import type { ModuleMetadata } from '@nestjs/common';
import type { Ambiente, Certificate, SriTransport } from '@amephia/sri-ec';

/**
 * Configuración **no sensible** del módulo: lo único que queda registrado en
 * el contenedor de Nest bajo `SRI_MODULE_OPTIONS`.
 *
 * El certificado (y muy especialmente el par `{ p12, password }`) se resuelve
 * ANTES de que nada entre al contenedor y nunca se registra: un volcado del
 * contenedor o un serializador de errores de Nest imprimiría la contraseña
 * del `.p12` en claro.
 */
export interface SriRuntimeOptions {
  ambiente: Ambiente;
  /** Por defecto `new FetchSoapTransport()`, igual que `SriClient`. */
  transport?: SriTransport;
  /** `false` para saltar `assertValid()` antes de firmar. `true` por defecto. */
  validate?: boolean;
}

/**
 * Opciones de {@link SriModule.forRoot}. Solo `ambiente` y `certificate` son
 * obligatorios — el resto tiene un default sensato, igual que
 * `SriClientOptions` en `@amephia/sri-ec`.
 */
export interface SriModuleOptions extends SriRuntimeOptions {
  /**
   * Un `Certificate` ya cargado (p.ej. si el consumidor ya llamó
   * `loadCertificate()` por su cuenta, o lo obtiene de un secret manager en
   * ese formato), o el par `.p12`/contraseña crudo — en ese caso el
   * provider de `SRI_CLIENT` llama `loadCertificate()` internamente antes
   * de construir el `SriClient`.
   */
  certificate: { p12: Uint8Array; password: string } | Certificate;
  /** Registra el módulo como global (`@Global()`). `false` por defecto. */
  isGlobal?: boolean;
}

/** Opciones de {@link SriModule.forRootAsync} — mismo shape que `ConfigModule.forRootAsync`/`TypeOrmModule.forRootAsync` de Nest. */
export interface SriModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  /** Tokens a inyectar como argumentos de `useFactory`, en el mismo orden. */
  inject?: any[];
  /** Registra el módulo como global. `false` por defecto. */
  isGlobal?: boolean;
  /** Produce las {@link SriModuleOptions}, de forma síncrona o asíncrona. */
  useFactory: (...args: any[]) => SriModuleOptions | Promise<SriModuleOptions>;
}
