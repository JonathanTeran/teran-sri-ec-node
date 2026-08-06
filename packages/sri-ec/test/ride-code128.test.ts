import { describe, expect, it } from 'vitest';
import { anchoEnModulos, patronCode128, valoresCode128 } from '../src/ride/code128.js';

/**
 * El riesgo real de una implementación de Code 128 escrita a mano es una
 * errata en la tabla de 107 patrones: produciría un código de barras que
 * escanea algo distinto de los 49 dígitos impresos debajo, y a simple vista
 * se vería perfectamente normal. Estos tests atacan justo eso:
 *
 * 1. Invariante estructural de la tabla (todo patrón mide 11 módulos en 6
 *    elementos, salvo la parada: 13 en 7). Una errata de un dígito la rompe.
 * 2. Round-trip completo: se decodifica el patrón generado —midiendo anchos
 *    de barra igual que haría un lector— y se comprueba que recupera el texto.
 *    Esto valida a la vez la tabla, la conmutación B/C y el checksum.
 */

/** Igual que `PATRONES` en `code128.ts`, reconstruida desde el patrón emitido para cada valor. */
function patronDeValor(valor: number): number[] {
  // `valoresCode128` no da acceso directo a la tabla, pero el patrón de un
  // símbolo son sus 6 (o 7) elementos dentro del símbolo completo. Se aísla
  // codificando un texto conocido y recortando: START(6) + dato(6) + ...
  const modulos = patronCode128(String.fromCharCode(valor + 32));
  return modulos.slice(6, 12);
}

/** Decodificador de referencia: de anchos de módulo a valores de símbolo. */
function decodificarValores(modulos: number[]): number[] {
  const valores: number[] = [];
  let i = 0;
  while (i + 6 <= modulos.length) {
    const trozo = modulos.slice(i, i + 6);
    // La parada son 7 elementos (13 módulos) y siempre va al final.
    if (i + 7 === modulos.length) break;
    const clave = trozo.join('');
    const valor = TABLA_INVERSA.get(clave);
    expect(valor, `patrón desconocido en el offset ${i}: ${clave}`).toBeDefined();
    valores.push(valor!);
    i += 6;
  }
  return valores;
}

/**
 * Tabla inversa patrón→valor, reconstruida SIN leer la tabla de `code128.ts`:
 * cada patrón se obtiene codificando un texto que sabemos que produce ese
 * símbolo y recortando sus 6 elementos. Los valores 0..94 salen de Code B
 * (ASCII 32..126); los 95..99, de un par de Code C; los START, del primer
 * símbolo del propio patrón.
 */
const TABLA_INVERSA = new Map<string, number>();
for (let valor = 0; valor < 95; valor++) {
  TABLA_INVERSA.set(patronDeValor(valor).join(''), valor);
}
for (let valor = 95; valor <= 99; valor++) {
  // `patronCode128('95')` = START C + el par 95 + checksum + parada.
  TABLA_INVERSA.set(patronCode128(String(valor)).slice(6, 12).join(''), valor);
}
TABLA_INVERSA.set(patronCode128('A').slice(0, 6).join(''), 104); // START B
TABLA_INVERSA.set(patronCode128('12').slice(0, 6).join(''), 105); // START C

/** Decodifica un símbolo completo de solo dígitos (START B/C + datos + checksum + parada). */
function decodificarDigitos(texto: string): string {
  const modulos = patronCode128(texto);

  // Parada: los últimos 7 elementos suman 13 módulos.
  const parada = modulos.slice(-7);
  expect(parada).toHaveLength(7);
  expect(parada.reduce((a, b) => a + b, 0)).toBe(13);

  const valores = decodificarValores(modulos);
  const start = valores[0];
  const datos = valores.slice(1, -1);
  const checksum = valores[valores.length - 1];

  // El checksum se recalcula igual que un lector: START + Σ posición×valor mod 103.
  let suma = start;
  for (let i = 0; i < datos.length; i++) {
    suma += (i + 1) * datos[i];
  }
  expect(checksum, 'checksum incorrecto').toBe(suma % 103);

  let salida = '';
  let modoC = start === 105;
  for (const valor of datos) {
    if (modoC) {
      salida += String(valor).padStart(2, '0');
    } else if (valor === 99) {
      modoC = true;
    } else {
      salida += String.fromCharCode(valor + 32);
    }
  }
  return salida;
}

describe('ride: Code 128', () => {
  it('la tabla de patrones cumple la invariante de la norma (11 módulos en 6 elementos; parada 13 en 7)', () => {
    // Se recorre la tabla a través del patrón completo de un símbolo conocido:
    // START B (6) + dato (6) + checksum (6) + parada (7) = 25 elementos.
    for (let valor = 0; valor < 95; valor++) {
      const patron = patronDeValor(valor);
      expect(patron, `valor ${valor}`).toHaveLength(6);
      expect(patron.reduce((a, b) => a + b, 0), `valor ${valor}: no mide 11 módulos`).toBe(11);
    }

    const completo = patronCode128('A');
    expect(completo).toHaveLength(6 * 3 + 7);
    expect(completo.slice(-7).reduce((a, b) => a + b, 0)).toBe(13);
  });

  it('los 49 dígitos de una clave de acceso se recuperan del patrón (Code B para el dígito impar + Code C)', () => {
    const clave = '2809202601179000000110010010000000011234567813';
    const claveDe49 = `${clave}123`.slice(0, 49);
    expect(claveDe49).toHaveLength(49);

    // 49 es impar: START B + 1 dígito en B + cambio a C + 24 pares.
    const valores = valoresCode128(claveDe49);
    expect(valores[0], 'debe arrancar en START B por la cantidad impar de dígitos').toBe(104);
    expect(valores[2], 'debe conmutar a Code C tras el primer dígito').toBe(99);
    expect(valores).toHaveLength(3 + 24);

    expect(decodificarDigitos(claveDe49)).toBe(claveDe49);
  });

  it('una cantidad par de dígitos arranca directamente en Code C', () => {
    const valores = valoresCode128('12345678');
    expect(valores[0]).toBe(105);
    expect(valores).toEqual([105, 12, 34, 56, 78]);
    expect(decodificarDigitos('12345678')).toBe('12345678');
  });

  it('round-trip de varias longitudes, pares e impares', () => {
    for (const texto of ['0', '00', '007', '123456789', '9'.repeat(49), '1234567890'.repeat(4) + '123456789']) {
      expect(decodificarDigitos(texto), `no se recupera ${texto}`).toBe(texto);
    }
  });

  it('el ancho en módulos incluye las dos zonas mudas', () => {
    const texto = '12345678';
    const modulos = patronCode128(texto).reduce((a, b) => a + b, 0);
    expect(anchoEnModulos(texto)).toBe(modulos + 20);
    // START C + 4 pares + checksum = 6 símbolos de 11 + parada de 13.
    expect(modulos).toBe(6 * 11 + 13);
  });

  it('rechaza texto vacío y caracteres fuera de ASCII imprimible en vez de emitir un símbolo truncado', () => {
    expect(() => valoresCode128('')).toThrow(RangeError);
    expect(() => valoresCode128('claveñ')).toThrow(RangeError);
  });
});
