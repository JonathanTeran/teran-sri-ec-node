import { esRucLocalValido } from '../schemas/business-validator.js';

/**
 * Port de `Teran\Sri\Utils\RucValidator` (PHP). En PHP, `RucValidator::validate()`
 * combina una validación local (delegada a `BusinessValidator::validarRuc()`) con
 * una verificación opcional contra el servicio REST público del SRI.
 *
 * Aquí se exponen las dos mitades por separado en vez de un único `validate()`
 * (brief de Task 14):
 *  - {@link validarRucLocal} — el paso local, síncrono.
 *  - {@link validarRucOnline} — el paso local + la verificación online, con
 *    fallback al resultado local si la red falla (mismo criterio que PHP).
 *
 * Ver el reporte de la tarea (`task-14-report.md`) para el detalle de por qué
 * `validarRucOnline` no es un port línea-por-línea de `RucValidator::validate()`:
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

/**
 * Validación local de un RUC ecuatoriano de 13 dígitos. Port de
 * `BusinessValidator::validarRuc()` (llamado por `RucValidator::validate()`
 * como paso 1 en PHP) — reusa {@link esRucLocalValido} (Task 6) en vez de
 * duplicar el algoritmo: tercer dígito de régimen (0-6 o 9) + código de
 * establecimiento distinto de "000".
 *
 * Nota de fidelidad: el PHP original (y por tanto este port) NO implementa
 * módulo 10 (cédula), módulo 11 (RUC sociedades/públicas) ni validación de
 * código de provincia — pese a que esos algoritmos son el estándar de facto
 * para validar cédulas/RUC ecuatorianos, `BusinessValidator::validarRuc()`
 * solo hace las dos comprobaciones estructurales de arriba. Se preserva esa
 * looseness a propósito (paridad de comportamiento con el PHP fuente), no por
 * omisión — ver `task-14-report.md`.
 */
export function validarRucLocal(ruc: string): boolean {
  return esRucLocalValido(ruc);
}

/**
 * Resultado del chequeo HTTP contra el SRI. `null` significa "no concluyente"
 * (timeout, error de red, o HTTP != 200) — el caller debe hacer fallback a la
 * validación local en ese caso. `true`/`false` es la respuesta explícita del
 * servicio ("true"/"false" en el cuerpo, texto plano, tal como lo consume
 * `RucValidator::checkOnline()` en PHP con `$response === 'true'`).
 */
async function checkOnline(ruc: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${SRI_RUC_URL}${ruc}`, { signal: controller.signal });
    if (response.status !== 200) return null;

    const body = await response.text();
    return body === 'true';
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
 * rama muerta — ver `task-14-report.md` para el detalle.
 */
export async function validarRucOnline(ruc: string, opts: ValidarRucOnlineOptions = {}): Promise<boolean> {
  if (!validarRucLocal(ruc)) return false;

  const fetchImpl = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const online = await checkOnline(ruc, fetchImpl, timeoutMs);
  return online ?? true;
}
