import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readConfig } from '../src/config.js';
import { createApp } from '../server.js';

const env = { VERITAS_DEPLOYMENT: 'render', PORT: '10000', RENDER_EXTERNAL_URL: 'https://veritas-demo.onrender.com', VERITAS_ACCESS_PASSWORD: 'test-only-password-123' };
const config = readConfig(env);
const auth = `Basic ${Buffer.from(`admin:${env.VERITAS_ACCESS_PASSWORD}`).toString('base64')}`;
async function hosted(t, startup = { ready: true, phase: 'ready', message: '' }) {
  let checks = 0;
  const client = { status: async () => { checks++; return { ready: true, model: config.model }; } };
  const detector = { status: async () => ({ installed: true }) };
  const server = createApp(config, client, detector, startup);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const request = (path, headers = {}, method = 'GET', body) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers: { Host: 'veritas-demo.onrender.com', ...headers } }, res => {
      let data = ''; res.setEncoding('utf8'); res.on('data', part => { data += part; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data, json: () => JSON.parse(data) }));
    });
    req.on('error', reject); req.end(body);
  });
  return { request, checks: () => checks };
}
test('local defaults stay loopback-only; Render uses PORT and all interfaces', () => {
  assert.equal(readConfig({ PORT: '12000' }).port, 8788);
  assert.equal(readConfig({}).host, '127.0.0.1');
  assert.equal(config.host, '0.0.0.0'); assert.equal(config.port, 10000);
  assert.equal(readConfig({ ...env, VERITAS_PORT: '9000', PORT: '12345' }).port, 12345);
});
test('hosted mode requires a strong-length password and exact HTTPS origin', () => {
  for (const password of ['', 'short', 'x'.repeat(257), 'long-password-with\nnewline']) assert.throws(() => readConfig({ ...env, VERITAS_ACCESS_PASSWORD: password }));
  for (const url of ['', 'http://example.com', 'https://name:pass@example.com', 'https://example.com/path', 'https://example.com/?query=1']) assert.throws(() => readConfig({ ...env, RENDER_EXTERNAL_URL: url }));
  assert.throws(() => readConfig({ ...env, VERITAS_ACCESS_USER: 'user:name' }));
  assert.deepEqual(readConfig({ ...env, VERITAS_PUBLIC_URL: 'https://rewrite.example.com' }).publicOrigins, [env.RENDER_EXTERNAL_URL, 'https://rewrite.example.com']);
});
test('public assets and API require credentials; unauthenticated rewrites never run', async t => {
  const { request, checks } = await hosted(t);
  for (const path of ['/', '/app.js', '/api/status', '/api/progress']) {
    const response = await request(path);
    assert.equal(response.status, 401);
    assert.match(response.headers['www-authenticate'], /^Basic /);
  }
  assert.equal((await request('/api/rewrite', {}, 'POST', '{}')).status, 401);
  assert.equal(checks(), 0);
});
test('bad credentials are rejected; correct credentials never leak in status', async t => {
  const { request } = await hosted(t);
  for (const Authorization of ['Bearer wrong', 'Basic !!!', 'Basic ' + Buffer.from('admin:wrong-password').toString('base64')]) assert.equal((await request('/api/status', { Authorization })).status, 401);
  const good = await request('/api/status', { Authorization: auth });
  assert.equal(good.status, 200); assert.equal(good.json().deployment, 'render');
  assert.ok(!good.text.includes(env.VERITAS_ACCESS_PASSWORD));
});
test('Render origin works while arbitrary Host, forwarded Host and cross-site origins fail', async t => {
  const { request } = await hosted(t);
  assert.equal((await request('/api/status', { Authorization: auth, Origin: env.RENDER_EXTERNAL_URL })).status, 200);
  for (const headers of [{ Host: 'evil.example', 'X-Forwarded-Host': 'veritas-demo.onrender.com' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'http://veritas-demo.onrender.com' }]) assert.equal((await request('/api/status', { Authorization: auth, ...headers })).status, 403);
});
test('liveness accepts internal probes without model inference or credentials', async t => {
  const { request, checks } = await hosted(t, { ready: false, phase: 'downloading-model', message: 'Downloading model.' });
  const response = await request('/healthz', { Host: 'internal-probe:10000' });
  assert.equal(response.status, 200); assert.deepEqual(response.json(), { status: 'ok' }); assert.equal(checks(), 0);
});
test('startup blocks rewrites, reports progress, then becomes ready without a restart', async t => {
  const state = { ready: false, phase: 'downloading-model', message: 'Downloading model.' };
  const { request, checks } = await hosted(t, state);
  const before = (await request('/api/status', { Authorization: auth })).json();
  assert.equal(before.ready, false); assert.equal(before.message, state.message); assert.equal(checks(), 0);
  const blocked = await request('/api/rewrite', { Authorization: auth, 'Content-Type': 'application/json' }, 'POST', '{}');
  assert.equal(blocked.status, 503); assert.equal(blocked.json().error.code, 'MODELS_STARTING');
  state.ready = true; state.phase = 'ready';
  assert.equal((await request('/api/status', { Authorization: auth })).json().ready, true); assert.equal(checks(), 1);
});
test('failed startup is unhealthy instead of reporting a usable service', async t => {
  const { request } = await hosted(t, { ready: false, phase: 'failed', message: 'Setup failed.' });
  assert.equal((await request('/healthz')).status, 503);
});
test('hosted HTML explains where drafts are processed and identifies server mode', async t => {
  const { request } = await hosted(t);
  const html = (await request('/', { Authorization: auth })).text;
  assert.match(html, /data-deployment="render"/);
  assert.match(html, /Drafts are sent there over HTTPS/);
  assert.match(html, /Comparison runs on your Render server/);
  assert.ok(!html.includes('Comparison stays on your computer'));
});
test('persistent detector cache and marker share the configured directory', () => {
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', "import { CACHE_DIR, MARKER_URL } from './src/detector.js'; console.log(JSON.stringify({cache:CACHE_DIR,marker:MARKER_URL.href}));"], { cwd: new URL('..', import.meta.url), env: { ...process.env, VERITAS_DETECTOR_CACHE: '/var/data/detector' }, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(result), { cache: '/var/data/detector', marker: 'file:///var/data/detector/ready.json' });
});
