/**
 * Código de barras **Code 128** dibujado con rectángulos de pdfkit.
 *
 * El Anexo 2 de la Ficha Técnica del SRI imprime, bajo el rótulo `CLAVE DE
 * ACCESO`, un código de barras con los 49 dígitos repetidos debajo (la nota al
 * pie de la página 56 aclara que es opcional — de ahí
 * `OpcionesFormatoRide.codigoBarras`). El simbolismo que usa el SRI es Code
 * 128; no es un QR (el QR del RIDE v0.2.0 no está en la especificación, se
 * conserva solo como alternativa vía `incluirQr`).
 *
 * **Por qué a mano y no con una dependencia** (`bwip-js`, `jsbarcode`, ...):
 * `pdfkit` y `qrcode` ya son `peerDependencies` opcionales que el consumidor
 * tiene que instalar a mano (ver `deps.ts`), y cada dependencia nueva es una
 * entrada más en esa lista y en la superficie de suministro del paquete. Code
 * 128 es, en total, una tabla de 107 patrones, un checksum módulo 103 y una
 * conmutación B/C — todo síncrono, sin assets ni binarios. La salida además es
 * *vectorial* (rectángulos en el propio PDF), no un PNG rasterizado que
 * `doc.image` tendría que reescalar: se imprime nítido a cualquier resolución,
 * que es justo lo que un código de barras necesita para ser escaneable.
 *
 * La corrección de la tabla no se toma por fe: {@link PATRONES} cumple una
 * invariante estructural que el test verifica (los 106 primeros patrones miden
 * 11 módulos en 6 elementos, el de parada 13 en 7), y el test también decodifica
 * el patrón generado y comprueba que recupera el texto original.
 */

/**
 * Patrones de Code 128, indexados por valor de símbolo (0..106). Cada carácter
 * de la cadena es el ancho en módulos de un elemento, alternando
 * barra/espacio empezando por barra. Los valores 103/104/105 son START A/B/C y
 * el 106 es la parada (7 elementos, 13 módulos: incluye la barra final doble).
 */
const PATRONES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const;

/** Valor de símbolo de START B (juego de caracteres ASCII imprimible completo). */
const START_B = 104;
/** Valor de símbolo de START C (pares de dígitos, dos por símbolo). */
const START_C = 105;
/** Valor de símbolo de la parada. */
const STOP = 106;
/** Conmutar a Code C estando en Code B. */
const CAMBIO_A_C = 99;
/** Módulos de zona muda a cada lado del símbolo (mínimo 10 según la norma). */
export const MODULOS_ZONA_MUDA = 10;

/**
 * Valores de símbolo de `texto`, SIN el checksum ni la parada.
 *
 * Dos caminos, ambos válidos para cualquier lector:
 * - **Solo dígitos** (el caso real del RIDE: la clave de acceso son 49
 *   dígitos): Code C, que empaqueta dos dígitos por símbolo y casi divide a la
 *   mitad el ancho impreso. Con una cantidad impar de dígitos —49 lo es— el
 *   primero se codifica en Code B y se conmuta a C para el resto, que ya es
 *   par; codificar los 49 en Code B daría un símbolo ~1.8x más ancho.
 * - **Cualquier otro texto**: Code B carácter a carácter (ASCII 32..126).
 *
 * @throws RangeError si `texto` está vacío o trae un carácter fuera de ASCII
 * imprimible — no hay forma de representarlo y devolver un símbolo truncado
 * produciría un código de barras que escanea *algo distinto* de lo impreso
 * debajo, que es peor que no imprimirlo.
 */
export function valoresCode128(texto: string): number[] {
  if (texto === '') {
    throw new RangeError('Code 128: el texto a codificar no puede estar vacío.');
  }

  if (/^\d+$/.test(texto)) {
    const impar = texto.length % 2 === 1;
    const valores: number[] = impar ? [START_B, texto.charCodeAt(0) - 32, CAMBIO_A_C] : [START_C];
    for (let i = impar ? 1 : 0; i < texto.length; i += 2) {
      valores.push(Number(texto.slice(i, i + 2)));
    }
    return valores;
  }

  const valores: number[] = [START_B];
  for (const caracter of texto) {
    const codigo = caracter.charCodeAt(0);
    if (codigo < 32 || codigo > 126) {
      throw new RangeError(`Code 128: carácter no representable en Code B: ${JSON.stringify(caracter)}.`);
    }
    valores.push(codigo - 32);
  }
  return valores;
}

/**
 * Anchos de elemento (en módulos) del símbolo completo de `texto`: START,
 * datos, checksum y parada. El elemento de índice par es barra; el impar,
 * espacio (todo patrón de la tabla empieza por barra y mide un número par de
 * elementos salvo la parada, así que la alternancia se conserva al
 * concatenarlos).
 */
export function patronCode128(texto: string): number[] {
  const valores = valoresCode128(texto);

  // Checksum: valor de START + Σ (posición 1-based × valor), módulo 103.
  let suma = valores[0];
  for (let i = 1; i < valores.length; i++) {
    suma += i * valores[i];
  }
  valores.push(suma % 103, STOP);

  const modulos: number[] = [];
  for (const valor of valores) {
    for (const ancho of PATRONES[valor]) {
      modulos.push(Number(ancho));
    }
  }
  return modulos;
}

/** Módulos totales de `texto`, zonas mudas incluidas — para repartir el ancho disponible. */
export function anchoEnModulos(texto: string): number {
  return patronCode128(texto).reduce((a, b) => a + b, 0) + MODULOS_ZONA_MUDA * 2;
}

/** Rectángulo donde encajar el código de barras. */
export interface AreaCodigoBarras {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

/**
 * Dibuja el símbolo de `texto` centrado en `area`, como rectángulos rellenos
 * (solo las barras; los espacios son el papel). El ancho de módulo sale de
 * repartir `area.ancho` entre {@link anchoEnModulos}, así que el símbolo
 * ocupa exactamente el ancho pedido, zonas mudas incluidas.
 *
 * Todos los rectángulos tienen ancho y alto estrictamente positivos: el test
 * de geometría de `ride-layout.test.ts` recorre TODOS los `OPS.rectangle` del
 * PDF y falla ante cualquiera de alto o ancho no positivo.
 */
export function dibujarCode128(doc: PDFKit.PDFDocument, texto: string, area: AreaCodigoBarras): void {
  const modulos = patronCode128(texto);
  const anchoModulo = area.ancho / (modulos.reduce((a, b) => a + b, 0) + MODULOS_ZONA_MUDA * 2);

  doc.save().fillColor('#000000');
  let x = area.x + MODULOS_ZONA_MUDA * anchoModulo;
  for (let i = 0; i < modulos.length; i++) {
    const ancho = modulos[i] * anchoModulo;
    // Índice par = barra (oscura); impar = espacio, que no se dibuja.
    if (i % 2 === 0) {
      doc.rect(x, area.y, ancho, area.alto).fill();
    }
    x += ancho;
  }
  doc.restore();
}
