import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { unzipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE_VERSION = '24.19.0';
const NODE_ZIP = `node-v${NODE_VERSION}-win-x64.zip`;
// Pinned to the official https://nodejs.org/dist/v24.19.0/SHASUMS256.txt.
const NODE_ZIP_SHA256 = '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73';
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFileChecksums = {};
async function readSource(relative) {
  const bytes = await fs.readFile(path.join(root, relative));
  sourceFileChecksums[relative] = sha256(bytes);
  return bytes;
}
const pkg = JSON.parse(await readSource('package.json'));
await readSource('scripts/package-windows.mjs');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Expected a numeric release version.');
const releaseDir = path.join(root, 'releases', `v${pkg.version}`);
const buildBase = path.resolve(process.env.STUDIO_BUILD_DIR || path.join(os.tmpdir(), 'game-ui-studio-windows-build'));
await fs.mkdir(buildBase, { recursive: true });
const work = await fs.mkdtemp(path.join(buildBase, 'build-'));
const payload = path.join(work, 'payload');
const appDir = path.join(payload, 'app');
await fs.mkdir(appDir, { recursive: true });

async function run(command, args, cwd = root, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', shell: false });
    let output = '';
    child.stdout?.on('data', data => { output += data; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`${command} exited with ${code}`)));
  });
}
const npm = (args, cwd) => {
  // npm.cmd needs cmd.exe on Windows; invoking npm's JS entry avoids shell quoting.
  if (process.env.npm_execpath) return run(process.execPath, [process.env.npm_execpath, ...args], cwd);
  if (process.platform === 'win32') throw new Error('On Windows, run this builder through npm run package:windows.');
  return run('npm', args, cwd);
};

async function copyTree(source, destination) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed in the installer payload: ${source}`);
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    for (const name of (await fs.readdir(source)).sort()) await copyTree(path.join(source, name), path.join(destination, name));
  } else if (stat.isFile()) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    const relative = path.relative(root, source);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      sourceFileChecksums[relative.split(path.sep).join('/')] = sha256(await fs.readFile(destination));
    }
  } else throw new Error(`Unexpected non-file payload source: ${source}`);
}

// Derive the server-only dependency tree from the exact application lockfile.
// The compiled UI already contains React/Konva, so their node_modules are unnecessary.
function runtimeLock(fullLock) {
  const dependencies = Object.fromEntries(['express', 'fflate'].map(name => [name, pkg.dependencies[name]]));
  const packages = { '': { name: pkg.name, version: pkg.version, dependencies } };
  function resolveDependency(from, name) {
    let current = from;
    while (current) {
      const candidate = `${current}/node_modules/${name}`;
      if (fullLock.packages[candidate]) return candidate;
      const parent = path.posix.dirname(current);
      current = parent === '.' ? '' : parent;
    }
    const candidate = `node_modules/${name}`;
    if (fullLock.packages[candidate]) return candidate;
    throw new Error(`Missing locked runtime dependency ${name}, required by ${from || 'root'}`);
  }
  function visit(location) {
    if (packages[location]) return;
    const entry = fullLock.packages[location];
    if (entry.link || entry.hasInstallScript) throw new Error(`Runtime dependency needs unsupported linking/install scripts: ${location}`);
    packages[location] = { ...entry };
    delete packages[location].dev;
    for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) visit(resolveDependency(location, name));
    for (const name of Object.keys(entry.peerDependencies || {})) {
      if (!entry.peerDependenciesMeta?.[name]?.optional) visit(resolveDependency(location, name));
    }
  }
  for (const name of Object.keys(dependencies)) visit(resolveDependency('', name));
  return {
    package: { name: pkg.name, version: pkg.version, private: true, type: 'module', dependencies },
    lock: { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages },
  };
}

try {
  console.log(`Building Game UI Studio ${pkg.version}; temporary files: ${work}`);
  await npm(['run', 'build'], root);
  for (const name of [
    'dist', 'public/assets', 'examples/character.project.json', 'examples/recruit.patch.json',
    'server', 'src/model.js', 'src/animationModel.js', 'src/motionPresets.js', 'src/poseCalibration.js', 'src/patchSelection.js', 'src/mapModel.js', 'src/generationModel.js', 'src/studioFeatures.js', 'src/projectImport.js', 'scripts/desktop-launcher.mjs',
    'examples/village.map.json', 'research/animation-sources', 'scripts/convert-motion-presets.mjs', 'docs/PROJECT-TOOLBOX.md', 'docs/PIXEL-ANIMATION.md', 'docs/MOTION-SOURCES.md', 'docs/ALIGNMENT-AND-GRID.md', 'docs/MAP-WORKSPACE.md', 'docs/CODEX-GENERATION.md', 'docs/map-contract.md',
    '.agents/skills/game-ui-studio', 'LICENSE',
    'docs/TECHNICAL-DECISION.md', 'docs/CODEX-SKILL.md', 'docs/WINDOWS-INSTALL.md', 'docs/BRANDING.md',
  ]) await copyTree(path.join(root, name), path.join(appDir, name));
  await copyTree(path.join(root, 'packaging/windows/AGENTS.md'), path.join(appDir, 'AGENTS.md'));
  await copyTree(path.join(root, 'packaging/windows/launch.vbs'), path.join(payload, 'launch.vbs'));
  await copyTree(path.join(root, 'packaging/windows/game-ui-studio.ico'), path.join(payload, 'game-ui-studio.ico'));

  const locked = runtimeLock(JSON.parse(await readSource('package-lock.json')));
  await fs.writeFile(path.join(appDir, 'package.json'), `${JSON.stringify(locked.package, null, 2)}\n`);
  await fs.writeFile(path.join(appDir, 'package-lock.json'), `${JSON.stringify(locked.lock, null, 2)}\n`);
  await npm(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(buildBase, 'npm-cache')], appDir);

  const nodeZipPath = process.env.NODE_WINDOWS_ZIP ? path.resolve(process.env.NODE_WINDOWS_ZIP) : path.join(buildBase, NODE_ZIP);
  try { await fs.access(nodeZipPath); }
  catch (error) {
    if (error.code !== 'ENOENT' || process.env.NODE_WINDOWS_ZIP) throw error;
    console.log(`Downloading pinned Node runtime: ${NODE_URL}`);
    const response = await fetch(NODE_URL, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Node download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== NODE_ZIP_SHA256) throw new Error('Downloaded Node archive checksum does not match the official pinned release.');
    await fs.writeFile(nodeZipPath, bytes);
  }
  const nodeZipBytes = await fs.readFile(nodeZipPath);
  if (sha256(nodeZipBytes) !== NODE_ZIP_SHA256) throw new Error(`Node archive checksum mismatch: ${nodeZipPath}`);
  const nodeFiles = unzipSync(nodeZipBytes, { filter: file => [`node-v${NODE_VERSION}-win-x64/node.exe`, `node-v${NODE_VERSION}-win-x64/LICENSE`].includes(file.name) });
  for (const [member, destination] of [['node.exe', 'node.exe'], ['LICENSE', 'NODE-LICENSE.txt']]) {
    const bytes = nodeFiles[`node-v${NODE_VERSION}-win-x64/${member}`];
    if (!bytes?.length) throw new Error(`Missing Node runtime file: ${member}`);
    await fs.writeFile(path.join(payload, destination), bytes);
  }

  const notices = [
    'Game UI Studio - bundled third-party notices', '',
    `Node.js ${NODE_VERSION} (official win-x64 distribution). Full license and bundled library notices: NODE-LICENSE.txt.`,
    'Game UI Studio and original sample SVG artwork: MIT; see app/LICENSE and app/public/assets/ART-LICENSE.md.',
    'DejaVu fonts: see app/public/assets/FONT-LICENSE.txt.',
    'Frontend libraries bundled in app/dist and build helpers: React, React DOM, React Konva, Konva, fflate, scheduler, react-reconciler, its-fine, Vite (MIT).',
    'The full original license files for frontend libraries are included in app/licenses/.', '',
    'Server dependency licenses remain in their original app/node_modules package directories:',
  ];
  for (const location of Object.keys(locked.lock.packages).filter(Boolean).sort()) {
    const dep = JSON.parse(await fs.readFile(path.join(appDir, location, 'package.json'), 'utf8'));
    notices.push(`${dep.name}@${dep.version}: ${typeof dep.license === 'string' ? dep.license : JSON.stringify(dep.license || dep.licenses || 'See package files')}`);
  }
  const frontendDependencies = {};
  for (const name of ['react', 'react-dom', 'react-konva', 'konva', 'fflate', 'scheduler', 'react-reconciler', 'its-fine', 'vite']) {
    const sourceDir = path.join(root, 'node_modules', name);
    const metadata = JSON.parse(await fs.readFile(path.join(sourceDir, 'package.json'), 'utf8'));
    frontendDependencies[name] = { version: metadata.version, license: metadata.license };
    const licenseNames = (await fs.readdir(sourceDir)).filter(file => /^(license|copying|notice)(\.|$)/i.test(file));
    if (!licenseNames.length) throw new Error(`Missing frontend license for ${name}`);
    for (const file of licenseNames) await copyTree(path.join(sourceDir, file), path.join(appDir, 'licenses', name, file));
    notices.push(`${name}@${metadata.version}: ${metadata.license}; license copy: app/licenses/${name}/`);
  }
  await fs.writeFile(path.join(payload, 'THIRD_PARTY_NOTICES.txt'), `${notices.join('\r\n')}\r\n`);
  await fs.writeFile(path.join(payload, 'README.txt'), [
    'Game UI Studio', '',
    'Double-click the Game UI Studio desktop shortcut. The local editor opens in your default browser.',
    'Node.js is included; installation and everyday use do not require npm, a paid API, or an account.',
    'Project data: %LOCALAPPDATA%\\GameUIStudio\\data',
    'Runtime state and logs: %LOCALAPPDATA%\\GameUIStudio\\runtime',
    'Use Start > Game UI Studio > Stop Game UI Studio to stop the local service.',
    'Uninstalling preserves your projects and imported assets.',
    'Companion Codex skill: app\\.agents\\skills\\game-ui-studio (manual installation only).',
    'The bundled node.exe can run app\\.agents\\skills\\game-ui-studio\\scripts\\review.mjs.',
    'Godot itself is not bundled. Install Godot 4 separately to run exported scenes.',
    'Repository and source: https://github.com/sleeper-lfy/my-prototype', '',
  ].join('\r\n'));

  const files = {};
  async function inventory(dir, relative = '') {
    for (const name of (await fs.readdir(dir)).sort()) {
      const rel = relative ? `${relative}/${name}` : name;
      const source = path.join(dir, name);
      const stat = await fs.lstat(source);
      if (stat.isSymbolicLink()) throw new Error(`Unexpected symlink in final payload: ${rel}`);
      if (stat.isDirectory()) await inventory(source, rel);
      else if (stat.isFile()) {
        const bytes = await fs.readFile(source);
        files[rel] = { bytes: bytes.length, sha256: sha256(bytes) };
        // Normalize payload timestamps so repeated builds do not include npm extraction times.
        const timestamp = new Date('2020-01-01T00:00:00Z');
        await fs.utimes(source, timestamp, timestamp);
      } else throw new Error(`Unexpected payload type: ${rel}`);
    }
  }
  await inventory(payload);
  // Only these pinned, publicly licensed motion reference files belong in runtime research paths.
  const motionReference = /^app\/research\/animation-sources\/robot-expressive\/(RobotExpressive\.glb|UPSTREAM-README\.md|CC0-1\.0\.txt|manifest\.json|LICENSE-NOTICE\.md)$/;
  if (Object.keys(files).some(name => /(^|\/)(data|\.git|\.env|\.cache|artifacts|research)(\/|$)/.test(name) && !motionReference.test(name))) throw new Error('Forbidden runtime payload content.');
  if (Object.keys(files).some(name => /\.(node|dll)$/i.test(name))) throw new Error('Unexpected native dependency: cross-platform runtime must be pure JavaScript.');
  await fs.mkdir(releaseDir, { recursive: true });
  const installerName = `Game-UI-Studio-Setup-${pkg.version}-x64.exe`;
  const installerPath = path.join(releaseDir, installerName);
  const installerScript = path.join(work, 'installer.nsi');
  await fs.writeFile(installerScript, await readSource('packaging/windows/installer.nsi'));
  await run(process.env.MAKENSIS_BIN || 'makensis', [
    '-V2', `-DVERSION=${pkg.version}`, `-DPAYLOAD_DIR=${payload}`, `-DOUTPUT_FILE=${installerPath}`,
    installerScript,
  ]);
  const installer = await fs.readFile(installerPath);
  if (installer.length >= 100 * 1024 * 1024) throw new Error('Installer exceeds the normal GitHub file limit.');
  if (installer.subarray(0, 2).toString() !== 'MZ') throw new Error('NSIS did not produce a Windows executable.');
  const manifest = {
    name: pkg.name, version: pkg.version, target: 'Windows 10/11 x64',
    sourceBaseCommit: await run('git', ['rev-parse', 'HEAD'], root, true),
    sourceDirty: Boolean(await run('git', ['status', '--porcelain'], root, true)),
    sourceTreeSha256: sha256(JSON.stringify(Object.fromEntries(Object.entries(sourceFileChecksums).sort(([a], [b]) => a.localeCompare(b))))),
    sourceFileChecksums,
    nodeRuntime: { version: NODE_VERSION, url: NODE_URL, archiveSha256: NODE_ZIP_SHA256 },
    frontendDependencies,
    installer: { file: installerName, bytes: installer.length, sha256: sha256(installer), signed: false },
    payload: files,
  };
  await fs.writeFile(path.join(releaseDir, 'windows-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(releaseDir, `${installerName}.sha256`), `${sha256(installer)}  ${installerName}\n`);
  console.log(JSON.stringify({ installer: path.relative(root, installerPath), bytes: installer.length, sha256: sha256(installer), payload, manifest: path.relative(root, path.join(releaseDir, 'windows-manifest.json')) }, null, 2));
  // Retain the stage for installer inspection and clean-install tests. It is outside the repository.
} catch (error) {
  console.error(`Windows packaging failed. Temporary files retained for diagnosis: ${work}`);
  throw error;
}
