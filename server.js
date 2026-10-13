import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readConfig } from './src/config.js';
import { OllamaClient } from './src/ollama.js';
import { validateInput } from './src/validation.js';
import { rewrite } from './src/rewrite.js';
import { AppError } from './src/errors.js';
import { VeritasDetector } from './src/detector.js';
import { rewriteToTarget } from './src/target-rewrite.js';

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/text.js', ['text.js', 'text/javascript; charset=utf-8']],
  ['/detector-report.js', ['detector-report.js', 'text/javascript; charset=utf-8']],
  ['/target-score.js', ['target-score.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);

function send(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new AppError(415, 'JSON_REQUIRED', 'Use application/json.');
  if (Number(req.headers['content-length']) > 100_000) throw new AppError(413, 'BODY_TOO_LARGE', 'This request is too large. The draft limit is 300 words.');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 100_000) throw new AppError(413, 'BODY_TOO_LARGE', 'This request is too large. The draft limit is 300 words.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError(400, 'INVALID_JSON', 'The request must contain valid JSON.'); }
}

function authorized(header, config) {
  if (!header || header.length > 2048 || !/^Basic [A-Za-z0-9+/]+=*$/i.test(header)) return false;
  const supplied = Buffer.from(header.slice(6), 'base64');
  const expected = Buffer.from(`${config.accessUser}:${config.accessPassword}`);
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(supplied), hash(expected));
}

export function createApp(config, client = new OllamaClient(config), detector = new VeritasDetector(), startup = { ready: true, phase: 'ready', message: '' }) {
  let busy = false;
  let progress = { stage: 'idle', message: '' };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      // Liveness is deliberately separate from model readiness and contains no secrets.
      if (req.method === 'GET' && path === '/healthz') return send(res, startup.phase === 'failed' ? 503 : 200, { status: startup.phase === 'failed' ? 'failed' : 'ok' });
      const activePort = req.socket.localPort;
      const hosts = new Set(config.hosted ? config.publicOrigins.map(origin => new URL(origin).host) : [`127.0.0.1:${activePort}`, `localhost:${activePort}`, `[::1]:${activePort}`]);
      if (!hosts.has(req.headers.host)) throw new AppError(403, config.hosted ? 'HOST_BLOCKED' : 'LOCAL_ONLY', config.hosted ? 'Open the HTTPS service address configured in Render.' : 'Open this app through its local address.');
      const origins = new Set(config.hosted ? config.publicOrigins : [...hosts].map(host => `http://${host}`));
      if (req.headers.origin && !origins.has(req.headers.origin)) throw new AppError(403, 'ORIGIN_BLOCKED', 'Requests must come from this app.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403, 'ORIGIN_BLOCKED', 'Requests must come from this app.');
      if (config.hosted && !authorized(req.headers.authorization, config)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Veritas Rewrite", charset="UTF-8"');
        return send(res, 401, { error: { code: 'LOGIN_REQUIRED', message: 'Sign in with the username and password configured on Render.' } });
      }
      if (req.method === 'GET' && path === '/api/status') return send(res, 200, { app: 'Veritas Rewrite', version: '3.1.0', maxWords: 300, busy, deployment: config.hosted ? 'render' : 'local', startup: { phase: startup.phase, message: startup.message }, ...(startup.ready ? await client.status() : { ready: false, model: config.model, message: startup.message }), detector: await detector.status() });
      if (req.method === 'GET' && path === '/api/progress') return send(res, 200, { busy, ...progress });
      if (req.method === 'POST' && path === '/api/rewrite') {
        if (!startup.ready) throw new AppError(503, 'MODELS_STARTING', startup.message || 'Models are still starting. Try again when the status says ready.');
        const input = validateInput(await readJson(req));
        if (busy) throw new AppError(429, 'BUSY', 'A rewrite is already running. Wait for it to finish or cancel it.');
        busy = true;
        progress = { stage: 'starting', message: 'Starting rewrite…' };
        const controller = new AbortController();
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', cancel);
        try {
          const update = detail => { progress = { ...progress, ...detail }; };
          const result = input.targetPercent === null
            ? await rewrite(input, client, config, controller.signal, update)
            : await rewriteToTarget(input, client, detector, config, controller.signal, update);
          return send(res, 200, result);
        } finally { busy = false; progress = { stage: 'idle', message: '' }; res.off('close', cancel); }
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && staticFiles.has(path)) {
        const [filename, contentType] = staticFiles.get(path);
        let data = await readFile(new URL(`./public/${filename}`, import.meta.url));
        if (filename === 'index.html' && config.hosted) data = Buffer.from(data.toString().replace('data-deployment="local"', 'data-deployment="render"').replace('A local model, running on your computer. No paid writing API.', 'Your models run on your Render server. Drafts are sent there over HTTPS. No external writing API.').replace('Comparison stays on your computer.', 'Comparison runs on your Render server.').replace('v3.1 · LOCAL', 'v3.1 · SERVER'));
        res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': data.length });
        return res.end(req.method === 'HEAD' ? undefined : data);
      }
      throw new AppError(404, 'NOT_FOUND', 'This page or endpoint does not exist.');
    } catch (error) {
      if (error instanceof AppError) send(res, error.status, { error: { code: error.code, message: error.message, ...error.details } });
      else {
        console.error('Internal request error:', error.code || error.name); // Never log submitted text.
        send(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Restart the app and try again.' } });
      }
    }
  });
  server.on('close', () => { void detector.close?.(); });
  return server;
}

function openBrowser(url) {
  let child;
  if (process.platform === 'win32') child = spawn('rundll32', ['url.dll,FileProtocolHandler', url], { stdio: 'ignore', detached: true });
  else child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Please install Node.js 22 or newer.');
    const config = readConfig();
    const server = createApp(config);
    server.requestTimeout = 30_000; // Limits request upload; model timeout is separate.
    server.headersTimeout = 15_000;
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `Port ${config.port} is in use. Close the other copy or change port in settings.json.` : `Server error: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(config.port, config.host, () => {
      const url = `http://${config.host}:${config.port}`;
      console.log(`\nVeritas Rewrite is running at ${url}\nModel: ${config.model}\nInput and output: maximum 300 words\nKeep this window open. Press Ctrl+C to stop.\n`);
      if (process.argv.includes('--open')) openBrowser(url);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
