// Node >=20. Probe actual HTTP responses; no paid model or AI API is used.
import { writeFile } from 'node:fs/promises';
const report = { recordedAt: new Date().toISOString(), node: process.version, checks: [] };
async function check(name, operation) {
  try { report.checks.push({ name, passed: true, details: await operation() }); }
  catch (error) { report.checks.push({ name, passed: false, error: error.message }); process.exitCode = 1; }
}
const timeout = () => AbortSignal.timeout(10000);
await check('Penpot frontend serves application', async () => {
  const response = await fetch('http://127.0.0.1:9001/', { signal: timeout() });
  const body = await response.text();
  if (response.status !== 200 || !body.includes('<html')) throw new Error(`Unexpected frontend response ${response.status}`);
  return { status: response.status, bytes: body.length };
});
await check('Penpot backend database readiness', async () => {
  const response = await fetch('http://127.0.0.1:9001/readyz', { signal: timeout() });
  const body = await response.text();
  if (response.status !== 200 || body.trim() !== 'OK') throw new Error(`Unexpected readiness response ${response.status}: ${body}`);
  return { status: response.status, body };
});
await check('Penpot anonymous profile RPC', async () => {
  const response = await fetch('http://127.0.0.1:9001/api/rpc/command/get-profile', { signal: timeout() });
  const body = await response.text();
  if (response.status !== 200 || !body.includes('Anonymous User')) throw new Error(`Unexpected profile response ${response.status}`);
  return { status: response.status, anonymousProfileReturned: true };
});
if (process.argv.includes('--mcp')) {
  await check('Official local MCP protocol and tools', async () => {
    let session;
    async function rpc(method, params, id) {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
      if (session) headers['Mcp-Session-Id'] = session;
      const response = await fetch('http://localhost:4401/mcp', {
        method: 'POST', headers, signal: timeout(),
        body: JSON.stringify({ jsonrpc: '2.0', ...(id ? { id } : {}), method, ...(params ? { params } : {}) }),
      });
      session ||= response.headers.get('mcp-session-id');
      if (!response.ok) throw new Error(`${method} failed: HTTP ${response.status}`);
      const body = await response.text();
      if (!body) return undefined;
      let result;
      try { result = JSON.parse(body); }
      catch { result = JSON.parse(body.split('\n').filter(line => line.startsWith('data: ')).at(-1).slice(6)); }
      if (result.error) throw new Error(JSON.stringify(result.error));
      return result.result;
    }
    const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'game-ui-studio-probe', version: '0.1.0' } }, 1);
    await rpc('notifications/initialized');
    const list = await rpc('tools/list', {}, 2);
    const names = list.tools.map(tool => tool.name);
    if (!names.includes('execute_code') || !names.includes('export_shape')) throw new Error('Expected official Penpot tools missing');
    const overview = await rpc('tools/call', { name: 'high_level_overview', arguments: {} }, 3);
    if (overview.isError || !overview.content?.length) throw new Error('Overview tool did not return content');
    const manifest = await fetch('http://localhost:4400/manifest.json', { signal: timeout() });
    if (manifest.status !== 200) throw new Error('Plugin manifest unavailable');
    return { protocolVersion: init.protocolVersion, toolNames: names, pluginManifestStatus: manifest.status, connectedDesignMutationTested: false };
  });
}
console.log(JSON.stringify(report, null, 2));
await writeFile(new URL('latest-probe.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
