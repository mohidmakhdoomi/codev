import { defineConfig } from 'tsdown';
import { copyFileSync, mkdirSync } from 'node:fs';

/**
 * Dual-format build (CJS + ESM + type declarations) via tsdown (Rolldown-powered).
 * React is externalized (it's a peer dependency — tsdown auto-externalizes deps/peerDeps).
 * The default theme stylesheet is copied to `dist/default-theme.css` and exposed via the
 * package's `./default-theme.css` export.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  onSuccess: () => {
    mkdirSync('dist', { recursive: true });
    copyFileSync('src/styles/default-theme.css', 'dist/default-theme.css');
  },
});
