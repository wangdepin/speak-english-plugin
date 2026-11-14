// Bundles the plugin into dist/: main.js (browser), backend.cjs (Node), manifest.json, styles.css,
// and the license of the scheduler code that is bundled into backend.cjs.
import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await Promise.all([
  build({ entryPoints: [path.join(root, 'src/frontend/main.js')], outfile: path.join(out, 'main.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' }),
  build({ entryPoints: [path.join(root, 'src/backend/backend.cjs')], outfile: path.join(out, 'backend.cjs'), bundle: true, format: 'cjs', platform: 'node', target: 'node22' }),
  copyFile(path.join(root, 'manifest.json'), path.join(out, 'manifest.json')),
  copyFile(path.join(root, 'src/frontend/styles.css'), path.join(out, 'styles.css')),
  copyFile(path.join(root, 'FSRS-LICENSE.txt'), path.join(out, 'FSRS-LICENSE.txt')),
]);
console.log(`Built ${out}`);
