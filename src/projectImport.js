import { validateProject } from './model.js';

export const MAX_PROJECT_BYTES = 25 * 1024 * 1024;

export function inspectProjectImport(text) {
  if (!text?.trim()) throw new Error('import.empty');
  if (new TextEncoder().encode(text).length > MAX_PROJECT_BYTES) throw new Error('import.tooLarge');
  let project;
  try { project = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('import.invalidJson'); }
  if (project?.kind === 'studio-component') throw new Error('import.component');
  if (project?.projectId && Array.isArray(project?.changes)) throw new Error('import.patch');
  validateProject(project);
  return project;
}

export function createProjectTemplate(name) {
  return {
    schemaVersion: 1, id: 'new-game-ui', name, revision: 1,
    canvas: { width: 960, height: 600, background: '#111b18' },
    tokens: { colors: {}, fonts: {}, rules: [] },
    assets: [], nodes: [], reviews: [], history: [],
  };
}
