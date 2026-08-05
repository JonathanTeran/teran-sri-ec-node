import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Regresión del hallazgo de revisión final: en CJS, `dist/ride/index.cjs`
 * inlineaba su propia copia de `SriError`/`ValidationError` en vez de
 * compartir la del core (`dist/index.cjs`) — esbuild no hace code-splitting
 * entre entry points en formato CJS (a diferencia de ESM, donde tsup sí
 * genera un chunk común, `dist/chunk-*.js`). El síntoma real: un consumidor
 * CommonJS que hace `const { SriError } = require('sri-ec')` y compara con
 * `instanceof` en un `catch` nunca coincidía con el error que lanzaba
 * `require('sri-ec/ride')`.
 *
 * El fix (`src/ride/*.ts` importa `SriError`/las utilidades de
 * `utils/money.ts` como `'sri-ec'` — auto-referencia al propio paquete,
 * marcada `external` en `tsup.config.ts`, ver la nota en `src/ride/deps.ts`)
 * solo se puede probar de verdad contra el ARTEFACTO YA COMPILADO: bajo
 * vitest, todo se ejecuta desde `src/` sin bundling (y con el alias de
 * `vitest.config.ts` que apunta `'sri-ec'` de vuelta a `src/index.ts` para
 * que el resto de la suite siga funcionando sin necesitar `dist/`
 * construido), así que ahí nunca hubo duplicación que reproducir.
 *
 * Por eso este test lanza dos procesos `node` totalmente aparte (uno para
 * cada formato de módulo, scripts en `test/fixtures/ride-instanceof-probe.*`)
 * que importan `dist/index.*` y `dist/ride/index.*` sin ningún alias de
 * test de por medio — exactamente como lo haría un consumidor real. Requiere
 * que `npm run build` haya corrido antes (igual que la CI: build →
 * typecheck → test); si `dist/` no existe (checkout fresco sin build), el
 * describe entero se salta con un motivo explícito en vez de fallar en rojo
 * por una precondición no relacionada con el bug que verifica.
 */
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const distIndexCjs = path.join(packageRoot, 'dist/index.cjs');
const distRideCjs = path.join(packageRoot, 'dist/ride/index.cjs');
const distIndexEsm = path.join(packageRoot, 'dist/index.js');
const distRideEsm = path.join(packageRoot, 'dist/ride/index.js');

const distArtifacts = [distIndexCjs, distRideCjs, distIndexEsm, distRideEsm];
const distBuilt = distArtifacts.every(existsSync);

function ejecutarProbe(script: string, coreDist: string, rideDist: string): string {
  return execFileSync(process.execPath, [script, coreDist, rideDist], {
    encoding: 'utf8',
    cwd: packageRoot,
  }).trim();
}

describe.skipIf(!distBuilt)(
  'ride: instanceof SriError contra dist/ ya construido (regresión CJS/ESM)',
  () => {
    it('CJS: require("sri-ec/ride") lanza un error instanceof el SriError de require("sri-ec")', () => {
      const script = path.join(packageRoot, 'test/fixtures/ride-instanceof-probe.cjs');
      expect(ejecutarProbe(script, distIndexCjs, distRideCjs)).toBe('PASS');
    });

    it('ESM: import("sri-ec/ride") lanza un error instanceof el SriError de import("sri-ec")', () => {
      const script = path.join(packageRoot, 'test/fixtures/ride-instanceof-probe.mjs');
      expect(ejecutarProbe(script, distIndexEsm, distRideEsm)).toBe('PASS');
    });
  },
);

if (!distBuilt) {
  // `describe.skipIf` no imprime motivo — este `it.skip` explícito sí deja
  // rastro legible en la salida de `vitest run` de por qué no se ejecutó.
  it.skip(
    `ride: instanceof SriError contra dist/ (saltado: falta ejecutar "npm run build" — no existen ${distArtifacts
      .filter((p) => !existsSync(p))
      .map((p) => path.relative(packageRoot, p))
      .join(', ')})`,
    () => {},
  );
}
