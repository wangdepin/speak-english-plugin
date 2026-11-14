// Copies dist/ into an app data root: <data root>/plugins/speak-english/dist.
// The sibling data/ folder (store, keys, audio) is never touched.
// Usage: node scripts/install.mjs <data root>
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [dataRoot] = process.argv.slice(2);
if (!dataRoot) { console.error('Usage: node scripts/install.mjs <data root>'); process.exit(1); }
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'dist');
await stat(path.join(source, 'manifest.json')).catch(() => { console.error('dist/ is missing. Run `npm run build` first.'); process.exit(1); });
await stat(dataRoot).catch(() => { console.error(`Data root not found: ${dataRoot}`); process.exit(1); });
const target = path.join(path.resolve(dataRoot), 'plugins', 'speak-english', 'dist');
await rm(target, { recursive: true, force: true });
await mkdir(path.dirname(target), { recursive: true });
await cp(source, target, { recursive: true });
console.log(`Installed to ${target}`);
