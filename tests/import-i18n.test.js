import test from 'node:test';
import assert from 'node:assert/strict';
import { messages } from '../src/messages.js';
import { errorMessage, normalizeLocale, translate, translateMessage } from '../src/i18n.js';
import { createProjectTemplate, inspectProjectImport, MAX_PROJECT_BYTES } from '../src/projectImport.js';

test('both interface languages cover matching placeholders and preserve user-supplied values', () => {
  for (const [key, value] of Object.entries(messages)) {
    assert.equal(typeof value['zh-CN'], 'string', key);
    assert.equal(typeof value.en, 'string', key);
    assert.ok(value['zh-CN'].trim() && value.en.trim(), key);
    const fields = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(fields(value['zh-CN']), fields(value.en), key);
  }
  assert.equal(normalizeLocale('fr'), 'zh-CN');
  assert.equal(translate('en', 'selectedLabel', { count: 2, name: '英雄 Button' }), '2 selected · 英雄 Button');
  assert.equal(translateMessage('en', { key: 'notify.feedback', values: { count: 3 } }), 'Exported 3 pending reviews and local screenshots.');
  assert.equal(errorMessage('zh-CN', 'Node hero references missing asset portrait.'), '组件 hero 引用了不存在的素材 portrait。');
  assert.equal(errorMessage('en', 'import.invalidJson'), messages['import.invalidJson'].en);
  assert.equal(errorMessage('zh-CN', messages['import.invalidJson']['zh-CN']), messages['import.invalidJson']['zh-CN']);
});

test('UI import validates native projects and distinguishes patches, components and malformed JSON', () => {
  const project = createProjectTemplate('My UI 我的界面');
  assert.deepEqual(inspectProjectImport('\uFEFF' + JSON.stringify(project)), project);
  assert.throws(() => inspectProjectImport(''), /import.empty/);
  assert.throws(() => inspectProjectImport('{broken'), /import.invalidJson/);
  assert.throws(() => inspectProjectImport(JSON.stringify({ kind: 'studio-component' })), /import.component/);
  assert.throws(() => inspectProjectImport(JSON.stringify({ projectId: 'ashfall', changes: [] })), /import.patch/);
  assert.throws(() => inspectProjectImport(JSON.stringify({ ...project, canvas: { width: -1 } })), /Invalid canvas/);
  assert.throws(() => inspectProjectImport(JSON.stringify({ ...project, nodes: [{ id: 'bad', type: 'HTML' }] })), /Unsupported node type/);
  assert.throws(() => inspectProjectImport(' '.repeat(MAX_PROJECT_BYTES) + '中'), /import.tooLarge/);
  assert.equal(project.name, 'My UI 我的界面');
});
