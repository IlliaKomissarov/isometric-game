import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Vite configuration for the isometric ARPG core.
 *
 * - `@` alias maps to `/src` so modules import via stable absolute paths
 *   (safe for sub-agents to move files without breaking relative imports).
 * - esbuild target ES2022 to match tsconfig.
 * - GitHub Pages (it.31): `PAGES=1 npm run build` sets the /isometric-game/
 *   base AND skips the public/ copy (the raw asset store is 2.5 GB; the
 *   deploy script copies only the git-tracked curated subset into dist).
 *   Runtime asset URLs are built from import.meta.env.BASE_URL, so dev
 *   ('/') and Pages ('/isometric-game/') both resolve.
 */
export default defineConfig({
  base: process.env.PAGES ? '/isometric-game/' : '/',
  publicDir: process.env.PAGES ? false : 'public',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
    open: false,
  },
});
