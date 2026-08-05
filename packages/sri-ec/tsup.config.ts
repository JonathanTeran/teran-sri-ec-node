import { defineConfig } from 'tsup';

/**
 * Dos entradas de build: `src/index.ts` (el core, sin `pdfkit`/`qrcode` en
 * el grafo de imports) y `src/ride/index.ts` (el subpath opcional
 * `sri-ec/ride`, ver `package.json` → `exports`). tsup emite un archivo por
 * entrada (`dist/index.*`, `dist/ride/index.*`) porque `entry` es un objeto
 * con nombres explícitos — así el subpath queda en `dist/ride/` en vez de
 * mezclarse con el core en `dist/`.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'ride/index': 'src/ride/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  /**
   * `src/ride/*.ts` importa símbolos del core (p.ej. `SriError`) por el
   * nombre del propio paquete (`import { SriError } from 'sri-ec'`) en vez
   * de por ruta relativa — ver la nota en `src/ride/deps.ts`. Sin marcar
   * `'sri-ec'` como `external`, esbuild trataría esa auto-referencia como
   * una dependencia externa normal e intentaría inlinearla, duplicando en
   * `dist/ride/index.*` las clases que ya viven en `dist/index.*` (el bug
   * que esto corrige: en CJS, esa duplicación rompe `instanceof SriError`
   * para un consumidor que capture el error de `sri-ec/ride` pero importe
   * `SriError` desde `sri-ec`). Con `external`, ambos bundles referencian
   * en runtime el mismo módulo core — Node resuelve `'sri-ec'` como
   * auto-referencia vía `package.json` → `exports`, sin necesidad de que el
   * paquete esté en un `node_modules` real. El core (`src/index.ts`) nunca
   * importa `'sri-ec'`, así que esta entrada no le afecta.
   */
  external: ['sri-ec'],
});
