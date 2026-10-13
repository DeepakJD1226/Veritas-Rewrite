import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { AppError } from './errors.js';
import { DETECTOR_METHOD, assertDetectorEligible, active, validateMeasurement } from './detector-core.js';

export const CACHE_DIR = process.env.VERITAS_DETECTOR_CACHE ? resolve(process.env.VERITAS_DETECTOR_CACHE) : fileURLToPath(new URL('../.detector-cache/', import.meta.url));
export const MARKER_URL = pathToFileURL(resolve(CACHE_DIR, 'ready.json'));
const require = createRequire(import.meta.url);

export class VeritasDetector {
  constructor({ allowDownload = false, timeoutMs = 180000, processFactory = url => fork(fileURLToPath(url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] }) } = {}) {
    this.allowDownload = allowDownload; this.timeoutMs = timeoutMs; this.processFactory = processFactory;
    this.worker = null; this.pending = null; this.counter = 0;
  }
  async status() {
    try {
      require.resolve('@huggingface/transformers');
      const marker = JSON.parse(await readFile(MARKER_URL, 'utf8'));
      if (Object.entries(DETECTOR_METHOD).some(([key, value]) => marker[key] !== value)) throw new Error('Stale detector');
      return { installed: true, ...DETECTOR_METHOD, message: 'Detector installed. Each run verifies that the local model loads and completes scoring.' };
    } catch {
      return { installed: false, ...DETECTOR_METHOD, message: 'Run SETUP_TARGET_WINDOWS.bat once to install the local Veritas detector, then check the connection again.' };
    }
  }
  async score(text, signal, progress = () => {}) {
    active(signal); assertDetectorEligible(text);
    if (this.pending) throw new AppError(429, 'DETECTOR_BUSY', 'A detector check is already running.');
    if (!this.allowDownload && !(await this.status()).installed) throw new AppError(503, 'DETECTOR_NOT_INSTALLED', 'Run SETUP_TARGET_WINDOWS.bat once, then restart the app. You can also turn target mode off to rewrite without a detector score.');
    active(signal);
    if (!this.worker) {
      this.worker = this.processFactory(new URL('./detector-process.js', import.meta.url));
      const child = this.worker;
      child.on('error', () => {}); // Per-request handler reports the error; idle exits clear the process.
      child.on('exit', () => { if (this.worker === child) this.worker = null; });
    }
    const worker = this.worker, id = ++this.counter;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        worker.off('message', message); worker.off('error', failed); worker.off('exit', exited);
        this.pending = null;
      };
      const finish = (error, result, terminate = false) => {
        if (settled) return; settled = true; cleanup();
        if (terminate) { this.worker = null; worker.kill(); }
        if (error) reject(error); else resolve(result);
      };
      const abort = () => finish(new AppError(499, 'CANCELLED', 'The rewrite was cancelled.'), null, true);
      const failed = () => finish(new AppError(503, 'DETECTOR_UNAVAILABLE', 'The detector stopped. Run SETUP_TARGET_WINDOWS.bat and retry.'), null, true);
      const exited = () => failed();
      const message = data => {
        if (data.id !== id) return;
        if (data.type === 'progress') { progress(data.message); return; }
        if (data.type === 'error') { finish(new AppError(503, data.code, data.message), null, true); return; }
        try { finish(null, validateMeasurement(data.result)); } catch (error) { finish(error, null, true); }
      };
      const timer = setTimeout(() => finish(new AppError(504, 'DETECTOR_TIMEOUT', 'The local detector timed out. Retry after closing other memory-heavy applications.'), null, true), this.timeoutMs);
      this.pending = () => finish(new AppError(499, 'CANCELLED', 'The detector was stopped.'), null, true);
      worker.on('message', message); worker.once('error', failed); worker.once('exit', exited);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else worker.send({ id, text, config: { allowDownload: this.allowDownload, cacheDir: CACHE_DIR, localModelPath: fileURLToPath(new URL('../.detector-models/', import.meta.url)) } }, error => { if (error) failed(); });
    });
  }
  async close() {
    if (this.pending) this.pending();
    const worker = this.worker; this.worker = null;
    if (worker) await new Promise(resolve => { worker.once('exit', resolve); if (!worker.kill()) resolve(); });
  }
}
