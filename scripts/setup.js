import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readConfig } from '../src/config.js';
import { OllamaClient } from '../src/ollama.js';

try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Install Node.js 22 or newer from https://nodejs.org/');
  const config = readConfig();
  const useLargerModel = process.argv.includes('--larger-model');
  if (useLargerModel) config.model = 'qwen2.5:7b';
  console.log('Veritas Rewrite v3 — local setup\n');
  if (useLargerModel) console.log('Optional larger model: qwen2.5:7b. Download about 4.7 GB.\nIt needs more memory and can be slower on a CPU. Detector-score improvement is not guaranteed.\n');
  let binary = 'ollama';
  if (spawnSync(binary, ['--version'], { stdio: 'ignore' }).error) {
    const candidate = process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe') : '';
    if (candidate && existsSync(candidate)) binary = candidate;
    else throw new Error('Install Ollama from https://ollama.com/download, then run setup again.');
  }
  async function reachable() {
    try { const response = await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(1500), redirect: 'error' }); return response.ok; }
    catch { return false; }
  }
  if (!await reachable()) {
    console.log('Starting Ollama locally…');
    const child = spawn(binary, ['serve'], { stdio: 'ignore', detached: true, env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_NO_CLOUD: '1' } });
    child.on('error', () => {}); child.unref();
    for (let i = 0; i < 15 && !await reachable(); i++) await delay(1000);
    if (!await reachable()) throw new Error('Start Ollama manually, then run setup again.');
  }
  const client = new OllamaClient(config);
  const status = await client.status();
  if (!status.ready) {
    if (status.code !== 'MODEL_MISSING') throw new Error(status.message);
    console.log(`Downloading ${config.model}. ${useLargerModel ? 'This model is about 4.7 GB.' : 'The default llama3.2 model is about 2 GB.'}\nThis is a one-time download; please keep this window open.\n`);
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(binary, ['pull', config.model], { stdio: 'inherit', env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_NO_CLOUD: '1' } });
      child.on('error', reject); child.on('exit', resolve);
    });
    if (exitCode !== 0) throw new Error('Model download did not finish. Check your internet connection and disk space, then rerun setup.');
  }
  await client.ensureLocal();
  if (useLargerModel) {
    const location = new URL('../settings.json', import.meta.url);
    let settings = {};
    try { settings = JSON.parse(await readFile(location, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(location, JSON.stringify({ ...settings, model: config.model }, null, 2) + '\n');
    console.log('Selected qwen2.5:7b in settings.json. Restart the app to use it.');
    if (process.env.VERITAS_MODEL) console.log('Note: your VERITAS_MODEL environment variable overrides settings.json. Clear it if you want to use the new model.');
  }
  console.log(`\nReady: ${config.model}\nNormal rewriting is ready. For measured target mode, also run SETUP_TARGET_WINDOWS.bat.\nRun START_WINDOWS.bat, or: node server.js --open`);
} catch (error) { console.error(`\n${error.message}`); process.exitCode = 1; }
