import React, { useEffect, useRef, useState } from 'react';
import { GENERATION_TEMPLATES, validateGenerationRequest } from './generationModel.js';
import { generationText } from './generationMessages.js';

export default function GenerationDialog({ locale, project, onClose, onExport }) {
  const t = key => generationText(locale, key);
  const [name, setName] = useState(project.name);
  const [brief, setBrief] = useState('');
  const [template, setTemplate] = useState('character');
  const [width, setWidth] = useState(Math.min(4096, Math.max(320, project.canvas.width)));
  const [height, setHeight] = useState(Math.min(4096, Math.max(320, project.canvas.height)));
  const [rules, setRules] = useState('');
  const [includeContext, setIncludeContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector('input')?.focus();
    return () => previous?.focus?.();
  }, []);
  function change(setter, value) { setter(value); setResult(null); setError(''); }
  async function submit(event) {
    event.preventDefault();
    const payload = { name, brief, template, width: Number(width), height: Number(height), rules: rules.split('\n').map(rule => rule.trim()).filter(Boolean), includeContext, locale };
    try { validateGenerationRequest({ ...payload, baseRevision: project.revision }); }
    catch { setError('invalid'); return; }
    setBusy(true); setError(''); setResult(null);
    try { setResult(await onExport(payload)); }
    catch (cause) { setError(cause.message === 'generation.stale' ? 'stale' : cause.message === 'generation.invalid' ? 'invalid' : 'error'); }
    finally { setBusy(false); }
  }
  function keyboard(event) {
    if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose(); }
    if (event.key !== 'Tab') return;
    const targets = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]')];
    const first = targets[0], last = targets.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form ref={dialog} className="modal import-modal generation-modal" role="dialog" aria-modal="true" aria-labelledby="generation-title" aria-describedby="generation-description" onKeyDown={keyboard} onSubmit={submit} data-testid="generation-dialog">
      <div className="modal-heading"><h2 id="generation-title">{t('title')}</h2><button type="button" className="tool" aria-label={t('close')} disabled={busy} onClick={onClose}>×</button></div>
      <p id="generation-description">{t('intro')}</p>
      <label className="import-paste"><span>{t('name')}</span><input data-testid="generation-name" value={name} maxLength={200} required disabled={busy} onChange={event => change(setName, event.target.value)} /></label>
      <label className="import-paste"><span>{t('template')}</span><select data-testid="generation-template" value={template} disabled={busy} onChange={event => change(setTemplate, event.target.value)}>{GENERATION_TEMPLATES.map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <label className="import-paste"><span>{t('width')}</span><input data-testid="generation-width" type="number" min="320" max="4096" step="1" required value={width} disabled={busy} onChange={event => change(setWidth, event.target.value)} /></label>
        <label className="import-paste"><span>{t('height')}</span><input data-testid="generation-height" type="number" min="320" max="4096" step="1" required value={height} disabled={busy} onChange={event => change(setHeight, event.target.value)} /></label>
      </div>
      <label className="import-paste"><span>{t('brief')}</span><textarea data-testid="generation-brief" value={brief} maxLength={8000} required disabled={busy} placeholder={t('briefPlaceholder')} onChange={event => change(setBrief, event.target.value)} /></label>
      <label className="import-paste"><span>{t('rules')}</span><textarea data-testid="generation-rules" value={rules} disabled={busy} placeholder={t('rulesPlaceholder')} onChange={event => change(setRules, event.target.value)} /></label>
      <label className="import-backup"><input data-testid="generation-context" type="checkbox" checked={includeContext} disabled={busy} onChange={event => change(setIncludeContext, event.target.checked)} />{t('includeContext')}</label>
      <p className="hint">{t('contextHint')}</p>
      <p className="hint">{t('local')}</p>
      {error && <p className="import-error" role="alert">{t(error)}</p>}
      {result && <div className="import-summary" role="status" data-testid="generation-result"><strong>{t('ready')}</strong><a className="button primary" href={result.downloadUrl} download data-testid="generation-download">{t('download')}</a><p style={{ marginBottom: 0 }}>{t('next')}</p></div>}
      <div className="modal-footer"><button type="button" className="button subtle" disabled={busy} onClick={onClose}>{t('close')}</button><button className="button primary" data-testid="generation-export" disabled={busy}>{t(busy ? 'exporting' : 'export')}</button></div>
    </form>
  </div>;
}
