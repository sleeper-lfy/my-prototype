import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildGodotSourceUpdate, inspectGodotImport, MAX_GODOT_SCENE_BYTES, previewGodotMerge } from './godotImport.js';
import './godotImport.css';

const labels = {
  'zh-CN': {
    title: 'Godot 场景回读', read: '导入场景', write: '回写源场景副本', intro: '读取 Godot 4 .tscn 的标准 UI 节点。脚本不会执行；原场景、未知节点和属性保存在来源记录中。锚点按指定分辨率展开。', file: '选择 .tscn', config: '可选：project.godot', mapping: '可选：node-map.json', paste: '场景文本', width: '画布宽度（留空自动）', height: '画布高度（留空自动）', resources: '资源绑定', choose: '选择现有素材', upload: '上传对应资源', imported: '可编辑组件', preserved: '保留在源文件的其他节点', warnings: '支持范围与保留项', new: '备份当前 UI 并导入', merge: '合并匹配的稳定 ID', differences: '与当前 UI 的差异', conflicts: '合并冲突', mergeHint: '仅更新匹配 ID 的受支持字段，保留当前评论、历史和其他节点；锁定、保护属性及结构冲突会阻止合并。', sourceIntro: '下载修改后的 .tscn 副本。仅回写受支持的字段，保留脚本、未知节点、信号连接和外部资源引用。原文件不会被覆盖。材质、资源替换及结构变更需在 Godot 中处理。', reload: '可选：载入 Godot 中最新的源文件以检查冲突', noSource: '当前 UI 没有 Godot 来源记录，请先导入场景。', accepted: '使用工具中的此项修改', blocked: '无法自动回写的修改', download: '下载更新的 .tscn', changes: '待回写字段', close: '关闭', error: '无法处理场景', missing: '请绑定所有实际使用的纹理和字体。', empty: '选择或粘贴一个 Godot 4 .tscn 文件。', none: '无', path: '节点 / 属性', detail: '详情', before: '原值', after: '新值', external: 'Godot 中的值', all: '完整来源报告随设计 JSON 保存。', wrongType: '请选择 .tscn 文件。', tooLarge: '场景不能超过 4 MiB。', unsupported: '未映射内容只保留在来源中，Studio 画布和独立 Godot 导出不包含这些内容。', importName: '导入项目：', noChange: '没有可合并的修改。', saved: '资源已上传。', errorNetwork: '资源上传失败。',
  },
  en: {
    title: 'Godot scene readback', read: 'Import scene', write: 'Update source copy', intro: 'Read standard UI nodes from a Godot 4 .tscn. Scripts are never executed; original source, unknown nodes and properties stay in provenance. Anchors resolve at the selected viewport.', file: 'Choose .tscn', config: 'Optional: project.godot', mapping: 'Optional: node-map.json', paste: 'Scene text', width: 'Viewport width (blank = auto)', height: 'Viewport height (blank = auto)', resources: 'Resource bindings', choose: 'Choose a local asset', upload: 'Upload matching resource', imported: 'Editable components', preserved: 'Other nodes kept in source', warnings: 'Supported scope and preserved content', new: 'Back up current UI and import', merge: 'Merge matching stable IDs', differences: 'Differences against current UI', conflicts: 'Merge conflicts', mergeHint: 'Update supported fields on matching IDs only. Current reviews, history and other nodes remain. Locks, protected properties and structural conflicts block merging.', sourceIntro: 'Download an updated .tscn copy. Only supported fields are changed; scripts, unknown nodes, signal connections and external resources remain. The original file is never overwritten. Edit materials, resource replacements and structure in Godot.', reload: 'Optional: load the latest Godot source to check conflicts', noSource: 'This UI has no Godot provenance. Import a scene first.', accepted: 'Use this Studio change', blocked: 'Changes requiring manual source edits', download: 'Download updated .tscn', changes: 'Source field changes', close: 'Close', error: 'Cannot process scene', missing: 'Bind all textures and fonts used by editable components.', empty: 'Choose or paste a Godot 4 .tscn file.', none: 'None', path: 'Node / property', detail: 'Details', before: 'Before', after: 'After', external: 'Godot value', all: 'The complete source report is saved in design JSON.', wrongType: 'Choose a .tscn file.', tooLarge: 'Scene must be smaller than 4 MiB.', unsupported: 'Unmapped content stays in provenance; it is absent from the Studio canvas and separate Studio Godot exports.', importName: 'Import project:', noChange: 'No matching changes to merge.', saved: 'Resource uploaded.', errorNetwork: 'Resource upload failed.',
  },
};
const reasons = {
  'zh-CN': { 'new-node': '当前 UI 没有此稳定 ID，可选择作为新设计导入。', structure: '节点类型或父级不同。', locked: '组件或父级已锁定。', protected: '评论限制保护此属性。', 'asset-metadata-conflict': '相同资源 ID 的元数据不同。', 'resource-preserved': '资源仅保留在源文件中，不会加载或执行。', 'unsupported-resource': '仅支持映射到本地的纹理和字体。', 'missing-resource': '尚未绑定资源', 'unsupported-node': '此节点及其子级只保留在源文件中。', 'unsupported-parent': '父级不在支持范围内。', 'fixed-resolution': '锚点按当前画布尺寸展开；回写保留锚点。', 'container-minimum': 'Container 子项缺少明确的最小尺寸，需检查布局。', 'asymmetric-padding': '仅支持统一内边距，原始各边值保留在源文件。', 'unmapped-tint': '仅映射透明度，RGB 着色保留在源文件。', 'state-style': '画布显示常态样式，其他扁平状态样式保留在源文件。', 'asymmetric-style': '各边框/圆角不同，画布使用第一项，原值保留。', 'unsupported-style': '此样式资源仅保留在源文件。', 'script-preserved': '脚本引用保留，不执行、不修改。', 'property-preserved': '此属性仅保留在源文件。' },
};
const short = value => typeof value === 'string' ? value : JSON.stringify(value);
function downloadText(text, name) { const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

export default function GodotImportDialog({ project, locale = 'zh-CN', busy = false, onClose, onImport, onMerge }) {
  const language = locale === 'en' ? 'en' : 'zh-CN', t = labels[language];
  const [tab, setTab] = useState('read'), [text, setText] = useState(''), [fileName, setFileName] = useState('imported.tscn'), [config, setConfig] = useState(''), [nodeMap, setNodeMap] = useState(null), [width, setWidth] = useState(''), [height, setHeight] = useState(''), [bindings, setBindings] = useState({}), [uploaded, setUploaded] = useState([]), [error, setError] = useState(''), [working, setWorking] = useState(false), [latest, setLatest] = useState(null), [accepted, setAccepted] = useState([]);
  const ref = useRef(null), readEpoch = useRef(0), disabled = busy || working;
  useEffect(() => { const prior = document.activeElement; ref.current?.querySelector('button')?.focus(); return () => { readEpoch.current++; prior?.focus?.(); }; }, []);
  const inspection = useMemo(() => { if (!text.trim()) return null; try { return inspectGodotImport(text, { fileName, projectConfig: config, nodeMap, width: width === '' ? undefined : Number(width), height: height === '' ? undefined : Number(height), resourceBindings: bindings }); } catch (e) { return { error: e.message }; } }, [text, fileName, config, nodeMap, width, height, bindings]);
  const merge = useMemo(() => { if (!inspection?.project || !project) return null; try { return previewGodotMerge(project, inspection.project); } catch (e) { return { error: e.message }; } }, [project, inspection]);
  const sourceUpdate = useMemo(() => { if (!project?.godotSource) return null; try { return buildGodotSourceUpdate(project, latest ?? undefined, accepted); } catch (e) { return { error: e.message }; } }, [project, latest, accepted]);
  const assets = [...(project?.assets || []), ...uploaded];
  async function readFile(file, kind) {
    if (!file || disabled) return;
    const epoch = ++readEpoch.current; setError('');
    try {
      if (file.size > MAX_GODOT_SCENE_BYTES) throw new Error(t.tooLarge);
      if (['scene', 'latest'].includes(kind) && !/\.tscn$/i.test(file.name)) throw new Error(t.wrongType);
      const value = await file.text(); if (epoch !== readEpoch.current) return;
      if (kind === 'scene') { setText(value); setFileName(file.name); setBindings({}); }
      if (kind === 'config') setConfig(value);
      if (kind === 'mapping') setNodeMap(JSON.parse(value));
      if (kind === 'latest') { setLatest(value); setAccepted([]); }
    } catch (e) { setError(e.message); }
  }
  async function upload(file, resource) {
    if (!file) return; setWorking(true); setError('');
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('15 MiB maximum');
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      const ext = file.name.split('.').at(-1).toLowerCase(), mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf' }[ext];
      if (!mime) throw new Error(t.errorNetwork);
      const response = await fetch('/api/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name.slice(0, 120), kind: resource.type === 'FontFile' ? 'font' : 'texture', dataUrl: dataUrl.replace(/^data:[^;]*;/, `data:${mime};`) }) });
      const asset = await response.json(); if (!response.ok) throw new Error(asset.error || t.errorNetwork);
      setUploaded(value => [...value, asset]); setBindings(value => ({ ...value, [resource.id]: asset }));
    } catch (e) { setError(e.message); } finally { setWorking(false); }
  }
  async function apply(mode) { setWorking(true); setError(''); try { if (mode === 'merge') await onMerge(merge.project, project.revision); else await onImport(inspection.project, true); } catch (e) { setError(e.message); } finally { setWorking(false); } }
  const warningText = item => reasons[language]?.[item.code || item.reason] || item.detail || item.reason;
  function keys(event) {
    if (event.key === 'Escape') { event.stopPropagation(); if (!disabled) onClose(); }
    if (event.key !== 'Tab') return;
    const elements = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')].filter(element => element.getClientRects().length);
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !disabled) onClose(); }}><section className="modal godot-readback" role="dialog" aria-modal="true" aria-labelledby="godot-readback-title" data-testid="godot-readback-dialog" ref={ref} onKeyDown={keys}>
    <div className="modal-heading"><h2 id="godot-readback-title">{t.title}</h2><button className="tool" onClick={onClose} disabled={disabled} aria-label={t.close}>×</button></div>
    <div className="godot-readback-tabs"><button className={`button ${tab === 'read' ? 'primary' : ''}`} onClick={() => setTab('read')}>{t.read}</button><button className={`button ${tab === 'write' ? 'primary' : ''}`} data-testid="godot-source-tab" onClick={() => setTab('write')}>{t.write}</button></div>
    {error && <p role="alert" className="error">{error}</p>}
    {tab === 'read' ? <>
      <p>{t.intro}</p><p className="godot-readback-notice">{t.unsupported}</p>
      <div className="godot-readback-files"><label>{t.file}<input data-testid="godot-scene-file" type="file" accept=".tscn" disabled={disabled} onChange={event => { readFile(event.target.files?.[0], 'scene'); event.target.value = ''; }} /></label><label>{t.config}<input data-testid="godot-config-file" type="file" accept=".godot" disabled={disabled} onChange={event => readFile(event.target.files?.[0], 'config')} /></label><label>{t.mapping}<input data-testid="godot-mapping-file" type="file" accept=".json" disabled={disabled} onChange={event => readFile(event.target.files?.[0], 'mapping')} /></label></div>
      <label>{t.paste}<textarea data-testid="godot-scene-text" value={text} spellCheck={false} disabled={disabled} onChange={event => { readEpoch.current++; setText(event.target.value); }} /></label>
      <div className="godot-readback-files"><label>{t.width}<input type="number" min="1" max="16384" value={width} data-testid="godot-viewport-width" onChange={event => setWidth(event.target.value)} /></label><label>{t.height}<input type="number" min="1" max="16384" value={height} data-testid="godot-viewport-height" onChange={event => setHeight(event.target.value)} /></label></div>
      {!inspection && <p>{t.empty}</p>}{inspection?.error && <p role="alert" className="error">{inspection.error}</p>}
      {inspection?.project && <>
        <p data-testid="godot-import-summary"><strong>{t.importName} {inspection.project.name}</strong> · {t.imported}: {inspection.nodeCount} · {t.preserved}: {inspection.preservedNodeCount}</p>
        {inspection.resources.some(resource => resource.supported) && <fieldset><legend>{t.resources}</legend>{inspection.resources.filter(resource => resource.supported).map(resource => <div className="godot-resource-row" key={resource.id}><code>{resource.path}</code><select aria-label={`${t.choose} ${resource.id}`} data-testid={`godot-resource-${resource.id}`} value={bindings[resource.id]?.id || ''} onChange={event => { const asset = assets.find(item => item.id === event.target.value); setBindings(value => { const next = { ...value }; if (asset) next[resource.id] = asset; else delete next[resource.id]; return next; }); }}><option value="">{t.choose}</option>{assets.filter(asset => (asset.kind === 'font') === (resource.type === 'FontFile')).map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select><label className="godot-upload-label">{t.upload}<input type="file" accept={resource.type === 'FontFile' ? '.ttf,.otf' : '.png,.jpg,.jpeg,.webp,.svg'} disabled={disabled} onChange={event => { upload(event.target.files?.[0], resource); event.target.value = ''; }} /></label></div>)}</fieldset>}
        {!!inspection.unresolved.length && <p role="status">{t.missing}</p>}
        <details open={inspection.warnings.length > 0}><summary>{t.warnings} ({inspection.warnings.length})</summary><ul className="godot-report" data-testid="godot-import-warnings">{inspection.warnings.map((item, i) => <li key={i}><code>{item.path} · {item.property}</code><span>{warningText(item)}{item.code === 'missing-resource' && `: ${item.detail}`}</span></li>)}</ul></details>
        <details><summary>{t.differences} ({merge?.changes?.length || 0}) · {t.conflicts} ({merge?.conflicts?.length || 0})</summary><p>{t.mergeHint}</p>{merge?.error && <p role="alert">{merge.error}</p>}<ul className="godot-report" data-testid="godot-merge-diff">{merge?.changes?.map((item, i) => <li key={i}><code>{item.nodeId} · {item.property}</code><span>{short(item.before)} → {short(item.after)}</span></li>)}{merge?.conflicts?.map((item, i) => <li key={`conflict-${i}`} className="error"><code>{item.nodeId} · {item.property}</code><span>{warningText(item)}</span></li>)}</ul></details>
        <p>{t.all}</p><div className="godot-readback-actions"><button className="button primary" data-testid="godot-import-apply" disabled={disabled || !inspection.canImport} onClick={() => apply('new')}>{t.new}</button><button className="button" data-testid="godot-import-merge" disabled={disabled || !inspection.canImport || !merge?.canMerge || !onMerge} onClick={() => apply('merge')}>{t.merge}</button></div>
      </>}
    </> : <>
      <p>{t.sourceIntro}</p>{!sourceUpdate ? <p>{t.noSource}</p> : <>
        <label>{t.reload}<input data-testid="godot-latest-source" type="file" accept=".tscn" disabled={disabled} onChange={event => readFile(event.target.files?.[0], 'latest')} /></label>
        {sourceUpdate.error && <p className="error" role="alert">{sourceUpdate.error}</p>}
        <p data-testid="godot-source-summary">{t.changes}: {sourceUpdate.changes?.length || 0} · {t.conflicts}: {sourceUpdate.conflicts?.length || 0} · {t.blocked}: {sourceUpdate.blocked?.length || 0}</p>
        <ul className="godot-report">{sourceUpdate.changes?.map((item, i) => <li key={i}><code>{item.path} · {item.property}</code><span>{short(item.before)} → {short(item.after)}</span></li>)}</ul>
        {!!sourceUpdate.conflicts?.length && <fieldset><legend>{t.conflicts}</legend>{sourceUpdate.conflicts.map(item => <div key={item.key} className="godot-source-conflict"><code>{item.path} · {item.property}</code><p>{t.before}: {short(item.before)}<br />{t.external}: {short(item.external)}<br />{t.after}: {short(item.desired)}</p><label><input type="checkbox" data-testid="godot-source-accept" checked={accepted.includes(item.key)} onChange={event => setAccepted(value => event.target.checked ? [...value, item.key] : value.filter(key => key !== item.key))} />{t.accepted}</label></div>)}</fieldset>}
        {!!sourceUpdate.blocked?.length && <fieldset><legend>{t.blocked}</legend><ul className="godot-report">{sourceUpdate.blocked.map((item, i) => <li key={i}><code>{item.nodeId} · {item.property}</code><span>{item.reason}</span></li>)}</ul></fieldset>}
        <button className="button primary" data-testid="godot-source-download" disabled={disabled || !sourceUpdate.canExport} onClick={() => downloadText(sourceUpdate.text, (project.godotSource.fileName || 'scene.tscn').replace(/\.tscn$/i, '') + '.studio-updated.tscn')}>{t.download}</button>
      </>}
    </>}
  </section></div>;
}
