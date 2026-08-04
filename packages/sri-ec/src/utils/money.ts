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
      'Debe ser un número no negativo con hasta 6 decimales.',
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

/**
 * Formatea `monto` a `decimals` decimales con redondeo half-up — port
 * generalizado de `Money::format(int $decimals)` en PHP (que opera sobre un
 * `Money` interno a escala 6). A diferencia de `toCents`/`fromCents` (fijos
 * a escala 2, pensados para aritmética de negocio en centavos), esta
 * función soporta cualquier escala hasta 6 decimales: la usan los
 * serializadores XML (`xml/*.serializer.ts`) para formatear tanto montos
 * (escala 2) como cantidades/precios unitarios (escala 6), replicando
 * campo a campo `FacturaXmlSerializer::detalles()` y equivalentes — sin
 * asumir que el string de entrada ya viene con la escala exacta esperada.
 *
 * @throws ValidationError si `monto` no matchea `isMonto`.
 */
export function formatMonto(monto: string, decimals: number): string {
  if (!isMonto(monto)) {
    throw new ValidationError(`Monto inválido: '${monto}'`, [
      'Debe ser un número no negativo con hasta 6 decimales.',
    ]);
  }

  const [intPart, fracPart = ''] = monto.split('.');
  // Escala de trabajo: al menos `decimals`, y al menos tantos dígitos como
  // traiga el string de entrada, para no perder precisión antes de redondear.
  const workScale = Math.max(decimals, fracPart.length);
  const fracPadded = fracPart.padEnd(workScale, '0');
  const totalMicro = BigInt(intPart) * 10n ** BigInt(workScale) + BigInt(fracPadded || '0');

  // Reduce de `workScale` a `decimals` con redondeo half-up (suma medio
  // divisor antes de la división entera), igual que el delta de redondeo de
  // `Money::format()`.
  const divisor = 10n ** BigInt(workScale - decimals);
  const half = divisor / 2n;
  const rounded = (totalMicro + half) / divisor;

  const roundedStr = rounded.toString().padStart(decimals + 1, '0');
  const cut = roundedStr.length - decimals;
  const intOut = roundedStr.slice(0, cut);
  const fracOut = roundedStr.slice(cut);

  return decimals > 0 ? `${intOut}.${fracOut}` : intOut;
}
