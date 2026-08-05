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

/** @throws SriError con `code: 'RIDE_MISSING_DEPENDENCY'` si `pdfkit` no está instalado. */
export async function cargarPdfkit(): Promise<PDFDocumentConstructor> {
  try {
    const mod = (await import('pdfkit')) as unknown as { default: PDFDocumentConstructor };
    return mod.default;
  } catch {
    throw new SriError(MENSAJE_DEPENDENCIAS_FALTANTES, 'RIDE_MISSING_DEPENDENCY');
  }
}

/** @throws SriError con `code: 'RIDE_MISSING_DEPENDENCY'` si `qrcode` no está instalado. */
export async function cargarQrcode(): Promise<QrCodeApi> {
  try {
    const mod = (await import('qrcode')) as unknown as QrCodeApi;
    return mod;
  } catch {
    throw new SriError(MENSAJE_DEPENDENCIAS_FALTANTES, 'RIDE_MISSING_DEPENDENCY');
  }
}
