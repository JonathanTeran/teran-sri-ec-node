import { cargarQrcode } from './deps.js';

/** Tamaño en puntos PDF del QR por defecto (lado del cuadrado, antes de dibujarlo con `doc.image`). */
const QR_WIDTH_DEFAULT = 300;

/**
 * Genera el PNG del código QR que codifica `texto` (la clave de acceso de 49
 * dígitos: es lo único que el portal del SRI necesita para verificar el
 * comprobante). Devuelve el buffer PNG listo para `doc.image()` de pdfkit.
 *
 * `width: 300` (más grande que el tamaño final en el PDF) porque
 * `doc.image()` reescala hacia abajo con buena calidad; escalar hacia
 * arriba un QR pequeño sí degrada la nitidez de los módulos.
 */
export async function generarQr(texto: string, width: number = QR_WIDTH_DEFAULT): Promise<Buffer> {
  const QRCode = await cargarQrcode();
  return QRCode.toBuffer(texto, { type: 'png', margin: 1, width });
}
