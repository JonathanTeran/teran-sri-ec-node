import { esRucLocalValido } from '../schemas/business-validator.js';

/**
 * Port de `Teran\Sri\Utils\RucValidator` (PHP). En PHP, `RucValidator::validate()`
 * combina una validación local (delegada a `BusinessValidator::validarRuc()`) con
 * una verificación opcional contra el servicio REST público del SRI.
 *
 * Aquí se exponen las dos mitades por separado en vez de un único `validate()`
 * (brief de Task 14):
 *  - {@link validarRucLocal} — el paso local, síncrono. Por defecto reproduce
 *    exactamente la (deliberada) looseness de `BusinessValidator::validarRuc()`
 *    en PHP (sin módulo 10/11 ni provincia); `opts.checksum = true` añade,
 *    de forma aditiva y opt-in, el algoritmo real ecuatoriano vía
 *    {@link validarRucChecksum} (fix round 1).
 *  - {@link validarRucOnline} — el paso local + la verificación online, con
 *    fallback al resultado local si la red falla (mismo criterio que PHP).
 *
 * Nota de fidelidad: `validarRucOnline` no es un port línea-por-línea de
 * `RucValidator::validate()`:
 * el PHP original tiene una rama muerta (el resultado de `checkOnline()` nunca
 * afecta el valor de retorno) que aquí se corrige para que el chequeo online
 * cumpla el propósito descrito en sus propios comentarios.
 */

/** URL del servicio REST del SRI usado por `RucValidator::checkOnline()` (PHP). */
export const SRI_RUC_URL =
  'https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/ConsolidadoContribuyente/existePorNumeroRuc?numeroRuc=';

/** Timeout por defecto del chequeo online, en milisegundos (3000 == `CURLOPT_TIMEOUT, 3` en PHP, que está en segundos). */
const DEFAULT_TIMEOUT_MS = 3_000;

export interface ValidarRucOnlineOptions {
  /** `fetch` a usar — inyectable para tests (mock) o runtimes sin `fetch` global. Por defecto `fetch` global. */
  fetch?: typeof fetch;
  /** Timeout de la llamada HTTP, en milisegundos. Por defecto {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export interface ValidarRucLocalOptions {
  /**
   * `false` (por defecto): comportamiento PHP-compatible — solo tercer dígito
   * de régimen + establecimiento != "000" (la looseness de
   * `BusinessValidator::validarRuc()`, preservada a propósito porque
   * `validarRucLocal` es la base de la que dependen `schemas/*` y
   * `business-validator.ts` en todo el paquete; cambiar el default rompería
   * paridad con el PHP fuente para todo consumidor existente).
   *
   * `true`: además exige que {@link validarRucChecksum} pase (módulo 10/11 +
   * provincia real) — validación *estricta*, opt-in, aditiva. No existe en el
   * PHP fuente; es una extensión de este port (fix round 1).
   */
  checksum?: boolean;
}

/**
 * Validación local de un RUC ecuatoriano de 13 dígitos. Port de
 * `BusinessValidator::validarRuc()` (llamado por `RucValidator::validate()`
 * como paso 1 en PHP) — reusa {@link esRucLocalValido} (Task 6) en vez de
 * duplicar el algoritmo: tercer dígito de régimen (0-6 o 9) + código de
 * establecimiento distinto de "000".
 *
 * Nota de fidelidad: el PHP original (y por tanto el comportamiento por
 * defecto de esta función) NO implementa módulo 10 (cédula), módulo 11 (RUC
 * sociedades/públicas) ni validación de código de provincia — pese a que esos
 * algoritmos son el estándar de facto para validar cédulas/RUC ecuatorianos,
 * `BusinessValidator::validarRuc()` solo hace las dos comprobaciones
 * estructurales de arriba. Se preserva esa looseness a propósito por defecto
 * (paridad de comportamiento con el PHP fuente — de la que dependen
 * `schemas/*.schema.ts` y `business-validator.ts` en todo el paquete), no por
 * omisión.
 *
 * `opts.checksum = true` aplica, ADEMÁS, el algoritmo real ecuatoriano
 * ({@link validarRucChecksum}: módulo 10/11 según el tipo de contribuyente +
 * código de provincia) — validación estricta, opt-in, que no cambia el
 * comportamiento por defecto de ningún caller existente.
 */
export function validarRucLocal(ruc: string, opts: ValidarRucLocalOptions = {}): boolean {
  if (!esRucLocalValido(ruc)) return false;
  if (opts.checksum && !validarRucChecksum(ruc)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// validarRucChecksum — algoritmo real ecuatoriano de validación de RUC
// (módulo 10 para cédula/persona natural, módulo 11 para sociedades públicas
// y privadas, + código de provincia). NO existe en el PHP fuente
// (`BusinessValidator::validarRuc()` no lo implementa, confirmado por
// inspección exhaustiva del PHP fuente); es una extensión aditiva
// de este port, expuesta como función independiente y como opt-in de
// `validarRucLocal` (fix round 1).
// ---------------------------------------------------------------------------

/** Códigos de provincia válidos: 01-24 (división política) + 30 (exterior). */
const PROVINCIAS_VALIDAS = new Set<string>([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '30',
]);

/** Coeficientes módulo 11 — entidades públicas (tercer dígito 6), sobre los primeros 8 dígitos. */
const COEFICIENTES_PUBLICA = [3, 2, 7, 6, 5, 4, 3, 2];

/** Coeficientes módulo 11 — sociedades privadas/extranjeras (tercer dígito 9), sobre los primeros 9 dígitos. */
const COEFICIENTES_SOCIEDAD = [4, 3, 2, 7, 6, 5, 4, 3, 2];

/**
 * Dígito verificador módulo 10 (persona natural / cédula). Coeficientes
 * `2,1,2,1,2,1,2,1,2` sobre los primeros 9 dígitos; si el producto de un
 * dígito por su coeficiente es >= 10, se resta 9 (equivalente a sumar los
 * dígitos del producto, ya que el coeficiente es 1 o 2 y el dígito 0-9: el
 * único caso >= 10 es dígito*2 con dígito >= 5, producto de dos cifras "ab"
 * cuya suma de cifras es siempre producto - 9).
 */
function digitoVerificadorNatural(nueveDigitos: string): number {
  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let producto = Number(nueveDigitos[i]) * coeficientes[i];
    if (producto >= 10) producto -= 9;
    suma += producto;
  }
  const resto = suma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

/** Dígito verificador módulo 11 genérico (públicas/sociedades), dado el prefijo y los coeficientes correspondientes. */
function digitoVerificadorModulo11(prefijo: string, coeficientes: readonly number[]): number {
  let suma = 0;
  for (let i = 0; i < coeficientes.length; i++) {
    suma += Number(prefijo[i]) * coeficientes[i];
  }
  const resto = suma % 11;
  return resto === 0 ? 0 : 11 - resto;
}

/**
 * Validación *estricta* de un RUC ecuatoriano: el algoritmo real usado por el
 * SRI (módulo 10/11 según el tipo de contribuyente, deducido del tercer
 * dígito) + código de provincia. A diferencia de {@link validarRucLocal}
 * (looseness PHP-compatible por defecto), esta función SIEMPRE aplica el
 * algoritmo completo — no tiene modo "loose".
 *
 * Reglas por tipo (tercer dígito del RUC):
 *  - `0-5` (persona natural): módulo 10 sobre los primeros 9 dígitos
 *    (coeficientes `2,1,2,1,2,1,2,1,2`), dígito verificador en la posición 10
 *    (índice 9); establecimiento = últimos 3 dígitos, no puede ser `"000"`.
 *  - `6` (entidad pública): módulo 11 sobre los primeros 8 dígitos
 *    (coeficientes `3,2,7,6,5,4,3,2`), dígito verificador en la posición 9
 *    (índice 8); establecimiento = últimos 4 dígitos, no puede ser `"0000"`.
 *  - `9` (sociedad privada/extranjera): módulo 11 sobre los primeros 9
 *    dígitos (coeficientes `4,3,2,7,6,5,4,3,2`), dígito verificador en la
 *    posición 10 (índice 9); establecimiento = últimos 3 dígitos, no puede
 *    ser `"000"`.
 *  - Cualquier otro tercer dígito (7, 8): no existe en el catálogo del SRI →
 *    inválido.
 *
 * En todos los casos, los primeros 2 dígitos deben ser un código de
 * provincia válido (`01`-`24`, o `30` para "exterior").
 *
 * Nota sobre la especificación de sociedades privadas: la ronda de fix que
 * originó esta función describía, para sociedades, "coeficientes
 * `4,3,2,7,6,5,4,3` sobre los primeros 8 dígitos, dígito verificador en la
 * posición 9, establecimiento `'001'`" — esa combinación es aritméticamente
 * inconsistente (8 + 1 + 3 = 12 dígitos, no 13; sobra un dígito sin cubrir
 * por ninguna regla). Se implementó en su lugar el algoritmo estándar
 * ampliamente documentado y usado en validadores de RUC ecuatoriano
 * (9 coeficientes, verificador en la posición 10, establecimiento de 3
 * dígitos = 9 + 1 + 3 = 13 dígitos, consistente y simétrico con el patrón de
 * "públicas" salvo por el ancho del establecimiento).
 */
export function validarRucChecksum(ruc: string): boolean {
  if (!/^\d{13}$/.test(ruc)) return false;
  if (!PROVINCIAS_VALIDAS.has(ruc.slice(0, 2))) return false;

  const tercerDigito = Number(ruc[2]);

  if (tercerDigito >= 0 && tercerDigito <= 5) {
    if (ruc.slice(10, 13) === '000') return false;
    return digitoVerificadorNatural(ruc.slice(0, 9)) === Number(ruc[9]);
  }

  if (tercerDigito === 6) {
    if (ruc.slice(9, 13) === '0000') return false;
    return digitoVerificadorModulo11(ruc.slice(0, 8), COEFICIENTES_PUBLICA) === Number(ruc[8]);
  }

  if (tercerDigito === 9) {
    if (ruc.slice(10, 13) === '000') return false;
    return digitoVerificadorModulo11(ruc.slice(0, 9), COEFICIENTES_SOCIEDAD) === Number(ruc[9]);
  }

  return false;
}

/**
 * Resultado del chequeo HTTP contra el SRI. `null` significa "no concluyente"
 * (timeout, error de red, HTTP != 200, o un cuerpo HTTP 200 que no es
 * exactamente `"true"`/`"false"` una vez recortado — p. ej. un proxy/CDN que
 * agrega espacio en blanco, o una página de error HTML servida con status
 * 200) — el caller debe hacer fallback a la validación local en ese caso.
 * `true`/`false` es la respuesta explícita del servicio ("true"/"false" en el
 * cuerpo, texto plano, tal como lo consume `RucValidator::checkOnline()` en
 * PHP con `$response === 'true'`, aquí con `.trim()` para no rechazar en
 * falso por espacio en blanco incidental que el PHP original tampoco
 * contemplaba — fix round 1).
 */
async function checkOnline(ruc: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${SRI_RUC_URL}${ruc}`, { signal: controller.signal });
    if (response.status !== 200) return null;

    const body = (await response.text()).trim();
    if (body === 'true') return true;
    if (body === 'false') return false;
    return null; // cuerpo inesperado → inconcluso → fallback local
  } catch {
    // Red caída, timeout (AbortError) o cualquier otro fallo de fetch: no concluyente.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validación de un RUC combinando el chequeo local ({@link validarRucLocal})
 * con una verificación contra el servicio REST del SRI ({@link SRI_RUC_URL}).
 * Port funcional de `RucValidator::validate()` (PHP):
 *
 *  1. Si el RUC no pasa la validación local, se rechaza sin llamar a la red.
 *  2. Si pasa, se intenta la verificación online. Un fallo de red/timeout/HTTP
 *     no-200 hace fallback al resultado local (que ya es `true`) — mismo
 *     criterio que el comentario `// 3. Si la validación online falla pero la
 *     local pasó, aceptamos el RUC` de `RucValidator.php`.
 *  3. Si la red responde de forma concluyente (HTTP 200 con cuerpo `"true"` o
 *     `"false"`), esa respuesta decide el resultado final.
 *
 * Nunca lanza: cualquier error de `fetch` se trata como "no concluyente" (ver
 * paso 2).
 *
 * Divergencia deliberada de la fuente PHP: en `RucValidator::validate()`, el
 * `if ($this->checkOnline($ruc)) { return true; } return true;` hace que el
 * resultado de `checkOnline()` NUNCA se use — ambas ramas devuelven `true`,
 * así que un RUC local-válido siempre pasa `validate()` sin importar lo que
 * diga el SRI (incluida una respuesta explícita `"false"`). Es, con alta
 * probabilidad, un bug de la fuente: el comentario "1. si falla usamos la
 * validación local" documenta claramente la intención de un fallback
 * *ante fallo*, no de ignorar una respuesta negativa explícita. Este port
 * implementa la intención documentada (paso 3 arriba) en vez de replicar la
 * rama muerta.
 */
export async function validarRucOnline(ruc: string, opts: ValidarRucOnlineOptions = {}): Promise<boolean> {
  if (!validarRucLocal(ruc)) return false;

  const fetchImpl = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const online = await checkOnline(ruc, fetchImpl, timeoutMs);
  return online ?? true;
}
