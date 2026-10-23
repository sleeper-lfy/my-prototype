import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { zipSync, unzipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Expected a numeric semver release version.');
const version = pkg.version;
const release = path.join(root, 'releases', `v${version}`);
const skillRoot = '.agents/skills/game-ui-studio/';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sourceRoots = ['.agents/', '.codex-plugin/', 'artifacts/', 'docs/', 'examples/', 'public/', 'research/penpot/', 'scripts/', 'server/', 'src/', 'tests/'];
const sourceFiles = ['.gitignore', 'AGENTS.md', 'README.md', 'LICENSE', 'index.html', 'package.json', 'package-lock.json', 'vite.config.js'];
const listing = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
if (listing.status !== 0) throw new Error('Run release packaging from a Git checkout.');
const names = [...new Set(listing.stdout.split('\0').filter(Boolean))].filter(name => {
  if (!sourceFiles.includes(name) && !sourceRoots.some(prefix => name.startsWith(prefix))) return false;
  if (name.startsWith('artifacts/godot-project/') || name.startsWith('research/penpot/source/')) return false;
  return !name.split('/').some(part => ['node_modules', '__pycache__', '.git', '.env'].includes(part)) && !/\.(log|pyc|pem|key)$/i.test(name);
}).sort();
const appEntries = {};
const skillEntries = {};
const sourceChecksums = {};
for (const name of names) {
  const source = path.join(root, name);
  const stat = await fs.lstat(source);
  if (!stat.isFile()) throw new Error(`Release source must be a regular file: ${name}`);
  const bytes = await fs.readFile(source);
  sourceChecksums[name] = sha256(bytes);
  appEntries[`game-ui-studio/${name}`] = bytes;
  if (name.startsWith(skillRoot)) skillEntries[`game-ui-studio/${name.slice(skillRoot.length)}`] = bytes;
}
for (const name of ['SKILL.md', 'agents/openai.yaml', 'scripts/review.mjs', 'LICENSE.txt']) {
  if (!skillEntries[`game-ui-studio/${name}`]) throw new Error(`Incomplete companion skill: ${name}`);
}
await fs.mkdir(release, { recursive: true });
const bundles = {};
for (const [name, entries] of [
  [`game-ui-studio-v${version}.zip`, appEntries],
  [`game-ui-studio-skill-v${version}.zip`, skillEntries],
]) {
  // Stable timestamps make identical source trees produce identical packages.
  const bytes = zipSync(entries, { level: 8, mtime: new Date('2020-01-01T00:00:00Z') });
  const checked = unzipSync(bytes);
  if (Object.keys(checked).length !== Object.keys(entries).length) throw new Error('Archive verification failed.');
  for (const [filename, data] of Object.entries(entries)) {
    if (sha256(data) !== sha256(checked[filename])) throw new Error(`Archive content mismatch: ${filename}`);
  }
  await fs.writeFile(path.join(release, name), bytes);
  bundles[name] = { bytes: bytes.length, files: Object.keys(entries).length, sha256: sha256(bytes) };
}
const manifest = { name: pkg.name, version, repository: 'https://github.com/sleeper-lfy/my-prototype', sourceTreeSha256: sha256(JSON.stringify(sourceChecksums)), bundles, sourceChecksums };
await fs.writeFile(path.join(release, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await fs.writeFile(path.join(release, 'SHA256SUMS'), Object.entries(bundles).map(([name, data]) => `${data.sha256}  ${name}\n`).join(''));
console.log(JSON.stringify({ release: path.relative(root, release), version, bundles }, null, 2));
