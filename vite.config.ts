import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'path';

/**
 * Vite configuration for the isometric ARPG core.
 *
 * - `@` alias maps to `/src` so modules import via stable absolute paths
 *   (safe for sub-agents to move files without breaking relative imports).
 * - esbuild target ES2022 to match tsconfig.
 * - GitHub Pages (it.31): `PAGES=1 npm run build` sets the /isometric-game/
 *   base AND skips the public/ copy; the deploy script copies only the
 *   git-tracked curated subset into dist. Runtime asset URLs are built from
 *   import.meta.env.BASE_URL, so dev ('/') and Pages ('/isometric-game/')
 *   both resolve.
 * - ATLAS BAKE ENDPOINT (it.36, dev only): the in-browser baker
 *   (`src/dev/AtlasBaker.ts`) POSTs finished sprite atlases + manifest to
 *   `/__bake`; this plugin writes them under public/assets/atlas/. It is
 *   never part of a production build.
 */
function atlasBakePlugin(): Plugin {
  return {
    name: 'atlas-bake-endpoint',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__bake', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              file: string;
              base64?: string;
              text?: string;
            };
            const file = basename(body.file); // No path traversal: flat directory.
            const dir = resolve(__dirname, 'public/assets/atlas');
            mkdirSync(dir, { recursive: true });
            const dest = resolve(dir, file);
            if (body.base64 !== undefined) writeFileSync(dest, Buffer.from(body.base64, 'base64'));
            else writeFileSync(dest, body.text ?? '', 'utf8');
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, file }));
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: process.env.PAGES ? '/isometric-game/' : '/',
  publicDir: process.env.PAGES ? false : 'public',
  plugins: [atlasBakePlugin()],
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
