import React, { useEffect, useRef, useState } from 'react';
import { errorMessage } from './i18n.js';

export default function PatchReviewDialog({ t, locale, initialText, onClose, onPreview, onApply, downloadJson }) {
  const [text, setText] = useState(initialText);
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('button')?.focus();
    return () => previous?.focus?.();
  }, []);
  async function inspect() {
    setBusy(true); setError(''); setPreview(null);
    try {
      let patch;
      try { patch = JSON.parse(text); } catch { throw new Error('import.invalidJson'); }
      const checked = await onPreview(patch);
      setPreview({ patch, changes: checked.changes });
      setSelected(checked.changes.map((_, i) => i));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function apply() {
    setBusy(true); setError('');
    try { await onApply(preview.patch, selected); onClose(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  function keyboard(e) {
    if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onClose(); }
    if (e.key !== 'Tab') return;
    const items = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')];
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
  return <div className="modal-backdrop" onClick={e => { if (!busy && e.target === e.currentTarget) onClose(); }}>
    <section ref={ref} className="modal patch-review-modal" role="dialog" aria-modal="true" aria-label={t('patchDialog')} onKeyDown={keyboard}>
      <div className="modal-heading"><h2 id="patch-review-title">{t('patchDialogTitle')}</h2><button className="tool" aria-label={t('closePatch')} disabled={busy} onClick={onClose}>×</button></div>
      <p>{t('patch.previewHint')}</p>
      <textarea aria-label={t('patchJSON')} value={text} spellCheck={false} disabled={busy} onChange={e => { setText(e.target.value); setPreview(null); setSelected([]); setError(''); }} />
      <div className="import-format-actions">
        <button data-testid="preview-ui-patch" className="button" disabled={busy || !text.trim()} onClick={inspect}>{t('patch.preview')}</button>
        <button className="text-button" disabled={busy} onClick={() => { try { downloadJson('incremental.patch.json', JSON.parse(text)); } catch { setError('import.invalidJson'); } }}>{t('savePatch')}</button>
      </div>
      {error && <p className="import-error" role="alert">{errorMessage(locale, error)}</p>}
      {preview && <div className="patch-review-list">
        <p>{t('patch.selectionHint')}</p>
        {preview.changes.map((change, i) => <label key={`${change.nodeId}:${change.path}`} className="patch-choice">
          <input type="checkbox" data-testid={`ui-patch-change-${i}`} disabled={busy} checked={selected.includes(i)} onChange={e => setSelected(old => e.target.checked ? [...old, i] : old.filter(v => v !== i))} />
          <span><strong>{change.nodeId}</strong><code>{change.path}</code><del>{JSON.stringify(change.before)}</del><ins>{JSON.stringify(change.after)}</ins></span>
        </label>)}
      </div>}
      <div className="modal-footer"><button className="button subtle" disabled={busy} onClick={onClose}>{t('import.cancel')}</button><button className="button primary" data-testid="apply-ui-patch" disabled={busy || !preview || !selected.length} onClick={apply}>{t('applyPatch')}{preview ? ` (${selected.length}/${preview.changes.length})` : ''}</button></div>
    </section>
  </div>;
}
