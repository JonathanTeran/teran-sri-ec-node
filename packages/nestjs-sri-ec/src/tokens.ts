/**
 * Tokens de inyección de `@amephia/nestjs-sri-ec`. Símbolos (no strings)
 * para evitar colisiones con tokens de otras librerías en el contenedor de
 * Nest — mismo patrón que `getConnectionToken()` en `@nestjs/typeorm` o los
 * tokens internos de `@nestjs/config`.
 */

/**
 * Token del `SriClient` (ver `@amephia/sri-ec`) configurado por
 * {@link SriModule}. Úsese con `@Inject(SRI_CLIENT)` cuando se necesite el
 * cliente crudo en vez de la fachada {@link SriService}.
 */
export const SRI_CLIENT: unique symbol = Symbol('SRI_CLIENT');

/**
 * Token de la configuración **no sensible** del módulo (`SriRuntimeOptions`:
 * `ambiente`, `transport`, `validate`), sea de la llamada síncrona a
 * `forRoot()` o del `useFactory` de `forRootAsync()`. Se exporta por si un
 * consumidor avanzado necesita leer `ambiente` fuera de {@link SriService}.
 *
 * **Nunca contiene el certificado ni el par `{ p12, password }`**: el módulo
 * los consume al construir el `SriClient`, antes de registrar nada en el
 * contenedor, para que una traza de error o un volcado del contenedor no
 * puedan exponer la contraseña del `.p12`.
 */
export const SRI_MODULE_OPTIONS: unique symbol = Symbol('SRI_MODULE_OPTIONS');
