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
});
