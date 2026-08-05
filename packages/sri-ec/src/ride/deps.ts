import { SriError } from '../errors/index.js';

/**
 * Carga perezosa de `pdfkit`/`qrcode` (`optionalDependencies` de este
 * paquete, ver `package.json`). El core de `sri-ec` no las importa nunca —
 * solo este submódulo (`sri-ec/ride`) las toca, y únicamente cuando alguien
 * llama a `generarRide()`. Quien solo emite/firma comprobantes no las
 * instala ni paga el costo de cargarlas.
 *
 * `await import(...)` en vez de `require`: es la única forma de que un
 * módulo ESM (`"type": "module"`) falle en *runtime* (no al cargar el
 * paquete) si la dependencia opcional no está instalada, y de producir un
 * error propio (`SriError`) en vez de dejar escapar el
 * `ERR_MODULE_NOT_FOUND` crudo de Node.
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
