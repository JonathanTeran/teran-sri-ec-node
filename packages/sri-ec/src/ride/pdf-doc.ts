import { cargarPdfkit } from './deps.js';
import type { TamanoPaginaRide } from './types.js';

/** Margen uniforme de página, en puntos PDF (1 pt = 1/72"). */
const MARGEN = 36;

/**
 * Documento RIDE en construcción: `doc` es la instancia de pdfkit que los
 * `draw*` de `blocks.ts` reciben para dibujar; `finalizar()` cierra el
 * stream y resuelve con los bytes completos del PDF.
 *
 * Separar "crear" de "finalizar" (en vez de que `crearDocumentoRide` ya
 * devuelva la promesa de bytes) es lo que le permite a cada `*.ride.ts`
 * dibujar el cuerpo específico del documento entre ambos pasos sin que este
 * módulo necesite conocer ningún tipo de `Comprobante`.
 */
export interface DocumentoRide {
  doc: PDFKit.PDFDocument;
  /** Cierra el documento (`doc.end()`) y resuelve con los bytes del PDF completo. */
  finalizar: () => Promise<Uint8Array>;
}

/**
 * Crea un `PDFDocument` en memoria (sin escribir a disco: el plan exige que
 * la librería nunca toque el filesystem) y engancha la recolección de sus
 * chunks de salida.
 *
 * @throws SriError con `code: 'RIDE_MISSING_DEPENDENCY'` si `pdfkit` no está instalado.
 */
export async function crearDocumentoRide(tamano: TamanoPaginaRide = 'A4'): Promise<DocumentoRide> {
  const PDFDocumentCtor = await cargarPdfkit();
  const doc = new PDFDocumentCtor({
    size: tamano,
    margin: MARGEN,
    bufferPages: true,
    autoFirstPage: true,
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const bytesListos = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on('error', (error: unknown) => reject(error));
  });

  return {
    doc,
    finalizar: async () => {
      doc.end();
      return bytesListos;
    },
  };
}
