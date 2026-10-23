import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStudioServer } from '../server/index.js';

const APP = 'Game UI Studio';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const connectionErrors = new Set(['ENOENT', 'ECONNREFUSED', 'EPIPE']);

export function controlEndpoint(dataDir, platform = process.platform) {
  const canonical = platform === 'win32' ? dataDir.toLowerCase() : dataDir;
  const hash = createHash('sha256').update(canonical).digest();
  // A single deterministic, exclusive TCP bind is the kernel-owned lock.
  // Windows named pipes allow multiple servers for the same name. Do not use
  // them for mutual exclusion, and never scan to a different control port.
  return { host: '127.0.0.1', port: 20_000 + hash.readUInt32BE(0) % 40_000, instanceId: hash.toString('hex') };
}

async function paths() {
  const home = process.env.STUDIO_DESKTOP_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'GameUIStudio');
  const requestedData = process.env.STUDIO_DATA_DIR || path.join(home, 'data');
  await fs.mkdir(requestedData, { recursive: true });
  const dataDir = await fs.realpath(requestedData);
  const runtime = process.env.STUDIO_DATA_DIR ? path.join(dataDir, '.desktop-runtime') : path.join(home, 'runtime');
  await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
  return { dataDir, runtime, stateFile: path.join(runtime, 'state.json'), logFile: path.join(runtime, 'launcher.log'), control: controlEndpoint(dataDir) };
}

async function log(config, message) {
  await fs.appendFile(config.logFile, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
}

async function writeState(config, state) {
  const temp = `${config.stateFile}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, config.stateFile);
}

function command(endpoint, body, timeout = 45_000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: endpoint.host, port: endpoint.port });
    let text = '';
    socket.setTimeout(timeout, () => socket.destroy(new Error('Game UI Studio did not respond in time.')));
    socket.once('error', reject);
    socket.once('connect', () => socket.write(JSON.stringify(body) + '\n'));
    socket.on('data', chunk => {
      text += chunk;
      if (text.length > 8192) return socket.destroy(new Error('Invalid local launcher response.'));
      if (!text.includes('\n')) return;
      try {
        const response = JSON.parse(text.slice(0, text.indexOf('\n')));
        socket.end();
        if (!response.ok) reject(new Error(response.error || 'The local launcher refused the request.'));
        else resolve(response);
      } catch (error) { socket.destroy(); reject(error); }
    });
    socket.once('end', () => { if (!text.includes('\n')) reject(Object.assign(new Error('The local launcher closed before replying.'), { code: 'EPIPE' })); });
  });
}

async function status(config) {
  const challenge = randomBytes(16).toString('hex');
  const response = await command(config.control, { action: 'status', challenge });
  if (response.app !== APP || response.dataDir !== config.dataDir || response.instanceId !== config.control.instanceId || !Number.isSafeInteger(response.pid) || response.pid <= 0 || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(response.url || '') || Number(new URL(response.url).port) > 65535 || !/^[a-f0-9]{64}$/.test(response.proof || '')) {
    throw new Error(`The local control port ${config.control.port} is occupied by another application. Close that application and try again.`);
  }
  const state = JSON.parse(await fs.readFile(config.stateFile, 'utf8'));
  const expected = createHmac('sha256', state.token).update(challenge).digest();
  if (state.pid !== response.pid || state.url !== response.url || state.phase !== 'ready' || !timingSafeEqual(expected, Buffer.from(response.proof, 'hex'))) throw new Error('The local instance does not match the saved launcher identity. Close Studio and try again.');
  return { app: response.app, pid: response.pid, url: response.url, dataDir: response.dataDir };
}

async function openBrowser(url) {
  // The URL is generated locally from an ephemeral port; never invoke cmd.exe.
  const executable = process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(executable, args, { windowsHide: true, detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
}

async function stop(config) {
  // State is metadata, never a lock. If the endpoint disappeared after a crash,
  // stale metadata cannot prevent the next instance from starting.
  try { await status(config); }
  catch (error) { if (connectionErrors.has(error.code)) return; throw error; }
  let state;
  try {
    state = JSON.parse(await fs.readFile(config.stateFile, 'utf8'));
    await command(config.control, { action: 'stop', token: state.token });
  } catch (error) {
    // A simultaneous Stop shortcut may have completed the same shutdown.
    try { await status(config); }
    catch (probeError) { if (connectionErrors.has(probeError.code)) return; }
    throw error;
  }
  // On Windows node.exe remains locked until the owner process exits. Do not
  // let an upgrade/uninstaller overwrite its files after only an HTTP close.
  for (let attempt = 0; attempt < 300; attempt++) {
    try { process.kill(state.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await wait(50);
  }
  throw new Error('Studio stopped accepting requests but its process has not exited. Close it before upgrading.');
}

async function start(config, noOpen) {
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // An owner can fail before any duplicate launcher waits on readiness.
  ready.catch(() => {});
  const token = randomBytes(32).toString('hex');
  const clients = new Set();
  let studio, state, shutdownPromise;
  const controller = net.createServer(socket => {
    clients.add(socket);
    socket.once('close', () => clients.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(50_000, () => socket.destroy());
    let text = '', handled = false;
    socket.on('data', async chunk => {
      if (handled) return;
      text += chunk;
      if (text.length > 4096) return socket.destroy();
      if (!text.includes('\n')) return;
      handled = true;
      try {
        const request = JSON.parse(text.slice(0, text.indexOf('\n')));
        if (request.action === 'status' && /^[a-f0-9]{32}$/.test(request.challenge || '')) {
          const info = await ready;
          socket.end(JSON.stringify({ ok: true, ...info, instanceId: config.control.instanceId, proof: createHmac('sha256', token).update(request.challenge).digest('hex') }) + '\n');
        } else if (request.action === 'stop' && request.token === token) {
          await ready;
          await shutdown(socket);
          socket.end(JSON.stringify({ ok: true, stopped: true }) + '\n');
        } else socket.end(JSON.stringify({ ok: false, error: 'Invalid launcher command or control token.' }) + '\n');
      } catch (error) { socket.end(JSON.stringify({ ok: false, error: error.message }) + '\n'); }
    });
  });

  async function shutdown(exceptSocket) {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      if (studio?.httpServer.listening) {
        await new Promise((resolve, reject) => studio.httpServer.close(error => error ? reject(error) : resolve()));
      }
      await studio?.close();
      // Only the endpoint owner writes/removes this metadata, before releasing its
      // kernel lock, so another launcher cannot be mistaken for this owner.
      await fs.rm(config.stateFile, { force: true });
      await log(config, 'Stopped.');
      for (const client of clients) if (client !== exceptSocket) client.destroy();
      if (controller.listening) controller.close();
    })();
    return shutdownPromise;
  }

  let ownsEndpoint = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        controller.once('error', reject);
        controller.listen({ host: config.control.host, port: config.control.port, exclusive: true }, () => { controller.removeListener('error', reject); resolve(); });
      });
      ownsEndpoint = true;
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      try {
        const existing = await status(config);
        console.log(JSON.stringify({ ...existing, reused: true }));
        if (!noOpen) await openBrowser(existing.url);
        return;
      } catch (connectError) {
        if (!connectionErrors.has(connectError.code)) throw connectError;
        await wait(100);
      }
    }
  }
  if (!ownsEndpoint) throw new Error('Another Studio process is starting or stopping. Try again shortly.');
  controller.on('error', error => { log(config, `Control error: ${error.message}`).catch(() => {}); });
  const onSignal = () => ready.catch(() => {}).then(() => shutdown()).catch(error => { console.error(error.message); process.exitCode = 1; });
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    state = { schemaVersion: 1, app: APP, pid: process.pid, phase: 'starting', dataDir: config.dataDir, token, controlPort: config.control.port };
    await writeState(config, state);
    studio = await createStudioServer({ dataDir: config.dataDir, production: true });
    await new Promise((resolve, reject) => {
      studio.httpServer.once('error', reject);
      studio.httpServer.listen(0, '127.0.0.1', resolve);
    });
    state = { ...state, phase: 'ready', url: `http://127.0.0.1:${studio.httpServer.address().port}` };
    await writeState(config, state);
    const info = { app: APP, pid: process.pid, url: state.url, dataDir: config.dataDir };
    readyResolve(info);
    await log(config, `Ready at ${state.url}. Data: ${config.dataDir}`);
    console.log(JSON.stringify({ ...info, reused: false }));
    if (!noOpen) await openBrowser(state.url);
  } catch (error) {
    readyReject(error);
    await shutdown();
    throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--no-open', '--stop'].includes(arg))) throw new Error('Usage: desktop-launcher.mjs [--no-open] [--stop]');
  const config = await paths();
  try {
    if (args.includes('--stop')) await stop(config);
    else await start(config, args.includes('--no-open'));
  } catch (error) {
    await log(config, `ERROR: ${error.stack || error.message}`).catch(() => {});
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
