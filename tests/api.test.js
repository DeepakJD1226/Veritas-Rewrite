import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.js';
import { OllamaClient, directLocalFetch } from '../src/ollama.js';
import { DETECTOR_METHOD } from '../src/detector-core.js';

const localInfo = { details: { format: 'gguf' }, model_info: { 'llama.block_count': 28 }, capabilities: ['completion'] };
const config = { model: 'llama3.2:latest', maxAttempts: 2, candidateCount: 1, timeoutSeconds: 5 };
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
function model(text = 'The team keeps accurate records.') {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/show')) return json(localInfo);
    const body = JSON.parse(options.body);
    if (body.format.required.includes('reviews')) return json({ done: true, done_reason: 'stop', message: { content: JSON.stringify({ reviews: JSON.parse(body.messages[1].content).candidates.map(c => ({ id: c.id, meaningPreserved: true, naturalness: 4, fluency: 4, issues: [] })) }) } });
    return json({ done: true, done_reason: 'stop', message: { content: JSON.stringify({ rewrite: text }) } });
  };
  return { client: new OllamaClient(config, fakeFetch), calls };
}
async function app(t, client, detector) {
  const server = createApp(config, client, detector);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { server, url, post: body => fetch(url + '/api/rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
}

test('full HTTP pipeline returns validated rewrite and metrics using a mocked model', async t => {
  const { client, calls } = model();
  const { post } = await app(t, client);
  const response = await post({ text: 'The team maintains accurate records.' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.text, 'The team keeps accurate records.');
  assert.equal(result.report.maxWords, 300);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(x => x.url.startsWith('http://127.0.0.1:11434/')));
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.stream, false);
  assert.equal(payload.format.required[0], 'rewrite');
  assert.equal(payload.model, config.model);
});
test('HTTP rejects 301 words before calling the model', async t => {
  const { client, calls } = model();
  const { post } = await app(t, client);
  const response = await post({ text: Array(301).fill('word').join(' ') });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'WORD_LIMIT');
  assert.equal(calls.length, 0);
});
test('exactly 300-word input and output is accepted', async t => {
  const passage = Array(30).fill('The team keeps accurate records of all parts in stock.').join(' ');
  const { client } = model(Array(30).fill('The team logs all stock items accurately in its records.').join(' '));
  const { post } = await app(t, client);
  const response = await post({ text: passage });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).report.outputWords, 300);
});
test('HTTP never exposes two failing model outputs as a successful rewrite', async t => {
  const { client } = model('An invented result of 99.');
  const { post } = await app(t, client);
  const response = await post({ text: 'The measured result was 20.' });
  assert.equal(response.status, 422);
  const data = await response.json();
  assert.equal(data.text, undefined);
  assert.equal(data.error.code, 'REWRITE_CHECK_FAILED');
});
test('static app and modules load with safe content types', async t => {
  const { client } = model();
  const { url } = await app(t, client);
  for (const [path, type] of [['/', 'text/html'], ['/styles.css', 'text/css'], ['/app.js', 'text/javascript'], ['/text.js', 'text/javascript'], ['/detector-report.js', 'text/javascript'], ['/favicon.svg', 'image/svg+xml']]) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.ok(response.headers.get('content-security-policy').includes("connect-src 'self'"));
  }
});
test('status exposes missing model and readiness without requesting generation', async t => {
  const client = new OllamaClient(config, async () => new Response(JSON.stringify({ error: 'model not found' }), { status: 404 }));
  const { url } = await app(t, client);
  const data = await (await fetch(url + '/api/status')).json();
  assert.equal(data.ready, false);
  assert.equal(data.code, 'MODEL_MISSING');
});
test('runtime absent produces actionable 503, without fake fallback text', async t => {
  const client = new OllamaClient(config, async () => { throw new TypeError('fetch failed'); });
  const { post } = await app(t, client);
  const response = await post({ text: 'A sample draft.' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'OLLAMA_OFFLINE');
});
test('cross-site origins are blocked while local browser origin works', async t => {
  const { client } = model();
  const { url } = await app(t, client);
  const bad = await fetch(url + '/api/rewrite', { method: 'POST', headers: { Origin: 'https://external.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'A sample draft.' }) });
  assert.equal(bad.status, 403);
  const good = await fetch(url + '/api/status', { headers: { Origin: url } });
  assert.equal(good.status, 200);
});
test('Host validation blocks DNS rebinding-style hostnames', async t => {
  const { client } = model();
  const { url } = await app(t, client);
  const status = await new Promise((resolve, reject) => {
    const request = http.get(url + '/api/status', { headers: { Host: 'external.example:8788' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(status, 403);
});
test('unlisted files and traversal cannot reveal source or config', async t => {
  const { client } = model();
  const { url } = await app(t, client);
  for (const path of ['/settings.json', '/server.js', '/src/config.js', '/%2e%2e/settings.json']) assert.equal((await fetch(url + path)).status, 404);
});
test('malformed JSON and non-JSON posts have explicit errors', async t => {
  const { client } = model();
  const { url } = await app(t, client);
  const bad = await fetch(url + '/api/rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(bad.status, 400);
  const form = await fetch(url + '/api/rewrite', { method: 'POST', body: 'text=Hello' });
  assert.equal(form.status, 415);
});
test('oversized request body gets 413 before model access', async t => {
  const { client, calls } = model();
  const { post } = await app(t, client);
  const response = await post({ text: 'word', unused: 'x'.repeat(100000) });
  assert.equal(response.status, 413);
  assert.equal(calls.length, 0);
});
test('direct transport rejects nonlocal targets and handles real HTTP response streams', async t => {
  assert.throws(() => directLocalFetch('https://external.example/api/chat', { method: 'POST' }));
  const mock = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).model, config.model);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(localInfo));
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  t.after(async () => { mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve)); });
  const localTransport = (url, options) => directLocalFetch(url, options, (settings, callback) => {
    assert.equal(settings.hostname, '127.0.0.1');
    assert.equal(settings.port, 11434);
    return http.request({ ...settings, port: mock.address().port }, callback);
  });
  const client = new OllamaClient(config, localTransport);
  assert.equal((await client.status()).ready, true);
});
test('model timeout is surfaced with its own actionable error', async () => {
  const client = new OllamaClient(config, (_, options) => new Promise((resolve, reject) => {
    const keepAlive = setTimeout(resolve, 100);
    options.signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(options.signal.reason); }, { once: true });
  }));
  await assert.rejects(client.request('/api/show', { model: config.model }, undefined, 5), { code: 'MODEL_TIMEOUT' });
});
test('cloud-backed alias is rejected before any text can be sent', async () => {
  const calls = [];
  const client = new OllamaClient(config, async url => { calls.push(url); return json({ ...localInfo, remote_host: 'https://ollama.com', remote_model: 'some-model' }); });
  await assert.rejects(client.ensureLocal(), { code: 'CLOUD_MODEL_BLOCKED' });
  assert.equal(calls.length, 1);
});
test('unknown metadata and embedding-only models fail closed', async () => {
  await assert.rejects(new OllamaClient(config, async () => json({})).ensureLocal(), { code: 'LOCAL_MODEL_UNVERIFIED' });
  await assert.rejects(new OllamaClient(config, async () => json({ ...localInfo, capabilities: ['embedding'] })).ensureLocal(), { code: 'MODEL_UNSUITABLE' });
});
test('malformed and truncated structured generations are retryable', async () => {
  for (const data of [{ done: true, message: { content: 'not JSON' } }, { done: true, done_reason: 'length', message: { content: '{"rewrite":"cut off"}' } }]) {
    const client = new OllamaClient(config, async () => json(data));
    assert.equal(typeof (await client.generate([])).invalid, 'string');
  }
});
test('UTF-8 model output survives network chunks split inside characters', async () => {
  const bytes = Buffer.from(JSON.stringify({ done: true, message: { content: JSON.stringify({ rewrite: 'Café — déjà vu.' }) } }));
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const client = new OllamaClient(config, async () => new Response(body));
  assert.equal((await client.generate([])).text, 'Café — déjà vu.');
});
test('second generation request receives a busy response', async t => {
  let release, started;
  const begun = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const client = { status: async () => ({ ready: true }), ensureLocal: async () => {}, generate: async () => { started(); await gate; return { text: 'A clearer draft.' }; }, review: async () => ({ reviews: [{ id: 'candidate-1', meaningPreserved: true, naturalness: 4, fluency: 4, issues: [] }] }) };
  const { post } = await app(t, client);
  const first = post({ text: 'A readable draft.' });
  await begun;
  const second = await post({ text: 'A readable draft.' });
  assert.equal(second.status, 429);
  release(); assert.equal((await first).status, 200);
});
test('disconnect cancels generation and releases the busy slot', async t => {
  let started, cancelled;
  const begun = new Promise(resolve => { started = resolve; });
  const cancellation = new Promise(resolve => { cancelled = resolve; });
  const client = { status: async () => ({ ready: true }), ensureLocal: async () => {}, generate: async (_, signal) => {
    started(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); cancelled(); return { text: 'A clearer draft.' };
  } };
  const { url } = await app(t, client);
  const controller = new AbortController();
  const request = fetch(url + '/api/rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'A readable draft.' }), signal: controller.signal });
  const handled = request.catch(error => error);
  await begun; controller.abort(); await handled; await cancellation;
  const status = await (await fetch(url + '/api/status')).json();
  assert.equal(status.busy, false);
});

test('target HTTP request runs the real rewrite/review pipeline and returns measured meters', async t => {
  const source = Array(5).fill('The team maintains accurate records of all spare parts in the workshop. Staff update the records whenever parts arrive or are used for repairs.').join(' ');
  const output = Array(5).fill('Staff keep the workshop inventory accurate by recording every spare part that arrives or goes into a repair. The team maintains these stock records.').join(' ');
  const { client, calls } = model(output);
  let scored = 0;
  const detector = { status: async () => ({ installed: true }), score: async text => {
    assert.equal(text, scored === 0 ? source : output);
    return { ...DETECTOR_METHOD, score: scored++ === 0 ? .98 : .19, status: 'complete', fallback: false, checkedTokens: 140, totalTokens: 140 };
  } };
  const { post, url } = await app(t, client, detector);
  const response = await post({ text: source, targetPercent: 20 });
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.target.met, true); assert.equal(result.ai.score, .19);
  assert.equal(result.target.roundsUsed, 1); assert.equal(result.target.before.score, .98);
  assert.equal(calls.length, 3); assert.equal(scored, 2);
  const payload = JSON.parse(calls[1].options.body);
  assert.match(payload.messages[0].content, /at least 100 words/);
  const progress = await (await fetch(url + '/api/progress')).json();
  assert.equal(progress.busy, false); assert.equal(progress.stage, 'idle');
});
test('HTTP rejects impossible target values and short target drafts before generation or scoring', async t => {
  const { client, calls } = model();
  const { post } = await app(t, client, { score: async () => { throw new Error('Should not score'); } });
  for (const payload of [{ text: Array(110).fill('word').join(' '), targetPercent: 0 }, { text: 'A short draft.', targetPercent: 20 }]) {
    assert.ok((await post(payload)).status >= 400);
  }
  assert.equal(calls.length, 0);
});
