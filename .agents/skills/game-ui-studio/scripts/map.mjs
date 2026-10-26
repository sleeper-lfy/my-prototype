#!/usr/bin/env node
/** Native map file exchange. Every mutation is validated by the installed app model. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverRoot, localUrl } from './review.mjs';

const SELF = fileURLToPath(import.meta.url);
const MAX_JSON = 25 * 1024 * 1024;
const HELP = `Game UI Studio map CLI

inspect  --project <map.json>
validate --project <map.json> [--patch <map.patch.json>] [--select 0,2]
preview  --project <map.json> --patch <map.patch.json> --out <new-file.json> [--select 0,2]
apply    --patch <map.patch.json> --url <http://127.0.0.1:port> [--select 0,2]
rollback --history-id <actual-id> --url <http://127.0.0.1:port>

All commands accept --root <app-directory>. inspect reports pending review data,
not image inspection. validate/preview require the real complete map document.
--select uses zero-based indices of patch.changes, matching Studio acceptance.
Partial acceptance keeps reviews pending. No command marks a review approved.
Only preview creates a new file; apply/rollback use the running local API.
`;

function requireThat(condition, message) { if (!condition) throw new Error(message); }
function parse(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) return { help: HELP };
  const [command, ...args] = argv;
  const allowed = {
    inspect: ['root', 'project'], validate: ['root', 'project', 'patch', 'select'],
    preview: ['root', 'project', 'patch', 'out', 'select'],
    apply: ['root', 'patch', 'url', 'select'], rollback: ['root', 'history-id', 'url'],
  };
  requireThat(Object.hasOwn(allowed, command), 'Unknown map command. Use --help.');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2);
    requireThat(args[i].startsWith('--') && allowed[command].includes(key), `Unknown option: ${args[i]}`);
    requireThat(args[i + 1] && !args[i + 1].startsWith('--') && !Object.hasOwn(options, key), `Missing or repeated option: ${args[i]}`);
    options[key] = args[i + 1];
  }
  const required = { inspect: ['project'], validate: ['project'], preview: ['project', 'patch', 'out'], apply: ['patch', 'url'], rollback: ['history-id', 'url'] };
  for (const key of required[command]) requireThat(options[key], `Missing --${key}.`);
  if (options.select !== undefined) {
    requireThat(/^(0|[1-9]\d*)(,(0|[1-9]\d*))*$/.test(options.select), '--select needs comma-separated zero-based indices.');
    options.selectedIndices = options.select.split(',').map(Number);
    requireThat(new Set(options.selectedIndices).size === options.selectedIndices.length, 'Repeated selection index.');
    requireThat(options.patch, '--select requires --patch.');
  }
  return { command, options };
}
async function readJson(filename) {
  const stat = await fs.stat(filename);
  requireThat(stat.isFile() && stat.size > 0 && stat.size <= MAX_JSON, 'Map JSON must be a regular file of at most 25 MiB.');
  return JSON.parse((await fs.readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
}
async function request(url, endpoint, body) {
  const response = await fetch(`${url}${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  const result = await response.json();
  requireThat(response.ok, result.error || `Request failed (${response.status}).`);
  return result;
}
export async function runMapCli(argv) {
  const parsed = parse(argv);
  if (parsed.help) return parsed;
  const { command, options } = parsed;
  const root = await discoverRoot(options.root);
  const model = await import(pathToFileURL(path.join(root, 'src/mapModel.js')).href);
  const origin = options.url ? localUrl(options.url) : null;
  if (command === 'rollback') {
    const current = model.validateMap(await request(origin, '/api/map'));
    model.rollbackMapPatch(current, options['history-id']);
    const saved = model.validateMap(await request(origin, '/api/map/rollback', { historyId: options['history-id'] }));
    return { status: 'rolled-back', projectId: saved.id, revision: saved.revision, history: saved.history.at(-1), visualReviewPerformed: false };
  }
  const current = model.validateMap(command === 'apply' ? await request(origin, '/api/map') : await readJson(options.project));
  if (command === 'inspect') return {
    status: 'inspected', projectId: current.id, revision: current.revision,
    grid: current.grid, layers: current.layers.map(({ id, name, visible, locked }) => ({ id, name, visible, locked })),
    feedback: model.buildMapFeedback(current), visualReviewPerformed: false,
    note: 'Read the exported feedback ZIP screenshots separately. This command does not inspect images.',
  };
  if (!options.patch) return { status: 'valid-map', projectId: current.id, revision: current.revision, visualReviewPerformed: false };
  const patch = await readJson(options.patch);
  const preview = model.previewMapPatch(current, patch, { selectedIndices: options.selectedIndices });
  const result = { status: 'valid-patch', projectId: current.id, baseRevision: current.revision, changes: preview.changes, partial: preview.project.history.at(-1).partial, visualReviewPerformed: false };
  if (command === 'apply') {
    const saved = model.validateMap(await request(origin, '/api/map/patch', { patch, ...(options.selectedIndices ? { selectedIndices: options.selectedIndices } : {}) }));
    return { ...result, status: 'applied', revision: saved.revision, history: saved.history.at(-1) };
  }
  if (command === 'preview') {
    const output = path.resolve(options.out);
    const parent = await fs.realpath(path.dirname(output));
    // The conventional live document names are never preview outputs, even through aliases.
    requireThat(!['map.json', 'project.json'].includes(path.basename(output).toLowerCase()), 'Use a distinct *.preview.json output filename.');
    const source = await fs.realpath(path.resolve(options.project));
    requireThat(path.join(parent, path.basename(output)) !== source, 'Preview output cannot replace the source map.');
    await fs.writeFile(output, `${JSON.stringify(preview.project, null, 2)}\n`, { flag: 'wx' });
    return { ...result, status: 'preview-written', output, note: 'Only this new file was written. The active map is unchanged.' };
  }
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  runMapCli(process.argv.slice(2)).then(result => console.log(result.help || JSON.stringify(result, null, 2))).catch(error => {
    console.error(JSON.stringify({ status: 'error', error: error.message })); process.exitCode = 1;
  });
}
