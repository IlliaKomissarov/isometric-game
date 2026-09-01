/**
 * GitHub Pages deploy (it.31).
 *
 * The raw public/ asset store is ~2.5 GB, so a normal `vite build` (which
 * copies all of public/ into dist/) is off the table. Instead:
 *   1. Build with PAGES=1 → base '/isometric-game/' AND publicDir disabled.
 *   2. Copy ONLY the git-tracked curated asset subset (the .gitignore
 *      whitelist mirrors what SpriteLibrary/AudioManager actually load)
 *      from public/ into dist/.
 *   3. Publish dist/ to the gh-pages branch (gh-pages package).
 *
 * Run with: npm run deploy
 */
import { execSync, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const run = (cmd, env = {}) =>
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });

console.log('[deploy] building with PAGES=1 (base /isometric-game/, no public copy)…');
run('npm run build', { PAGES: '1' });

console.log('[deploy] copying git-tracked public/ subset into dist/…');
const listed = execFileSync('git', ['ls-files', '-z', 'public'], { maxBuffer: 1 << 28 });
const files = listed.toString('utf8').split('\0').filter(Boolean);
let copied = 0;
for (const f of files) {
  const rel = f.slice('public/'.length);
  const dest = join('dist', rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(f, dest);
  copied++;
}
console.log(`[deploy] copied ${copied} asset files.`);

// GitHub Pages runs Jekyll by default, which mangles paths with special
// characters (our asset folders have parens/spaces). .nojekyll disables it.
writeFileSync(join('dist', '.nojekyll'), '');

// NATIVE PUBLISH (the gh-pages npm package dies on Windows here: it passes
// all ~15k file paths as ONE command line → spawn ENAMETOOLONG). Git's own
// plumbing builds the branch through the index instead — no length limits:
// stage dist/ as a work-tree into a scratch index, write a tree, commit it
// orphan, point refs/heads/gh-pages at it, force-push.
console.log('[deploy] publishing dist/ to the gh-pages branch (native git)…');
const scratchIndex = join(process.cwd(), 'node_modules', '.cache', 'pages-index');
mkdirSync(dirname(scratchIndex), { recursive: true });
rmSync(scratchIndex, { force: true });
const env = { ...process.env, GIT_INDEX_FILE: scratchIndex };
execFileSync('git', ['--work-tree', 'dist', 'add', '-A'], { env, stdio: 'inherit' });
const tree = execFileSync('git', ['write-tree'], { env }).toString().trim();
const commit = execFileSync('git', ['commit-tree', tree, '-m', 'Deploy to GitHub Pages'], { env })
  .toString()
  .trim();
execFileSync('git', ['update-ref', 'refs/heads/gh-pages', commit], { stdio: 'inherit' });
execFileSync('git', ['push', '-f', 'origin', 'gh-pages'], { stdio: 'inherit' });
console.log('[deploy] done.');
