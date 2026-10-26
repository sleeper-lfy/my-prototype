import { applyPatch } from './model.js';

/** Validate the entire proposal before exposing or accepting any chosen scalar diff. */
export function previewSelectedPatch(project, patch, selectedIndices) {
  const complete = applyPatch(project, patch);
  const changes = complete.history.at(-1).changes;
  if (selectedIndices === undefined) return { project: complete, changes };
  if (!Array.isArray(selectedIndices) || !selectedIndices.length ||
      new Set(selectedIndices).size !== selectedIndices.length ||
      selectedIndices.some(i => !Number.isInteger(i) || i < 0 || i >= changes.length)) {
    throw new Error('Select at least one valid change.');
  }
  if (selectedIndices.length === changes.length) return { project: complete, changes };
  const chosen = selectedIndices.map(i => changes[i]);
  const grouped = new Map();
  for (const change of chosen) {
    if (!grouped.has(change.nodeId)) grouped.set(change.nodeId, {});
    grouped.get(change.nodeId)[change.path] = change.after;
  }
  const reviewIds = patch.reviewIds.filter(id => grouped.has(project.reviews.find(r => r.id === id)?.nodeId));
  const result = applyPatch(project, { ...patch, reviewIds, changes: [...grouped].map(([nodeId, set]) => ({ nodeId, set })) });
  // A partial acceptance cannot establish that any entire request was completed.
  for (const review of result.reviews) if (reviewIds.includes(review.id)) review.status = 'pending';
  result.history.at(-1).partial = true;
  result.history.at(-1).acceptedChangeCount = chosen.length;
  result.history.at(-1).proposedChangeCount = changes.length;
  return { project: result, changes: result.history.at(-1).changes };
}
