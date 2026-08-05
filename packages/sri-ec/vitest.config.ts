import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      /**
       * `src/ride/*.ts` importa símbolos del core por auto-referencia
       * (`import { SriError } from 'sri-ec'`, ver `tsup.config.ts` y la nota
       * en `src/ride/deps.ts`) para que `dist/ride/index.cjs` no incluya su
       * propia copia de `SriError`/`ValidationError`/las utilidades de
       * `utils/money.ts` — así `instanceof` funciona también en CJS.
       *
       * Sin este alias, vitest resolvería `'sri-ec'` como haría Node en el
       * paquete publicado: vía el symlink de npm workspaces
       * (`node_modules/sri-ec` → `packages/sri-ec`) y el campo `exports` de
       * `package.json`, que apunta a `dist/index.js` — el build YA
       * compilado, una evaluación de módulo totalmente distinta a la que
       * usa el resto de la suite (que importa el código fuente en
       * `src/` directamente). Eso rompería `instanceof` DENTRO de los tests
       * (un `SriError` de `dist/` no es el mismo que uno de `src/`) y además
       * obligaría a correr `npm run build` antes de `vitest run`. El alias
       * apunta `'sri-ec'` de vuelta a `src/index.ts` para que, en tests,
       * todo el código (ride incluido) comparta el mismo grafo de módulos
       * fuente — la verificación real de que el bundle *publicado* no
       * duplica las clases se hace aparte, contra el tarball empaquetado
       * (`npm pack` + instalación en un proyecto externo, en ambos formatos
       * de módulo).
       */
      'sri-ec': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
});
