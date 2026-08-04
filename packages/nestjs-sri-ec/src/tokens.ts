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
 * Token interno de las `SriModuleOptions` ya resueltas (sea la llamada
 * síncrona a `forRoot()` o el resultado de `useFactory` en
 * `forRootAsync()`). No es parte de la superficie pública documentada del
 * módulo, pero se exporta por si un consumidor avanzado necesita inyectar
 * la configuración cruda (p.ej. para leer `ambiente` fuera de
 * {@link SriService}).
 */
export const SRI_MODULE_OPTIONS: unique symbol = Symbol('SRI_MODULE_OPTIONS');
