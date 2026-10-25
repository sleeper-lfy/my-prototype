import React, { useEffect, useRef, useState } from 'react';
import { errorMessage } from './i18n.js';
import { createProjectTemplate, inspectProjectImport, MAX_PROJECT_BYTES } from './projectImport.js';

export default function ImportDialog({ t, locale, busy, externalError, onClearError, onClose, onImport, downloadJson }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [checked, setChecked] = useState(null);
  const [error, setError] = useState('');
  const [backup, setBackup] = useState(true);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const dialogRef = useRef(null);
  const readEpoch = useRef(0);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector('button')?.focus();
    return () => { readEpoch.current++; previous?.focus?.(); };
  }, []);
  function inspect(value) {
    onClearError();
    try { const project = inspectProjectImport(value); setChecked(project); setError(''); }
    catch (e) { setChecked(null); setError(e.message); }
  }
  async function readFile(file) {
    if (!file || busy) return;
    const epoch = ++readEpoch.current;
    onClearError();
    setChecked(null); setError(''); setText(''); setFileName(file.name);
    if (!/\.json$/i.test(file.name)) { setError('import.wrongType'); return; }
    if (file.size > MAX_PROJECT_BYTES) { setError('import.tooLarge'); return; }
    try {
      const value = await file.text();
      if (epoch !== readEpoch.current) return;
      setText(value); inspect(value);
    } catch (e) { if (epoch === readEpoch.current) setError(e.message); }
  }
  function handleKey(event) {
    if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose(); }
    if (event.key !== 'Tab') return;
    const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]')].filter(el => !el.hidden);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return (
    <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={dialogRef} className="modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" aria-describedby="import-description" onKeyDown={handleKey}>
        <div className="modal-heading">
          <h2 id="import-title">{t('import.title')}</h2>
          <button className="tool" aria-label={t('import.close')} disabled={busy} onClick={onClose}>×</button>
        </div>
        <p id="import-description">{t('import.intro')}</p>
        <div className={`import-dropzone ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); readFile(event.dataTransfer.files[0]); }}>
          <strong>{t('import.drop')}</strong>
          <button className="button primary" disabled={busy} onClick={() => fileInput.current.click()}>{t('import.choose')}</button>
          {fileName && <span className="import-file-name">{t('import.fileName')}：{fileName}</span>}
        </div>
        <input ref={fileInput} hidden type="file" accept="application/json,.json" data-testid="project-file" aria-label={t('projectFile')} onChange={event => { readFile(event.target.files?.[0]); event.target.value = ''; }} />
        <label className="import-paste">
          <span>{t('import.paste')}</span>
          <textarea aria-label={t('import.paste')} value={text} placeholder={t('import.placeholder')} spellCheck={false} disabled={busy} onChange={event => { readEpoch.current++; onClearError(); setText(event.target.value); setChecked(null); setError(''); setFileName(''); }} />
        </label>
        <div className="import-format-actions">
          <button className="button" disabled={busy || !text.trim()} onClick={() => inspect(text)}>{t('import.check')}</button>
          <button className="text-button" onClick={() => downloadJson('game-ui-template.project.json', createProjectTemplate(t('untitled')))}>{t('import.template')}</button>
        </div>
        {(error || externalError) && <p role="alert" className="import-error">{errorMessage(locale, error || externalError)}</p>}
        {checked && <div className="import-summary" role="status">
          <strong>{t('import.valid')}</strong>
          <dl>
            <dt>{t('import.projectName')}</dt><dd>{checked.name}</dd>
            <dt>{t('import.size')}</dt><dd>{checked.canvas.width} × {checked.canvas.height}</dd>
            <dt>{t('import.components')}</dt><dd>{checked.nodes.length}</dd>
            <dt>{t('import.assets')}</dt><dd>{checked.assets.length}</dd>
            <dt>{t('import.reviews')}</dt><dd>{checked.reviews.length}</dd>
          </dl>
        </div>}
        <p className="import-replace">{t('import.replace')}</p>
        <label className="import-backup"><input type="checkbox" checked={backup} disabled={busy} onChange={event => setBackup(event.target.checked)} />{t('import.backup')}</label>
        <p className="hint">{t('import.backupHint')}</p>
        <div className="import-help"><p>{t('import.help')}</p><p>{t('import.helpAssets')}</p></div>
        <div className="modal-footer">
          <button className="button subtle" disabled={busy} onClick={onClose}>{t('import.cancel')}</button>
          <button className="button primary" data-testid="confirm-import" disabled={busy || !checked} onClick={() => onImport(checked, backup)}>{t('import.confirm')}</button>
        </div>
      </section>
    </div>
  );
}
