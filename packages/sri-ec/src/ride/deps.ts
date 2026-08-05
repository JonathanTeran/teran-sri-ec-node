// Auto-referencia al propio paquete (no `'../errors/index.js'`): ver la nota
// de bundling en el bloque de comentarios de abajo y `tsup.config.ts`.
import { SriError } from 'sri-ec';

/**
 * Carga perezosa de `pdfkit`/`qrcode` (`peerDependencies` opcionales de este
 * paquete — `peerDependenciesMeta.optional`, ver `package.json`; **no**
 * `optionalDependencies`: ese campo hace que npm las instale igual,
 * tolerando el fallo, lo cual habría vuelto obligatoria la instalación de
 * `pdfkit`/`qrcode`/`fontkit` para todo el mundo). El core de `sri-ec` no las
 * importa nunca — solo este submódulo (`sri-ec/ride`) las toca, y únicamente
 * cuando alguien llama a `generarRide()`. Quien solo emite/firma
 * comprobantes no las instala ni paga el costo de cargarlas.
 *
 * `await import(...)` en vez de `require`: es la única forma de que un
 * módulo ESM (`"type": "module"`) falle en *runtime* (no al cargar el
 * paquete) si la dependencia opcional no está instalada, y de producir un
 * error propio (`SriError`) en vez de dejar escapar el
 * `ERR_MODULE_NOT_FOUND` crudo de Node.
 *
 * `SriError` se importa como `'sri-ec'` (el nombre del propio paquete, no
 * `'../errors/index.js'`): tsup empaqueta `src/ride/index.ts` en un bundle
 * aparte (`dist/ride/index.*`, ver `tsup.config.ts` → `entry`), y en CJS
 * esbuild no comparte código entre entradas (a diferencia de ESM, donde sí
 * lo hace vía un chunk común) — sin esto, `dist/ride/index.cjs` incluiría su
 * propia copia de la clase `SriError`, distinta (por identidad) de la que
 * exporta `dist/index.cjs`, y `catch (e) { e instanceof SriError }` en un
 * consumidor CommonJS sería siempre `false`. Al importar por el nombre del
 * paquete y marcarlo `external` en `tsup.config.ts`, ambos bundles (ESM y
 * CJS) delegan en el mismo módulo core en runtime — Node resuelve
 * `'sri-ec'` como auto-referencia (`package.json` → `exports`) incluso sin
 * que el paquete esté en un `node_modules` real de un consumidor (ver
 * https://nodejs.org/api/packages.html#self-referencing-a-package-using-its-name).
 */

const MENSAJE_DEPENDENCIAS_FALTANTES =
  'Para generar el RIDE instala las dependencias opcionales: npm install pdfkit qrcode';

/** Firma de construcción de `PDFDocument` (pdfkit exporta la clase como `export =`). */
export type PDFDocumentConstructor = new (options?: PDFKit.PDFDocumentOptions) => PDFKit.PDFDocument;

/** Subconjunto de la API de `qrcode` que usa `qr.ts`. */
export interface QrCodeApi {
  toBuffer(
    text: string,
    options?: { type?: 'png'; margin?: number; width?: number },
  ): Promise<Buffer>;
}

/**
 * `true` si `err` es lo que Node lanza cuando el módulo, literalmente, no se
 * encuentra en disco (paquete no instalado) — `ERR_MODULE_NOT_FOUND` para
 * `import()` (lo que usa este archivo); se comprueba también la variante
 * `MODULE_NOT_FOUND` (sin el prefijo `ERR_`, la que usa `require()` en CJS)
 * por si el consumidor interopera con esta librería en un entorno que
 * reduce `import()` a `require()` (p.ej. algunos bundlers/loaders de
 * CommonJS) y ese es el código que efectivamente llega aquí.
 *
 * Cualquier OTRO error (p.ej. una instalación corrupta de `pdfkit`, una
 * versión de Node incompatible, o una falla al cargar un asset de fuente
 * interno de pdfkit) NO es "dependencia faltante": se relanza tal cual en
 * `cargarPdfkit`/`cargarQrcode` en vez de reportarse como
 * `RIDE_MISSING_DEPENDENCY` (hallazgo confirmado del reviewer — decirle a
 * alguien que YA tiene `pdfkit` instalado que lo instale no ayuda a
 * diagnosticar el problema real).
 */
function esModuloNoEncontrado(err: unknown): boolean {
  const codigoEsNoEncontrado = (code: unknown): boolean => code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';

  if (codigoEsNoEncontrado((err as { code?: unknown } | null | undefined)?.code)) return true;

  // Además de `err.code` directo, se revisa `err.cause?.code`: algunos
  // wrappers de módulo (incluido el mecanismo de mocking de las suites de
  // test de este mismo paquete) reenvían el fallo real de resolución como
  // `cause` de un error propio en vez de dejarlo en la propiedad `code` de
  // primer nivel — sigue siendo, en esencia, "el módulo no se encontró".
  return codigoEsNoEncontrado((err as { cause?: { code?: unknown } } | null | undefined)?.cause?.code);
}

/**
 * @throws SriError con `code: 'RIDE_MISSING_DEPENDENCY'` si `pdfkit` no está
 * instalado. Cualquier otro fallo de carga (ver {@link esModuloNoEncontrado})
 * se relanza sin envolver, con su mensaje y `stack` originales intactos.
 */
export async function cargarPdfkit(): Promise<PDFDocumentConstructor> {
  try {
    const mod = (await import('pdfkit')) as unknown as { default: PDFDocumentConstructor };
    return mod.default;
  } catch (err) {
    if (!esModuloNoEncontrado(err)) throw err;
    throw new SriError(MENSAJE_DEPENDENCIAS_FALTANTES, 'RIDE_MISSING_DEPENDENCY');
  }
}

/**
 * @throws SriError con `code: 'RIDE_MISSING_DEPENDENCY'` si `qrcode` no está
 * instalado. Cualquier otro fallo de carga (ver {@link esModuloNoEncontrado})
 * se relanza sin envolver, con su mensaje y `stack` originales intactos.
 */
export async function cargarQrcode(): Promise<QrCodeApi> {
  try {
    const mod = (await import('qrcode')) as unknown as QrCodeApi;
    return mod;
  } catch (err) {
    if (!esModuloNoEncontrado(err)) throw err;
    throw new SriError(MENSAJE_DEPENDENCIAS_FALTANTES, 'RIDE_MISSING_DEPENDENCY');
  }
}
