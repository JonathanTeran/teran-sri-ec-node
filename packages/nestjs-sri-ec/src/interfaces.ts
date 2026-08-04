import type { ModuleMetadata } from '@nestjs/common';
import type { Ambiente, Certificate, SriTransport } from 'sri-ec';

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
 * `SriClientOptions` en `sri-ec`.
 */
export interface SriModuleOptions extends SriRuntimeOptions {
  /**
   * Un `Certificate` ya cargado (p.ej. si el consumidor ya llamó
   * `loadCertificate()` por su cuenta, o lo obtiene de un secret manager en
   * ese formato), o el par `.p12`/contraseña crudo — en ese caso el módulo
   * llama `loadCertificate()` internamente antes de construir el `SriClient`.
   *
   * **Cuándo ocurre esa carga** difiere según el punto de entrada, porque el
   * certificado se resuelve siempre fuera del contenedor de DI (ver
   * `SriModule`):
   * - {@link SriModule.forRoot}: **al evaluar la definición del módulo**, es
   *   decir en la propia llamada a `forRoot()`, antes de que Nest compile
   *   nada. Un `.p12` o una contraseña inválidos fallan de inmediato, en el
   *   import del módulo, con `CertificateError` — no en la primera inyección.
   * - {@link SriModule.forRootAsync}: al resolver el provider interno que
   *   ejecuta la `useFactory`, ya durante la compilación del módulo (la
   *   `useFactory` se invoca exactamente una vez).
   *
   * En ninguno de los dos casos el `.p12` ni la contraseña quedan
   * registrados bajo un token del contenedor.
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
