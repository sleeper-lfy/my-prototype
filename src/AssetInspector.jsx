import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildAssetIndex, getAssetDocument, getAssetRecord, planAssetUpdate, inspectPixelImage, inspectAssetUsage, cropInspectionImage } from './assetInspection.js';
import { renderAnimationFrame } from './animationModel.js';
import './assetInspector.css';

async function request(url, body, method = 'GET') {
  const response = await fetch(url, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || String(response.status));
  return value;
}
const readFile = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
async function decode(src) {
  const img = new Image(); img.src = src; await img.decode();
  if (img.naturalWidth > 4096 || img.naturalHeight > 4096 || !img.naturalWidth || !img.naturalHeight) throw new Error('Image checks support images up to 4096 × 4096 pixels.');
  const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(img, 0, 0);
  return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
}
function PixelPreview({ image, label, repeat = false }) {
  const ref = useRef();
  useEffect(() => {
    if (!image || !ref.current) return;
    const canvas = ref.current, scale = repeat ? 2 : 1; canvas.width = image.width * scale; canvas.height = image.height * scale;
    const context = canvas.getContext('2d'); const pixels = new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height);
    if (repeat === 'isometric') {
      const tile = document.createElement('canvas'); tile.width = image.width; tile.height = image.height; tile.getContext('2d').putImageData(pixels, 0, 0);
      for (const [x, y] of [[.5, 0], [0, .5], [1, .5], [.5, 1]]) context.drawImage(tile, Math.round(x * image.width), Math.round(y * image.height));
    } else for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) context.putImageData(pixels, x * image.width, y * image.height);
  }, [image, repeat]);
  return <figure className="asset-pixel-preview"><figcaption>{label}</figcaption><div><canvas ref={ref} aria-label={label} /></div>{image && <small>{image.width} × {image.height} px</small>}</figure>;
}
const messages = {
  'empty-image': ['图片完全透明', 'Fully transparent image'],
  'partial-alpha': ['存在半透明像素', 'Partially transparent pixels'],
  'edge-fringe': ['透明边缘可能存在杂边', 'Possible transparent-edge fringe'],
  'palette-drift': ['像素颜色超出指定调色板', 'Pixels outside the specified palette'],
  'many-colors': ['颜色数量超过 256', 'More than 256 colors'],
  'tile-seam': ['重复拼接边缘差异较大', 'Opposite tile edges differ'],
  'tile-seam-unmeasurable': ['未找到可比较的菱形边缘，请人工检查拼接预览', 'No comparable diamond edges; review the tiled preview manually'],
  'fractional-scale': ['使用位置存在非整数像素缩放', 'Usage has fractional pixel scaling'],
  'fractional-footprint': ['占地尺寸不是整数格', 'Footprint uses fractional cells'],
  'grid-size': ['瓦片尺寸不是格像素尺寸的整数倍', 'Tile dimensions are not multiples of the grid size'],
};
const translatedErrors = {
  'The replacement image is smaller than this atlas region.': '替换图片无法覆盖当前图集裁切区域。',
  'The replacement image is smaller than the nine-slice margins.': '替换图片小于九宫格边距。',
  'Image checks support images up to 4096 × 4096 pixels.': '体检图片最大支持 4096 × 4096 像素。',
  'The animation changed. Reload before saving or applying this patch.': '动画已在其他位置修改，请刷新后重试。',
  'The project changed in another window. Reload before saving.': '页面已在其他窗口修改，请刷新后重试。',
  'The map changed in another window. Reload before saving.': '地图已在其他窗口修改，请刷新后重试。',
  'Invalid pixel image dimensions': '图片尺寸超出动画资源允许范围：身体部件最大 256×256，帧图最大 1024×1024。',
};

export default function AssetInspector({ locale = 'zh-CN', onClose, onChanged }) {
  const zh = locale === 'zh-CN', t = (a, b) => zh ? a : b;
  const [snapshot, setSnapshot] = useState(null), [query, setQuery] = useState(''), [selected, setSelected] = useState('');
  const [image, setImage] = useState(null), [report, setReport] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [provenance, setProvenance] = useState({}), [replacement, setReplacement] = useState(null), [preview, setPreview] = useState(null);
  const [pixelMode, setPixelMode] = useState(true), [seamMode, setSeamMode] = useState('off'), [palette, setPalette] = useState(''), [offset, setOffset] = useState({ x: 0, y: 0 });
  const errorText = error => zh ? translatedErrors[error.message] || '操作未完成。请检查图片尺寸、文件格式或项目版本后重试。' : error.message;
  const load = async () => {
    const [workbench, ui, map, animation] = await Promise.all(['/api/workbench', '/api/project', '/api/map', '/api/animation'].map(url => request(url)));
    const value = { library: workbench.library, ui, map, animation }; setSnapshot(value); return value;
  };
  useEffect(() => { load().catch(e => setError(errorText(e))); }, []);
  const entries = useMemo(() => snapshot ? buildAssetIndex(snapshot) : [], [snapshot]);
  const entry = entries.find(item => item.key === selected) || entries[0];
  const filtered = entries.filter(item => [item.name, item.assetId, item.documentName, item.workspaceName, item.src, item.provenance?.author, item.provenance?.license, ...item.references.map(ref => ref.name)].join(' ').toLowerCase().includes(query.toLowerCase()));
  useEffect(() => {
    let cancelled = false;
    setImage(null); setReport(null); setReplacement(null); setPreview(null); setError(''); setNotice('');
    if (!entry || !snapshot) return;
    setProvenance(entry.provenance || {});
    setPixelMode(entry.kind === 'animation' || entry.kind === 'map' && !entry.src?.endsWith('.svg'));
    setSeamMode(entry.assetKind === 'tile' ? 'isometric' : 'off'); setPalette(entry.kind === 'animation' ? snapshot.animation.palette.join(' ') : '');
    const run = async () => {
      if (entry.src && /\.(ttf|otf)$/i.test(entry.src)) return;
      let decoded;
      if (entry.src) decoded = await decode(entry.src);
      else if (entry.generated) {
        const rendered = renderAnimationFrame(getAssetDocument(snapshot, entry), entry.clipId, entry.assetId);
        decoded = { width: rendered.width, height: rendered.height, pixels: rendered.pixels };
        if (!cancelled) setOffset({ x: rendered.bounds.x, y: rendered.bounds.y });
      } else {
        const record = getAssetRecord(snapshot, entry); decoded = { width: record.width, height: record.height, pixels: record.pixels };
        if (!cancelled) setOffset(record.offset || { x: 0, y: 0 });
      }
      if (!cancelled) setImage(decoded);
    };
    run().catch(e => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; };
  }, [entry?.key, snapshot]);
  const cropped = useMemo(() => {
    if (!image) return null;
    try { return cropInspectionImage(image, entry?.atlas); } catch { return null; }
  }, [image, entry?.key]);
  const runChecks = () => {
    if (!image) return;
    try {
      const pixels = cropInspectionImage(image, entry.atlas), colors = palette.split(/[\s,;]+/).filter(Boolean);
      if (colors.some(color => !/^#[0-9a-f]{6}$/i.test(color))) { setError(t('调色板请使用 #RRGGBB，以空格分隔。', 'Use space-separated #RRGGBB palette colors.')); return; }
      const result = inspectPixelImage(pixels, { palette: pixelMode ? colors : [], tile: seamMode !== 'off', isometric: seamMode === 'isometric' });
      const usage = pixelMode ? inspectAssetUsage(entry, image) : [];
      setReport({ ...result, findings: [...(pixelMode ? result.findings : result.findings.filter(item => item.code === 'empty-image' || item.code === 'tile-seam')), ...usage] }); setError('');
    } catch (e) { setError(errorText(e)); }
  };
  useEffect(() => { if (image) runChecks(); }, [image, pixelMode, seamMode]);
  async function execute(operation) {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function persist(plan) {
    if (!plan.changed) return;
    const path = plan.kind === 'ui' ? '/api/project' : plan.kind === 'map' ? '/api/map' : '/api/animation';
    const payload = plan.kind === 'ui' ? { ...plan.project, revision: plan.baseRevision + 1 } : { baseRevision: plan.baseRevision, project: plan.project };
    await request(path, payload, 'PUT');
    await onChanged?.(); await load();
  }
  const replacementPlan = () => planAssetUpdate(snapshot, entry.key, { ...(entry.resourceType === 'asset' ? { src: '/local-assets/replacement-preview.png' } : {}), image: replacement.image, offset, provenance });
  return <div className="asset-inspector-backdrop" role="presentation"><section className="asset-inspector" role="dialog" aria-modal="true" aria-labelledby="asset-inspector-title" data-testid="asset-inspector">
    <header><div><h2 id="asset-inspector-title">{t('资源体检与引用', 'Asset health & references')}</h2><p>{t('查找页面、地图、动画中的素材引用；替换前预览影响。', 'Find resource usage across pages, maps and animations; preview replacement impact.')}</p></div><button className="button" onClick={onClose} disabled={busy}>{t('关闭', 'Close')}</button></header>
    <div className="asset-inspector-body"><aside><input data-testid="asset-search" aria-label={t('搜索资源或引用', 'Search assets or references')} placeholder={t('搜索名称、组件、许可证…', 'Search names, components, licenses…')} value={query} onChange={e => setQuery(e.target.value)} /><small>{filtered.length} / {entries.length} {t('项资源', 'resources')}</small><div className="asset-resource-list">{filtered.map(item => <button key={item.key} className={item.key === entry?.key ? 'selected' : ''} data-testid="asset-item" data-asset-id={item.assetId} onClick={() => setSelected(item.key)} disabled={busy}><strong>{item.name}</strong><small>{item.documentName} · {item.kind === 'animation' ? t('动画', 'Animation') : item.kind === 'map' ? t('地图', 'Map') : item.kind === 'template' ? t('模板', 'Template') : 'UI'}{!item.active ? ` · ${t('未打开', 'Inactive')}` : ''}</small><small>{item.references.reduce((sum, ref) => sum + (ref.count || 1), 0)} {t('处引用', 'references')}</small></button>)}</div></aside>
    <main>{!entry ? <p>{t('正在读取资源…', 'Loading assets…')}</p> : <>
      <div className="asset-selection-heading"><h3>{entry.name}</h3><code>{entry.assetId}</code><small>{entry.src || t('动画文档内嵌像素', 'Pixels embedded in the animation document')}</small></div>
      {error && <p className="asset-error" role="alert">{error}</p>}{notice && <p className="asset-notice" role="status">{notice}</p>}
      <div className="asset-preview-row">{cropped ? <PixelPreview image={cropped} label={t('当前素材', 'Current asset')} /> : <p>{t('字体或尚未解码的素材不进行像素体检。', 'Pixel checks skip fonts and images that have not decoded.')}</p>}{replacement && <PixelPreview image={replacement.image} label={t('替换候选', 'Replacement candidate')} />}{seamMode && cropped && <PixelPreview image={cropped} label={t('矩形重复拼接参考', 'Rectangular repeat reference')} repeat />}</div>
      <section className="asset-section"><h4>{t('体检', 'Health checks')}</h4><p>{t('以下结果是技术提示，需要结合素材风格复核；不会自动修改图片，也不代表美术验收。等距菱形瓦片请在地图中检查邻接效果。', 'Results are technical hints for review. Images remain unchanged and art acceptance is separate. Check isometric diamond tile adjacency in the map.')}</p><div className="asset-check-options"><label><input type="checkbox" checked={pixelMode} onChange={e => setPixelMode(e.target.checked)} />{t('按像素美术检查', 'Check as pixel art')}</label><label><input type="checkbox" checked={seamMode} onChange={e => setSeamMode(e.target.checked)} />{t('矩形瓦片重复接缝', 'Rectangular tile repeat seams')}</label></div><label>{t('指定调色板（可选）', 'Expected palette (optional)')}<input value={palette} onChange={e => setPalette(e.target.value)} placeholder="#152635 #d7bb78" /></label><button className="button" data-testid="asset-run-checks" onClick={runChecks} disabled={!image || busy}>{t('重新检查', 'Run checks')}</button>{report && <div data-testid="asset-check-results"><p>{report.width} × {report.height} px · {report.visiblePixels} {t('个可见像素', 'visible pixels')} · {report.colors} {t('种颜色', 'colors')}</p>{report.findings.length ? <ul>{report.findings.map((finding, index) => <li key={index}>{t(...messages[finding.code])}{finding.count !== undefined ? `: ${finding.count}` : ''}{finding.targetId ? ` · ${finding.targetId}` : ''}{finding.scaleX !== undefined ? ` (${finding.scaleX.toFixed(2)}×, ${finding.scaleY.toFixed(2)}×)` : ''}</li>)}</ul> : <p>{t('本轮所选检查未发现提示项。', 'No findings in the selected checks.')}</p>}</div>}</section>
      <section className="asset-section"><h4>{t('引用位置', 'References')}</h4><p>{entry.documentName}{entry.workspaceName ? ` · ${entry.workspaceName}` : ''}</p><ul data-testid="asset-reference-list">{entry.references.map((ref, index) => <li key={index}><strong>{ref.name}</strong> <code>{ref.targetId}</code> · {ref.field}{ref.count ? ` × ${ref.count}` : ''}{ref.cells && <small>{ref.cells.slice(0, 12).join(' / ')}{ref.cells.length > 12 ? ' …' : ''}</small>}</li>)}</ul>{!entry.references.length && <p>{t('该资源已入库，当前文档未引用。', 'This resource is registered but unused in this document.')}</p>}{entry.src && <details><summary>{t('同源文件的其他记录', 'Other records using this source file')} ({entries.filter(item => item.src === entry.src && item.key !== entry.key).length})</summary><ul>{entries.filter(item => item.src === entry.src && item.key !== entry.key).map(item => <li key={item.key}>{item.documentName} · {item.name}</li>)}</ul></details>}</section>
      <section className="asset-section"><h4>{t('来源与许可证', 'Source & license')}</h4><div className="asset-metadata-grid">{[['author', '作者', 'Author'], ['license', '许可证', 'License'], ['source', '来源地址或说明', 'Source URL or description'], ['notes', '备注', 'Notes']].map(([key, cn, en]) => <label key={key}>{t(cn, en)}<input data-testid={`asset-provenance-${key}`} value={provenance[key] || ''} maxLength={key === 'notes' ? 4000 : 1000} onChange={e => { setProvenance({ ...provenance, [key]: e.target.value }); setPreview(null); }} /></label>)}</div><button className="button" data-testid="asset-save-provenance" disabled={busy || !entry.active || entry.generated} onClick={() => execute(async () => { await persist(planAssetUpdate(snapshot, entry.key, { provenance })); setNotice(t('来源信息已保存。', 'Source information saved.')); })}>{t('保存来源信息', 'Save source information')}</button>{entry.generated && <p>{t('此项为程序生成帧；导入帧图后可记录图片来源。', 'This is a generated frame; source metadata can be attached after importing an image.')}</p>}</section>
      <section className="asset-section"><h4>{t('替换素材', 'Replace resource')}</h4><p>{t('只更新当前打开文档中选中的资源记录，保留组件 ID、尺寸、引用及原文件。其他同源记录不受影响。', 'Update the selected resource record in the active document, preserving component IDs, layout, references and the original file. Other records using the same source stay unchanged.')}</p>{!entry.active ? <p>{t('请先在项目工具箱中打开此页面或地图，再替换素材。模板资源需先放入文档编辑。', 'Open this page or map in the project toolbox before replacing its resource. Place template resources into a document first.')}</p> : <>
        <input data-testid="asset-replacement-file" aria-label={t('选择替换图片', 'Choose replacement image')} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => { const file = e.target.files[0]; e.target.value = ''; setPreview(null); setReplacement(null); if (file) execute(async () => { if (file.size > 15 * 1024 * 1024) throw new Error('Image checks support images up to 4096 × 4096 pixels.'); const dataUrl = await readFile(file); const pixels = await decode(dataUrl); setReplacement({ name: file.name, dataUrl, image: pixels }); }); }} />
        {entry.resourceType === 'frame' && <div className="asset-metadata-grid">{['x', 'y'].map(axis => <label key={axis}>{t('帧图相对主体偏移', 'Frame offset from body')} {axis.toUpperCase()}<input type="number" min="-1024" max="1024" value={offset[axis]} onChange={e => { setOffset({ ...offset, [axis]: Number(e.target.value) }); setPreview(null); }} /></label>)}</div>}
        <button className="button" data-testid="asset-preview-replacement" disabled={busy || !replacement} onClick={() => execute(async () => setPreview(replacementPlan()))}>{t('预览替换影响', 'Preview replacement impact')}</button>
        {preview && <div className="asset-replacement-plan" data-testid="asset-replacement-plan"><p>{t('将更新', 'Will update')} {entry.documentName} / {entry.name} · {preview.references.reduce((sum, ref) => sum + (ref.count || 1), 0)} {t('处引用沿用同一 ID', 'references retain the same ID')}</p><p>{image?.width} × {image?.height} → {replacement.image.width} × {replacement.image.height} px</p><button className="button primary" data-testid="asset-apply-replacement" disabled={busy} onClick={() => execute(async () => { let src; if (entry.resourceType === 'asset') src = (await request('/api/assets', { name: replacement.name.slice(0, 120), kind: 'texture', dataUrl: replacement.dataUrl }, 'POST')).src; const plan = planAssetUpdate(snapshot, entry.key, { ...(src ? { src } : {}), image: replacement.image, offset, provenance }); await persist(plan); setNotice(t('素材已替换，原文件保留。', 'Resource replaced; the original file is retained.')); })}>{t('应用此替换', 'Apply this replacement')}</button></div>}
      </>}</section>
    </>}</main></div>
  </section></div>;
}
