import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { controlEndpoint } from '../scripts/desktop-launcher.mjs';

const script = fileURLToPath(new URL('../scripts/desktop-launcher.mjs', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(run) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'Studio space 中文 '));
  const children = new Set();
  const env = { ...process.env, STUDIO_DESKTOP_HOME: home };
  delete env.STUDIO_DATA_DIR;
  function launch(...args) {
    const child = spawn(process.execPath, [script, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    child.output = ''; child.errors = '';
    child.stdout.on('data', data => { child.output += data; });
    child.stderr.on('data', data => { child.errors += data; });
    child.done = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    return child;
  }
  async function state() {
    for (let attempt = 0; attempt < 200; attempt++) {
      try { const value = JSON.parse(await fs.readFile(path.join(home, 'runtime/state.json'), 'utf8')); if (value.phase === 'ready') return value; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await pause(30);
    }
    throw new Error('Launcher failed to become ready: ' + [...children].map(c => c.errors).join('\n'));
  }
  async function stop() {
    const child = launch('--stop');
    const result = await child.done;
    assert.equal(result.code, 0, child.errors);
  }
  try { await run({ home, launch, state, stop }); }
  finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.all([...children].map(child => child.done));
    await fs.rm(home, { recursive: true, force: true });
  }
}

test('desktop launcher persists edits across stops and paths containing spaces and Unicode', { timeout: 20_000 }, async () => fixture(async ({ launch, state, stop, home }) => {
  const first = launch('--no-open');
  const initial = await state();
  assert.equal(initial.pid, first.pid);
  assert.equal(initial.dataDir, await fs.realpath(path.join(home, 'data')));
  const project = await (await fetch(initial.url + '/api/project')).json();
  project.name = 'Saved from desktop installation'; project.revision++;
  assert.equal((await fetch(initial.url + '/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) })).status, 200);
  await stop();
  assert.equal((await first.done).code, 0);
  await assert.rejects(fs.stat(path.join(home, 'runtime/state.json')), { code: 'ENOENT' });
  const second = launch('--no-open');
  const restarted = await state();
  assert.equal(restarted.pid, second.pid);
  assert.equal((await (await fetch(restarted.url + '/api/project')).json()).name, project.name);
  await stop();
  assert.equal((await second.done).code, 0);
  await stop();
}));

test('concurrent double-clicks share one owner and unauthorized IPC cannot stop it', { timeout: 20_000 }, async () => fixture(async ({ launch, state, stop }) => {
  const starts = Array.from({ length: 5 }, () => launch('--no-open'));
  const owner = await state();
  const duplicates = starts.filter(child => child.pid !== owner.pid);
  assert.equal(duplicates.length, 4);
  for (const child of duplicates) {
    assert.equal((await child.done).code, 0, child.errors);
    assert.equal(JSON.parse(child.output).pid, owner.pid);
    assert.equal(JSON.parse(child.output).url, owner.url);
    assert.equal(JSON.parse(child.output).reused, true);
  }
  const reply = await new Promise((resolve, reject) => {
    const endpoint = controlEndpoint(owner.dataDir);
    const client = net.createConnection({ host: endpoint.host, port: endpoint.port });
    let data = '';
    client.on('error', reject);
    client.on('connect', () => client.write(JSON.stringify({ action: 'stop', token: 'wrong-token' }) + '\n'));
    client.on('data', chunk => { data += chunk; });
    client.on('end', () => resolve(JSON.parse(data)));
  });
  assert.equal(reply.ok, false);
  assert.equal((await fetch(owner.url + '/api/health')).status, 200);
  await stop();
  assert.equal((await starts.find(child => child.pid === owner.pid).done).code, 0);
}));

test('crashed owner leaves no stale kernel lock and old metadata is replaced', { timeout: 20_000 }, async () => fixture(async ({ launch, state, stop }) => {
  const first = launch('--no-open');
  const before = await state();
  first.kill('SIGKILL'); await first.done;
  const second = launch('--no-open');
  let after;
  for (let attempt = 0; attempt < 200; attempt++) { after = await state(); if (after.pid === second.pid) break; await pause(25); }
  assert.equal(after.pid, second.pid);
  assert.notEqual(after.token, before.token);
  assert.equal((await fetch(after.url + '/api/project')).status, 200);
  await stop();
  assert.equal((await second.done).code, 0);
}));

test('invalid saved document fails visibly, logs an error, and releases the instance lock', { timeout: 20_000 }, async () => fixture(async ({ launch, home, state, stop }) => {
  await fs.mkdir(path.join(home, 'data'), { recursive: true });
  await fs.writeFile(path.join(home, 'data/project.json'), '{broken');
  const broken = launch('--no-open');
  assert.equal((await broken.done).code, 1);
  assert.match(broken.errors, /JSON/);
  assert.match(await fs.readFile(path.join(home, 'runtime/launcher.log'), 'utf8'), /ERROR/);
  await fs.rm(path.join(home, 'data/project.json'));
  const fixed = launch('--no-open');
  assert.equal((await state()).pid, fixed.pid);
  await stop();
}));

test('unrelated process occupying the control port blocks startup instead of creating another owner', { timeout: 20_000 }, async () => fixture(async ({ launch, home }) => {
  const data = path.join(home, 'data');
  await fs.mkdir(data);
  const endpoint = controlEndpoint(await fs.realpath(data));
  const occupied = net.createServer(socket => {
    socket.on('data', () => socket.end(JSON.stringify({ ok: true, app: 'Unrelated application' }) + '\n'));
  });
  await new Promise(resolve => occupied.listen({ host: endpoint.host, port: endpoint.port, exclusive: true }, resolve));
  try {
    const child = launch('--no-open');
    assert.equal((await child.done).code, 1);
    assert.match(child.errors, /occupied by another application/);
    await assert.rejects(fs.stat(path.join(data, 'project.json')), { code: 'ENOENT' });
  } finally { await new Promise(resolve => occupied.close(resolve)); }
}));
