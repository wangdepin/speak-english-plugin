// Builds the plugin and packs it for a release:
//   release/speak-english-<version>.zip          contains speak-english/dist/
//   release/speak-english-<version>.zip.sha256   its SHA-256 checksum, in `shasum` format
// Unzipping the archive into the app's plugins directory installs the plugin.
// Needs the `zip` command, which macOS and most Linux systems have.
// Usage: node scripts/package.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const release = path.join(root, 'release');
const { id, version } = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const archive = `${id}-${version}.zip`;

execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
await rm(release, { recursive: true, force: true });
await mkdir(path.join(release, id), { recursive: true });
await cp(path.join(root, 'dist'), path.join(release, id, 'dist'), { recursive: true });
// -X leaves out file attributes that differ from one machine to the next.
execFileSync('zip', ['-X', '-r', '-q', archive, id], { cwd: release, stdio: 'inherit' });
await rm(path.join(release, id), { recursive: true });

const checksum = createHash('sha256').update(await readFile(path.join(release, archive))).digest('hex');
await writeFile(path.join(release, `${archive}.sha256`), `${checksum}  ${archive}\n`);
console.log(`Packed ${path.join(release, archive)}\n${checksum}`);
