import { ValidationError } from '../errors/index.js';

/**
 * Utilidades de montos decimal-seguros (port simplificado de
 * `src/Money/Money.php`, que usa `bcmath`). En vez de operar sobre strings
 * decimales con una librería de precisión arbitraria, este módulo convierte
 * el monto a centavos (`bigint` internamente) y de vuelta — la aritmética de
 * negocio en el resto del paquete debe operar en enteros de centavos, nunca
 * en `number` de punto flotante.
 */

/** Acepta enteros o decimales no negativos de hasta 6 decimales (escala interna de `Money.php`). */
const MONTO_PATTERN = /^\d+(\.\d{1,6})?$/;

/** `true` si `s` es un monto válido: `/^\d+(\.\d{1,6})?$/`. */
export function isMonto(s: string): boolean {
  return MONTO_PATTERN.test(s);
}

/**
 * Convierte un monto decimal (string, hasta 6 decimales) a centavos enteros,
 * redondeando half-up al segundo decimal — igual que `Money::format()` en
 * PHP, que sólo suma el delta de redondeo (`0.005`) antes de truncar.
 *
 * @throws ValidationError si `monto` no matchea `isMonto`.
 */
export function toCents(monto: string): number {
  if (!isMonto(monto)) {
    throw new ValidationError(`Monto inválido: '${monto}'`, [
      `Monto inválido: '${monto}'. Debe ser un número no negativo con hasta 6 decimales.`,
    ]);
  }

  const [intPart, fracPart = ''] = monto.split('.');
  // Normaliza a 6 decimales (escala interna) rellenando con ceros a la derecha.
  const fracPadded = fracPart.padEnd(6, '0');
  // Valor total en "micro-unidades" (escala 1e-6), para no perder precisión.
  const totalMicro = BigInt(intPart) * 1_000_000n + BigInt(fracPadded);
  // 1 centavo = 10_000 micro-unidades (escala 6 → escala 2 son 4 dígitos de diferencia).
  // Half-up: sumar medio centavo (5_000 micro-unidades) antes de truncar por división entera.
  const cents = (totalMicro + 5_000n) / 10_000n;

  return Number(cents);
}

/** Convierte centavos enteros a un monto decimal string con 2 decimales, p.ej. `11200 -> '112.00'`. */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absCents = Math.abs(cents);
  const intPart = Math.floor(absCents / 100);
  const centPart = absCents % 100;

  return `${sign}${intPart}.${centPart.toString().padStart(2, '0')}`;
}
