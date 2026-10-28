/** Local task contracts reuse the editor's authoritative patch and feedback models. */
import { applyPatch, buildFeedback, validateProject } from './model.js';
import { applyMapPatch, buildMapFeedback, validateMap } from './mapModel.js';
import { applyAnimationPatch, createAnimationFeedback, validateAnimationProject, checkAnimationProject, getAnimationRenderBounds } from './animationModel.js';

export const TASK_KINDS = ['ui', 'map', 'animation'];
export const TASK_STATUSES = ['pending', 'exported', 'review', 'approved', 'needs_revision', 'rolled_back'];
const clone = value => structuredClone(value);
const fail = message => { throw new Error(message); };
export function validateTaskScope(kind, project, reviewIds) {
  if (!TASK_KINDS.includes(kind)) fail('Unknown task workspace.');
  ({ ui: validateProject, map: validateMap, animation: validateAnimationProject })[kind](project);
  if (!Array.isArray(reviewIds) || !reviewIds.length || reviewIds.length > 100 || new Set(reviewIds).size !== reviewIds.length) fail('Select 1–100 unique pending reviews.');
  const reviews = reviewIds.map(id => project.reviews.find(r => r.id === id));
  if (reviews.some(r => !r || r.status !== 'pending')) fail('A selected review is missing or no longer pending.');
  return reviews;
}

export function taskFeedback(kind, project, reviewIds) {
  validateTaskScope(kind, project, reviewIds);
  const scoped = clone(project);
  // Unselected unresolved reviews still constrain the task but are never actionable work.
  for (const review of scoped.reviews) if (review.status === 'pending' && !reviewIds.includes(review.id)) review.status = 'modified';
  const feedback = ({ ui: buildFeedback, map: buildMapFeedback, animation: createAnimationFeedback })[kind](scoped);
  if (kind === 'map') feedback.constraints = project.reviews.filter(r => r.status !== 'approved').map(r => ({ reviewId: r.id, target: clone(r.target), protectedProperties: clone(r.protectedProperties) }));
  return feedback;
}

export function taskPatchTemplate(kind, project, reviewIds) {
  return { schemaVersion: 1, ...(kind === 'ui' ? {} : { kind: kind === 'map' ? 'studio-map-patch' : 'studio-animation-patch' }), projectId: project.id, baseRevision: project.revision, summary: 'Describe the scoped revision', reviewIds: [...reviewIds], [kind === 'animation' ? 'operations' : 'changes']: [] };
}

export function previewTaskPatch(task, project, patch) {
  if (!task || task.projectId !== project.id) fail('The task belongs to another document.');
  if (!['pending', 'exported', 'needs_revision', 'rolled_back'].includes(task.status)) fail('This task is already awaiting acceptance or has been accepted.');
  validateTaskScope(task.kind, project, task.reviewIds);
  if (project.revision !== task.baseRevision || patch?.baseRevision !== task.baseRevision) fail('The document changed. Export a fresh task package; do not rewrite the patch revision.');
  if (!Array.isArray(patch.reviewIds) || patch.reviewIds.length !== task.reviewIds.length || new Set(patch.reviewIds).size !== patch.reviewIds.length || patch.reviewIds.some(id => !task.reviewIds.includes(id))) fail('The result must address exactly this task’s review IDs.');
  let next, changes;
  if (task.kind === 'animation') {
    const result = applyAnimationPatch(project, patch);
    next = result.project;
    changes = result.diff.filter(change => change.path !== 'reviews');
  } else {
    next = (task.kind === 'ui' ? applyPatch : applyMapPatch)(project, patch);
    changes = next.history.at(-1).changes;
  }
  if (!changes.length) fail('The task result makes no actual design changes.');
  const targetKey = change => change.nodeId || change.objectId || (change.clipId ? `${change.clipId}/${change.frameId}` : `${change.layerId || change.type}/${change.x},${change.y}`);
  const targetCount = new Set(changes.map(targetKey)).size;
  const totalTargets = task.kind === 'ui' ? project.nodes.length : task.kind === 'map' ? project.objects.length + project.layers.reduce((sum, layer) => sum + Object.keys(layer.cells).length, 0) : project.clips.reduce((sum, clip) => sum + clip.frames.length, 0);
  const checks = [
    { code: 'schema', status: 'passed' }, { code: 'scope-and-protection', status: 'passed' },
    { code: 'references-and-size', status: 'passed' },
  ];
  const warnings = [];
  if (targetCount > Math.max(5, totalTargets * .25)) warnings.push({ code: 'broad-change', message: 'This task changes more than a quarter of document targets. Review whether all changes are necessary.' });
  let renderBounds;
  if (task.kind === 'animation') {
    renderBounds = { before: getAnimationRenderBounds(project), after: getAnimationRenderBounds(next) };
    const beforeErrors = new Set(checkAnimationProject(project).filter(f => f.severity === 'error').map(f => JSON.stringify(f)));
    const findings = checkAnimationProject(next);
    const newErrors = findings.filter(f => f.severity === 'error' && !beforeErrors.has(JSON.stringify(f)));
    if (newErrors.length) fail(`Animation validation failed: ${newErrors.map(f => f.message).join('; ')}`);
    warnings.push(...findings);
    checks.push({ code: 'animation-bounds', status: 'passed', bodyReference: clone(next.canvas), renderBounds: clone(renderBounds.after) });
  }
  return { project: next, changes: clone(changes), summary: { changedFields: changes.length, changedTargets: targetCount, totalTargets }, checks, warnings, ...(renderBounds ? { renderBounds } : {}), artAcceptance: 'manual' };
}

export function taskChecklist(kind, reviews) {
  return { functional: ['Review scope and protected fields preserved', 'Structure, resource references and sizes validate', ...(kind === 'animation' ? ['Shared frame bounds preserve motion outside the body reference'] : [])], visual: reviews.map(review => ({ reviewId: review.id, target: review.target, expected: review.expected })), instruction: 'Machine checks do not approve artwork. A person must inspect the actual UI/map/animation and accept the expected result.' };
}
