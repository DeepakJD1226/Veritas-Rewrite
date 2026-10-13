import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { readConfig } from '../src/config.js';
import { createApp } from '../server.js';
import { OllamaClient, directLocalFetch } from '../src/ollama.js';
import { VeritasDetector, CACHE_DIR } from '../src/detector.js';
import { smokeText } from './setup-detector.js';

// Models are downloaded at runtime: Render does not mount disks during builds.
const config = readConfig();
if (!config.hosted) throw new Error('This launcher requires VERITAS_DEPLOYMENT=render. Use npm start for local operation.');
const state = { ready: false, phase: 'starting', message: 'Starting the server models. This page updates automatically.' };
const client = new OllamaClient(config);
const detector = new VeritasDetector();
const server = createApp(config, client, detector, state);
const controller = new AbortController();
const children = new Set();
let stopping = false;

function phase(name, message) {
  state.phase = name; state.message = message;
  console.log(`[startup] ${message}`);
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true; state.ready = false;
  controller.abort();
  server.close(); server.closeAllConnections();
  for (const child of children) child.kill('SIGTERM');
  const deadline = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 8000);
  deadline.unref();
  await detector.close();
  process.exitCode = code;
}
function fail(message) {
  state.ready = false; phase('failed', message);
  void stop(1);
}
function child(command, args) {
  const task = spawn(command, args, { stdio: 'inherit', env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_NO_CLOUD: '1', OLLAMA_DEBUG: '0' } });
  children.add(task);
  task.once('exit', () => children.delete(task));
  return task;
}
function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const task = child(command, args);
    const timer = setTimeout(() => { task.kill('SIGKILL'); reject(new Error('Model setup timed out. Check Render logs and the disk, then redeploy.')); }, timeoutMs);
    task.once('error', () => { clearTimeout(timer); reject(new Error('A model setup command could not start. Check the Docker build.')); });
    task.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Model setup failed. Check Render logs, free disk space and available memory, then redeploy.')); });
  });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop(); });
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.on('error', () => fail('The HTTP server could not start. Check the PORT setting.'));
server.listen(config.port, config.host, async () => {
  console.log(`Veritas Rewrite v3.1 listening on ${config.host}:${config.port}. Model readiness is shown inside the password-protected app.`);
  try {
    await mkdir(process.env.OLLAMA_MODELS || '/var/data/ollama', { recursive: true });
    await mkdir(CACHE_DIR, { recursive: true });
    const ollama = child('ollama', ['serve']);
    ollama.once('error', () => fail('Ollama could not start. Check the Docker image.'));
    ollama.once('exit', () => { if (!stopping) fail('Ollama stopped. Check Render memory usage and logs.'); });
    let listening = false;
    for (let attempt = 0; attempt < 60 && !controller.signal.aborted; attempt++) {
      try {
        const response = await directLocalFetch('http://127.0.0.1:11434/api/version', { method: 'GET', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]) });
        await response.text();
        if (response.ok) { listening = true; break; }
      } catch {}
      await pause(1000, undefined, { signal: controller.signal });
    }
    if (!listening) throw new Error('Ollama did not become available. Check Render logs.');
    const model = await client.status();
    if (!model.ready) {
      if (model.code !== 'MODEL_MISSING') throw new Error('The writing model could not be verified as local. Check VERITAS_MODEL and the Render logs.');
      phase('downloading-model', 'Downloading the writing model to the persistent disk. First startup can take several minutes.');
      await run('ollama', ['pull', config.model], 30 * 60 * 1000);
    }
    await client.ensureLocal();
    if (!(await detector.status()).installed) {
      phase('downloading-detector', 'Installing and checking the Veritas detector. The models will be reused on the next startup.');
      await run(process.execPath, ['scripts/setup-detector.js'], 25 * 60 * 1000);
    }
    phase('checking-detector', 'Checking that the saved detector runs without downloading files.');
    await detector.score(smokeText, controller.signal);
    await detector.close();
    if (stopping) return;
    state.ready = true;
    phase('ready', 'Models ready. You can now rewrite up to 300 words.');
  } catch (error) { if (!stopping) fail(error.message); }
});
