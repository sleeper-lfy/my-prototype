import React, { useEffect, useRef, useState } from 'react';
import './codexTasks.css';

const call = async (url, body) => {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
  return result;
};
const base64 = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
const short = value => { const text = JSON.stringify(value); return text === undefined ? '—' : text.length > 260 ? text.slice(0, 260) + '…' : text; };

export default function CodexTaskQueue({ locale = 'zh-CN', onClose, onDocumentsChanged, captureScreenshots, workspace = 'ui' }) {
  const t = (zh, en) => locale === 'zh-CN' ? zh : en;
  const [state, setState] = useState(null), [kind, setKind] = useState(workspace), [selected, setSelected] = useState([]), [mode, setMode] = useState('individual');
  const [taskId, setTaskId] = useState(null), [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [functional, setFunctional] = useState(false), [visual, setVisual] = useState(false), [note, setNote] = useState(''), [showClosed, setShowClosed] = useState(false);
  const inputRef = useRef(null);
  const names = { ui: t('界面', 'UI'), map: t('地图', 'Map'), animation: t('动画', 'Animation') };
  const statusNames = { pending: t('待导出', 'Pending'), exported: t('已导出', 'Exported'), review: t('待人工验收', 'Awaiting acceptance'), approved: t('已通过', 'Approved'), needs_revision: t('需要继续修改', 'Needs revision'), rolled_back: t('已回退', 'Rolled back') };
  const checkNames = { schema: t('文档结构', 'Document structure'), 'scope-and-protection': t('任务范围与禁止修改属性', 'Scope and protected properties'), 'references-and-size': t('资源引用与尺寸', 'References and dimensions'), 'animation-bounds': t('动画范围与共同原点', 'Animation bounds and shared origin') };
  const load = async () => { const value = await call('/api/codex/tasks'); setState(value); return value; };
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  const task = state?.tasks.find(item => item.id === taskId);
  const doc = state?.documents.find(item => item.kind === kind);
  const taskDoc = state?.documents.find(item => item.kind === task?.kind);
  const available = doc?.reviews.filter(review => !state.tasks.some(item => item.kind === kind && item.projectId === doc.id && !['approved', 'rolled_back'].includes(item.status) && item.reviewIds.includes(review.id))) || [];
  const perform = async operation => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const choose = id => { setTaskId(id); setPreview(null); setFunctional(false); setVisual(false); setNote(''); setError(''); };
  const documentChanged = async value => { setState(value); setPreview(null); setFunctional(false); setVisual(false); await onDocumentsChanged?.(); };
  const create = () => perform(async () => {
    const value = await call('/api/codex/tasks', { queueRevision: state.revision, kind, reviewIds: selected, mode });
    setState(value); setSelected([]); choose(value.tasks.at(-1).id);
  });
  const exportTask = () => perform(async () => {
    const fresh = await load(), currentTask = fresh.tasks.find(item => item.id === task.id), currentDoc = fresh.documents.find(item => item.kind === task.kind);
    if (currentDoc.id !== task.projectId) throw Error(t('请先在项目工具箱打开此任务原来的文档。', 'Open this task’s original document in the project toolbox first.'));
    let capture = { baseRevision: currentDoc.revision };
    if (task.kind !== 'animation') {
      if (!captureScreenshots) throw Error(t('请打开对应工作区后导出，以获取真实组件截图。', 'Open the matching workspace before exporting actual review crops.'));
      capture = await captureScreenshots(task.kind, currentTask.reviewIds);
    }
    const value = await call(`/api/codex/tasks/${task.id}/export`, { queueRevision: fresh.revision, ...capture });
    const anchor = document.createElement('a'); anchor.href = value.downloadUrl; anchor.download = ''; anchor.click();
    await load(); setPreview(null);
    setNotice(t('已导出当前版本的局部任务包。将 ZIP 交给 Codex，并导入其返回的补丁。', 'Exported a scoped task package at the current revision. Give the ZIP to Codex, then import its returned patch.'));
  });
  const importResult = file => perform(async () => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) throw Error(t('结果文件不能超过 8 MiB。', 'The result file must not exceed 8 MiB.'));
    const body = /\.zip$/i.test(file.name) ? { zipBase64: await base64(file) } : { patch: JSON.parse(await file.text()) };
    setPreview(await call(`/api/codex/tasks/${task.id}/preview`, body));
    setNotice(t('已完成模型检查。请核对下面的实际变更后应用。', 'Model checks complete. Review the actual changes below before applying.'));
  });
  const apply = () => perform(async () => {
    await documentChanged(await call(`/api/codex/tasks/${task.id}/apply`, { queueRevision: state.revision, patch: preview.patch }));
    setNotice(t('修改已保存，等待人工验收。关闭队列可在实际工作区检查效果。', 'Changes saved and awaiting human acceptance. Close the queue to inspect the actual workspace.'));
  });
  const action = (name, body = {}) => perform(async () => {
    await documentChanged(await call(`/api/codex/tasks/${task.id}/${name}`, { queueRevision: state.revision, ...body }));
    setNotice(name === 'rollback' ? t('已回退，原意见恢复为待处理。', 'Rolled back; original reviews are pending again.') : name === 'accept' ? t('已记录人工验收。', 'Human acceptance recorded.') : t('已记录修改要求，请重新导出任务。', 'Revision requested. Export a fresh task package.'));
  });
  const report = preview || task?.result;
  const taskActive = taskDoc?.id === task?.projectId;
  const unchanged = taskActive && taskDoc?.revision === task?.appliedRevision;
  return <div className="codex-task-backdrop" role="presentation">
    <section className="codex-task-dialog" role="dialog" aria-modal="true" aria-label={t('Codex 任务与验收', 'Codex tasks and acceptance')} data-testid="codex-task-queue">
      <header><div><h2>{t('Codex 任务与验收', 'Codex tasks and acceptance')}</h2><p>{t('导出局部任务 → 导入补丁 → 检查差异 → 人工验收', 'Export scoped task → import patch → inspect changes → human acceptance')}</p></div><button type="button" onClick={onClose} disabled={busy} data-testid="codex-task-close">{t('返回工作区', 'Back to workspace')}</button></header>
      <div className="codex-task-messages" aria-live="polite">{error && <p role="alert" className="codex-task-error">{error}</p>}{notice && <p>{notice}</p>}</div>
      {!state ? <p>{t('正在读取本地任务…', 'Loading local tasks…')}</p> : <div className="codex-task-columns">
        <aside>
          <h3>{t('从待处理意见建立任务', 'Create tasks from pending reviews')}</h3>
          <label>{t('工作区', 'Workspace')}<select value={kind} disabled={busy} data-testid="codex-task-kind" onChange={e => { setKind(e.target.value); setSelected([]); }}>{Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <p className="codex-task-muted">{doc?.name} · r{doc?.revision}</p>
          <div className="codex-pending-reviews">{available.length ? available.map(review => <label key={review.id} className="codex-review-option"><input type="checkbox" disabled={busy} data-testid={`codex-review-${review.id}`} checked={selected.includes(review.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, review.id] : ids.filter(id => id !== review.id))} /><span><strong>{typeof review.target === 'string' ? review.target : review.targetText || review.id}</strong><small>{review.expected}</small></span></label>) : <p>{t('没有未分配的待处理意见。请先在工作区添加评论。', 'No unassigned pending reviews. Add a review in the workspace first.')}</p>}</div>
          <label>{t('任务分组', 'Grouping')}<select value={mode} disabled={busy} data-testid="codex-task-grouping" onChange={e => setMode(e.target.value)}><option value="individual">{t('每条意见一个任务', 'One task per review')}</option><option value="combined">{t('所选意见合并为一个任务', 'Combine selected reviews')}</option></select></label>
          <button type="button" disabled={busy || !selected.length} onClick={create} data-testid="codex-task-create">{t('建立任务', 'Create tasks')} ({selected.length})</button>
          <div className="codex-task-list-title"><h3>{t('本地队列', 'Local queue')}</h3><button type="button" disabled={busy} onClick={() => perform(load)} data-testid="codex-task-refresh">{t('刷新', 'Refresh')}</button></div>
          <label className="codex-inline-check"><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />{t('显示已通过及已回退任务', 'Show accepted and rolled-back tasks')}</label>
          <div className="codex-task-list">{state.tasks.filter(item => showClosed || !['approved', 'rolled_back'].includes(item.status)).slice().reverse().map(item => <button type="button" key={item.id} disabled={busy} onClick={() => choose(item.id)} className={taskId === item.id ? 'selected' : ''} data-testid={`codex-task-item-${item.id}`}><span>{names[item.kind]} · {item.title}</span><small>{statusNames[item.status]} · {item.reviewIds.length} {t('条意见', 'reviews')}</small></button>)}</div>
        </aside>
        <main>{!task ? <div className="codex-task-empty"><h3>{t('选择或建立一个任务', 'Select or create a task')}</h3><p>{t('每个任务只携带对应意见、必要上下文、真实局部截图和修改限制。补丁会按实际项目版本验证。', 'Each task contains its reviews, necessary context, actual crops and constraints. Patches are validated against the real document revision.')}</p><p>{t('云端 Codex 使用 ZIP/JSON 文件交换；无需付费 API。', 'Cloud Codex exchanges ZIP/JSON files; no paid API is required.')}</p></div> : <>
          <div className="codex-task-detail-title"><div><h3>{task.title}</h3><p>{names[task.kind]} · {task.projectName} · {statusNames[task.status]}</p><code>{task.id}</code></div><span>r{task.baseRevision}</span></div>
          {!taskActive && <p className="codex-task-warning">{t('当前打开的是另一份文档，请先在项目工具箱切换。', 'Another document is active. Switch documents in the project toolbox first.')}</p>}
          {taskActive && ['pending', 'exported', 'needs_revision', 'rolled_back'].includes(task.status) && taskDoc.revision !== task.baseRevision && <p className="codex-task-warning">{t('文档版本已变化。重新导出任务并让 Codex 复核；旧补丁不能直接更改版本号后应用。', 'The document revision changed. Re-export and have Codex reconsider the task; do not merely rewrite the old patch revision.')}</p>}
          <div className="codex-task-actions">
            <button type="button" disabled={busy || !taskActive || !['pending', 'exported', 'needs_revision', 'rolled_back'].includes(task.status)} onClick={exportTask} data-testid="codex-task-export">{t('导出任务 ZIP', 'Export task ZIP')}</button>
            <button type="button" disabled={busy || !taskActive || !['pending', 'exported', 'needs_revision', 'rolled_back'].includes(task.status)} onClick={() => inputRef.current?.click()} data-testid="codex-task-import">{t('导入 Codex 结果', 'Import Codex result')}</button>
            <input ref={inputRef} hidden type="file" accept=".json,.zip" data-testid="codex-task-file" onChange={e => { const file = e.target.files[0]; e.target.value = ''; importResult(file); }} />
          </div>
          <p className="codex-task-muted">{t('结果格式：补丁 JSON，或包含 patch.json 的 ZIP。导出后每个任务按当前版本单独处理。', 'Result format: patch JSON, or ZIP containing patch.json. Process each task against its freshly exported revision.')}</p>
          {task.rejectionNote && <blockquote>{task.rejectionNote}</blockquote>}
          {report && <section className="codex-task-report" data-testid="codex-task-report"><h3>{t('实际变更', 'Actual changes')}</h3><p data-testid="codex-task-change-count">{report.summary.changedTargets} {t('个目标', 'targets')} · {report.summary.changedFields} {t('项属性', 'fields')}</p>
            <ul className="codex-task-checks">{report.checks.map(check => <li key={check.code}>✓ {checkNames[check.code] || check.code}</li>)}</ul>
            {report.renderBounds && <p>{t('输出范围', 'Render bounds')}: {report.renderBounds.before.width}×{report.renderBounds.before.height} → {report.renderBounds.after.width}×{report.renderBounds.after.height} {t('（主体参考不限制攻击范围）', '(body reference does not limit attacks)')}</p>}
            <div className="codex-task-diff"><table><thead><tr><th>{t('目标 / 属性', 'Target / field')}</th><th>{t('修改前', 'Before')}</th><th>{t('修改后', 'After')}</th></tr></thead><tbody>{report.changes.slice(0, 100).map((change, index) => <tr key={index}><td>{change.nodeId || change.objectId || change.frameId || `${change.x},${change.y}`}<br /><code>{change.path || change.type}</code></td><td>{short(change.before)}</td><td>{short(change.after)}</td></tr>)}</tbody></table></div>
            {report.changes.length > 100 && <p>{t('表格显示前 100 项；校验与应用包含全部变更。', 'Table shows the first 100 entries; validation and application include all changes.')}</p>}
            {!!report.warnings.length && <details><summary>{t('需要人工关注', 'Needs human review')} ({report.warnings.length})</summary><ul>{report.warnings.slice(0, 100).map((warning, index) => <li key={index}>{warning.code}: {warning.message}</li>)}</ul></details>}
            {preview && <button type="button" disabled={busy} onClick={apply} data-testid="codex-task-apply">{t('应用这些修改', 'Apply these changes')}</button>}
          </section>}
          {task.status === 'review' && <section className="codex-task-acceptance"><h3>{t('独立人工验收', 'Independent human acceptance')}</h3><p>{t('先返回工作区查看真实效果，再确认下面两项。自动检查不会批准美术质量。', 'Inspect the actual result in the workspace, then confirm both items below. Automated checks do not approve artwork.')}</p>
            {!unchanged && <p className="codex-task-warning">{t('结果应用后文档又发生了变化，已阻止误验收与覆盖回退。', 'The document changed after application. Acceptance and rollback are blocked to protect later edits.')}</p>}
            <label className="codex-inline-check"><input type="checkbox" checked={functional} onChange={e => setFunctional(e.target.checked)} data-testid="codex-task-functional" />{t('功能及修改限制符合要求', 'Behavior and constraints meet requirements')}</label>
            <label className="codex-inline-check"><input type="checkbox" checked={visual} onChange={e => setVisual(e.target.checked)} data-testid="codex-task-visual" />{t('已查看实际画面，美术效果符合本轮期望', 'Actual artwork inspected and meets this review’s expectation')}</label>
            <div className="codex-task-actions"><button type="button" disabled={busy || !unchanged || !functional || !visual} onClick={() => action('accept', { functional, visual })} data-testid="codex-task-accept">{t('通过验收', 'Accept result')}</button><button type="button" disabled={busy || !unchanged} onClick={() => action('rollback')} data-testid="codex-task-rollback">{t('回退本次修改', 'Roll back this result')}</button></div>
            <label>{t('仍需修改的地方', 'Remaining issue')}<textarea value={note} maxLength={2000} onChange={e => setNote(e.target.value)} data-testid="codex-task-rejection-note" /></label><button type="button" disabled={busy || !unchanged || !note.trim()} onClick={() => action('reject', { note })} data-testid="codex-task-reject">{t('退回继续修改', 'Request another revision')}</button>
          </section>}
          {task.status === 'approved' && <p className="codex-task-success">{t('此任务已由人工确认功能和美术效果。', 'A person accepted both behavior and visual quality for this task.')}</p>}
        </>}</main>
      </div>}
    </section>
  </div>;
}
