import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { zipSync, strToU8 } from 'fflate';
import { validateProject, applyPatch, rollbackPatch, buildFeedback } from '../src/model.js';
import { createGodotFiles } from './godot.js';
import { previewSelectedPatch } from '../src/patchSelection.js';
import { mountMapRoutes } from './mapRoutes.js';
import { createMapGodotFiles } from './mapGodot.js';
import { mountWorkbench } from './workbench.js';
import { mountGenerationRoutes } from './generationRoutes.js';
import { mountAnimationRoutes } from './animationRoutes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_PREFIXES = ['/assets/', '/local-assets/'];
const clone = value => structuredClone(value);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export async function createStudioServer({ dataDir = process.env.STUDIO_DATA_DIR || path.join(ROOT, 'data'), production = false, vite = true } = {}) {
  const app = express();
  const httpServer = createHttpServer(app);
  const projectFile = path.join(dataDir, 'project.json');
  const exportDir = path.join(dataDir, 'exports');
  const assetDir = path.join(dataDir, 'assets');
  const preferencesFile = path.join(dataDir, 'preferences.json');
  let preferences = { locale: null };
  try {
    const saved = JSON.parse(await fs.readFile(preferencesFile, 'utf8'));
    if (['zh-CN', 'en'].includes(saved.locale)) preferences.locale = saved.locale;
  } catch { /* Optional preferences never prevent opening the project. */ }
  await fs.mkdir(exportDir, { recursive: true });
  await fs.mkdir(assetDir, { recursive: true });
  const sample = () => fs.readFile(path.join(ROOT, 'examples/character.project.json'), 'utf8').then(JSON.parse);
  let current;
  try { current = validateProject(JSON.parse(await fs.readFile(projectFile, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; current = validateProject(await sample()); }
  async function persist(project) {
    validateProject(project);
    await Promise.all(project.assets.map(asset => resolveAssetPath(asset.src)));
    const temp = `${projectFile}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
    await fs.rename(temp, projectFile);
    current = clone(project);
    return clone(current);
  }
  await persist(current);
  // Serialize disk mutations so concurrent clients cannot pass the same revision check.
  let queue = Promise.resolve();
  const mutate = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = (req.headers.host || '').split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host)) return res.status(403).json({ error: 'Only localhost requests are allowed.' });
    const origin = req.headers.origin;
    if (origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(origin)) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    if (req.path.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'Send application/json.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '90mb' }));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/assets', express.static(path.join(ROOT, 'public/assets')));
  app.use('/local-assets', express.static(assetDir));
  app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'Game UI Studio', schemaVersion: 1 }));
  app.get('/api/preferences', (_req, res) => res.json(preferences));
  app.put('/api/preferences', async (req, res) => res.json(await mutate(async () => {
    if (!['zh-CN', 'en'].includes(req.body.locale)) throw fail('Unsupported interface language.');
    const next = { locale: req.body.locale };
    const temp = `${preferencesFile}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await fs.rename(temp, preferencesFile);
    preferences = next;
    return next;
  })));
  app.get('/api/project', (_req, res) => res.json(current));
  app.put('/api/project', async (req, res) => res.json(await mutate(async () => {
    if (req.body.id !== current.id) throw fail('Project identity changed; use Import project.');
    if (req.body.revision !== current.revision + 1) throw fail('The project changed in another window. Reload before saving.', 409);
    return persist(req.body);
  })));
  app.post('/api/import', async (req, res) => res.json(await mutate(async () => {
    const project = validateProject(req.body);
    return persist({ ...project, revision: current.revision + 1 });
  })));
  app.post('/api/reset', async (_req, res) => res.json(await mutate(async () => {
    const project = await sample();
    project.revision = current.revision + 1;
    return persist(project);
  })));
  app.get('/api/example-patch', async (_req, res) => {
    const patch = JSON.parse(await fs.readFile(path.join(ROOT, 'examples/recruit.patch.json'), 'utf8'));
    res.json({ ...patch, projectId: current.id, baseRevision: current.revision });
  });
  app.post('/api/patch/preview', (req, res) => res.json(previewSelectedPatch(clone(current), req.body.patch, req.body.selectedIndices)));
  app.post('/api/patch/selected', async (req, res) => res.json(await mutate(() => persist(previewSelectedPatch(current, req.body.patch, req.body.selectedIndices).project))));
  app.post('/api/patch', async (req, res) => res.json(await mutate(() => persist(applyPatch(current, req.body)))));
  app.post('/api/rollback', async (req, res) => res.json(await mutate(() => persist(rollbackPatch(current, req.body.historyId)))));

  async function resolveAssetPath(src) {
    const prefix = ASSET_PREFIXES.find(p => typeof src === 'string' && src.startsWith(p));
    if (!prefix) throw fail('Assets must use /assets/ or /local-assets/ paths.');
    const name = src.slice(prefix.length);
    if (!/^[A-Za-z0-9_./-]+$/.test(name) || name.split('/').some(part => !part || part.startsWith('.'))) throw fail('Invalid asset path.');
    const root = await fs.realpath(prefix === '/assets/' ? path.join(ROOT, 'public/assets') : assetDir);
    const target = await fs.realpath(path.join(root, name));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !(await fs.stat(target)).isFile()) throw fail('Asset is outside the project asset directory.');
    return target;
  }
  async function readAsset(src) {
    return fs.readFile(await resolveAssetPath(src));
  }
  async function archive(prefix, files, options = {}) {
    const name = `${prefix}-${Date.now()}-${randomUUID().slice(0, 6)}.zip`;
    const bytes = zipSync(files, { level: 6 });
    if (options.maxBytes && bytes.length > options.maxBytes) throw fail('The project ZIP exceeds the portable package limit.');
    await fs.writeFile(path.join(exportDir, name), bytes);
    return { path: `data/exports/${name}`, downloadUrl: `/api/files/${name}` };
  }
  const mapWorkspace = await mountMapRoutes(app, { dataDir, mutate, archive, readAsset, resolveAssetPath, createMapGodotFiles });
  await mountWorkbench(app, { dataDir, mutate, getUI: () => clone(current), setUI: project => persist({ ...project, revision: current.revision + 1 }), ...mapWorkspace, archive, readAsset });
  mountGenerationRoutes(app, { getProject: () => clone(current), archive, readAsset });
  await mountAnimationRoutes(app, { dataDir, mutate, archive });
  app.post('/api/feedback', async (req, res) => {
    const project = clone(current);
    if (req.body.baseRevision !== project.revision) throw fail('The screenshot revision is out of date. Reload and export the feedback again.', 409);
    const feedback = buildFeedback(project);
    if (!feedback.reviews.length) throw fail('There are no pending reviews to export.');
    const screenshots = req.body.screenshots || {};
    const files = {};
    feedback.screenshots = {};
    for (const nodeId of new Set(feedback.reviews.map(review => review.nodeId))) {
      const data = screenshots[nodeId];
      if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,')) throw fail(`Missing local screenshot for ${nodeId}.`);
      const buffer = Buffer.from(data.slice('data:image/png;base64,'.length), 'base64');
      if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || buffer.length > 8 * 1024 * 1024) throw fail('Invalid screenshot PNG.');
      const safeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `screenshots/${safeId}.png`;
      files[filename] = buffer;
      feedback.screenshots[nodeId] = filename;
    }
    for (const asset of feedback.assets || []) {
      const name = `${asset.id.replace(/[^a-zA-Z0-9_-]/g, '_')}-${path.basename(asset.src)}`;
      files[`assets/${name}`] = await readAsset(asset.src);
      asset.feedbackPath = `assets/${name}`;
    }
    files['feedback.json'] = strToU8(JSON.stringify(feedback, null, 2));
    files['PATCH-INSTRUCTIONS.md'] = strToU8(`# Incremental review contract\n\nRead feedback.json and the local screenshots. Return only a JSON patch matching patch-template.json. Preserve projectId and baseRevision. Address only listed pending review IDs and their target node IDs. Change scalar fields explicitly requested; respect every protectedProperties path AND effectiveProtectedProperties for the node (prefix restrictions cover descendants, including other unresolved reviews). Do not generate a replacement screen or project. Never change stable IDs. Do not approve your own changes. Import the patch in Studio; conflicts are rejected.\n\nAllowed fields: frame.x/y/width/height; style.fill/stroke/strokeWidth/radius/color/fontSize/fontFamily/text/align/opacity; assetId; disabledAssetId; visible; layout.mode/gap/padding; buttonAssets.normal/hover/pressed. Check the current schema and node constraints.\n`);
    files['patch-template.json'] = strToU8(JSON.stringify({ schemaVersion: 1, projectId: project.id, baseRevision: project.revision, summary: 'Describe this revision', reviewIds: feedback.reviews.map(r => r.id), changes: [] }, null, 2));
    res.json({ ...await archive('feedback', files), count: feedback.reviews.length, baseRevision: project.revision });
  });
  app.post('/api/godot', async (_req, res) => {
    const { files, assets } = createGodotFiles(clone(current));
    const contents = Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)]));
    for (const asset of assets) contents[asset.destination] = await readAsset(asset.src);
    contents['ASSET-NOTICES.txt'] = strToU8('Original sample SVG artwork: MIT, see source repository LICENSE. DejaVu fonts: Bitstream Vera license and DejaVu public domain changes; see FONT-LICENSE.txt. User-imported assets retain their own licenses.');
    contents['FONT-LICENSE.txt'] = await fs.readFile(path.join(ROOT, 'public/assets/FONT-LICENSE.txt'));
    contents['ARTWORK-LICENSE.txt'] = await fs.readFile(path.join(ROOT, 'LICENSE'));
    res.json({ ...await archive('godot', contents), warnings: JSON.parse(files['export-warnings.json'] || '[]') });
  });
  app.post('/api/assets', async (req, res) => {
    const { name, kind, dataUrl } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 120) throw fail('Give the asset a short name.');
    if (!['portrait', 'background', 'nineSlice', 'button', 'icon', 'texture', 'font'].includes(kind)) throw fail('Unsupported asset category.');
    const match = typeof dataUrl === 'string' && dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
    if (!match) throw fail('Expected a base64 image or font file.');
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 15 * 1024 * 1024) throw fail('Asset must be between 1 byte and 15 MB.');
    const extensions = { 'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp', 'image/svg+xml':'svg', 'font/ttf':'ttf', 'font/otf':'otf', 'application/x-font-ttf':'ttf', 'application/x-font-opentype':'otf' };
    const extension = extensions[match[1]];
    if (!extension) throw fail('Supported formats: PNG, JPEG, WebP, safe SVG, TTF, OTF.');
    if (extension === 'svg') {
      const svg = buffer.toString('utf8');
      if (!/<svg\b/i.test(svg) || /<\s*(script|foreignObject|iframe|object|embed)|<!ENTITY|<!DOCTYPE|\bon\w+\s*=|(?:href|url)\s*[=(]\s*["']?(?!#)/i.test(svg)) throw fail('SVG must be self-contained, without scripts or external references.');
    }
    const id = `asset-${randomUUID()}`;
    const filename = `${id}.${extension}`;
    await fs.writeFile(path.join(assetDir, filename), buffer);
    res.json({ id, name: name.trim(), kind, src: `/local-assets/${filename}`, ...(kind === 'nineSlice' ? { margins: { left: 12, top: 12, right: 12, bottom: 12 } } : {}) });
  });
  app.get('/api/files/:name', async (req, res) => {
    if (!/^(feedback|godot|map-feedback|map-godot|generation|workspace|godot-update|animation-feedback|animation-godot)-[0-9]+-[a-f0-9]+\.zip$/.test(req.params.name)) throw fail('Unknown export.', 404);
    res.download(path.join(exportDir, req.params.name));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));
  let viteServer;
  if (production) {
    app.use(express.static(path.join(ROOT, 'dist')));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(ROOT, 'dist/index.html')));
  } else if (vite) {
    const { createServer } = await import('vite');
    viteServer = await createServer({ root: ROOT, server: { middlewareMode: true, ws: { server: httpServer } }, appType: 'spa' });
    app.use(viteServer.middlewares);
  }
  app.use((error, _req, res, _next) => {
    const status = error.status || (error.code === 'ENOENT' ? 404 : 400);
    res.status(status).json({ error: error.code === 'ENOENT' ? 'The requested local file is missing.' : error.message });
  });
  return { app, httpServer, close: () => viteServer?.close(), dataDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4380);
  const { httpServer } = await createStudioServer({ production: process.argv.includes('--production') });
  httpServer.listen(port, '127.0.0.1', () => console.log(`Game UI Studio is running locally on port ${port}. Data: ${process.env.STUDIO_DATA_DIR || path.join(ROOT, 'data')}`));
}
