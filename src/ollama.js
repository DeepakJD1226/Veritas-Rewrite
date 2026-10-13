import { AppError } from './errors.js';
import http from 'node:http';
import { Readable } from 'node:stream';

const LOCAL_URL = 'http://127.0.0.1:11434';
const schema = {
  type: 'object', properties: { rewrite: { type: 'string', minLength: 1, maxLength: 12000 } },
  required: ['rewrite'], additionalProperties: false
};
const reviewSchema = {
  type: 'object', properties: { reviews: { type: 'array', minItems: 1, maxItems: 3, items: {
    type: 'object', properties: { id: { type: 'string' }, meaningPreserved: { type: 'boolean' },
      naturalness: { type: 'integer', minimum: 1, maximum: 5 }, fluency: { type: 'integer', minimum: 1, maximum: 5 },
      issues: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 500 } } },
    required: ['id', 'meaningPreserved', 'naturalness', 'fluency', 'issues'], additionalProperties: false
  } } }, required: ['reviews'], additionalProperties: false
};

// Direct sockets to loopback avoid inherited HTTP_PROXY / NODE_USE_ENV_PROXY settings.
export function directLocalFetch(url, options, requestImpl = http.request) {
  const target = new URL(url);
  if (target.origin !== LOCAL_URL) throw new Error('Only the local Ollama endpoint is allowed.');
  return new Promise((resolve, reject) => {
    const request = requestImpl({ hostname: '127.0.0.1', port: 11434, path: target.pathname, method: options.method, headers: options.headers, signal: options.signal }, response => {
      resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers: response.headers }));
    });
    request.on('error', reject);
    request.end(options.body);
  });
}

async function boundedJson(response) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 2_000_000) throw new AppError(502, 'MODEL_RESPONSE', 'The model returned an oversized response.');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError(502, 'MODEL_RESPONSE', 'Ollama returned an unreadable response. Restart Ollama and retry.'); }
}

export class OllamaClient {
  constructor(config, fetchImpl = directLocalFetch) { this.config = config; this.fetchImpl = fetchImpl; }

  async request(path, payload, signal, timeout = 5000) {
    const timeoutSignal = AbortSignal.timeout(timeout);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      const response = await this.fetchImpl(`${LOCAL_URL}${path}`, {
        method: payload ? 'POST' : 'GET',
        headers: payload ? { 'Content-Type': 'application/json' } : {},
        body: payload ? JSON.stringify(payload) : undefined,
        signal: combined, redirect: 'error'
      });
      const data = await boundedJson(response);
      if (!response.ok) {
        if (response.status === 404) throw new AppError(503, 'MODEL_MISSING', `Download the local model first: ollama pull ${this.config.model}`);
        throw new AppError(502, 'MODEL_ERROR', 'Ollama could not run the model. Check its terminal for memory or model errors.');
      }
      return data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (signal?.aborted) throw new AppError(499, 'CANCELLED', 'The rewrite was cancelled.');
      if (timeoutSignal.aborted) throw new AppError(504, 'MODEL_TIMEOUT', `The local model took too long. Try a shorter draft or increase timeoutSeconds in settings.json.`);
      throw new AppError(503, 'OLLAMA_OFFLINE', 'Start the Ollama application, then check the connection again.');
    }
  }

  async ensureLocal(signal) {
    // Query metadata before transmitting any user text. Reject cloud aliases too.
    const data = await this.request('/api/show', { model: this.config.model }, signal);
    if (data.remote_model || data.remote_host || data.details?.remote_model || data.details?.remote_host || /cloud/i.test(this.config.model)) {
      throw new AppError(400, 'CLOUD_MODEL_BLOCKED', 'Select a downloaded local model. Cloud-backed models are not allowed.');
    }
    if (!data.details || data.details.format !== 'gguf' || !data.model_info || !Object.keys(data.model_info).some(key => key.endsWith('.block_count') || key.endsWith('.embedding_length'))) {
      throw new AppError(503, 'LOCAL_MODEL_UNVERIFIED', 'Could not verify local model weights. Use a current Ollama version and download llama3.2 locally.');
    }
    if (data.capabilities && !data.capabilities.includes('completion')) throw new AppError(400, 'MODEL_UNSUITABLE', 'The selected model cannot generate text. Choose a local text model.');
    return data;
  }

  async status() {
    try {
      await this.ensureLocal();
      return { ready: true, model: this.config.model, localOnly: true, message: 'Local model ready' };
    } catch (error) {
      return { ready: false, model: this.config.model, localOnly: true, code: error.code || 'MODEL_ERROR', message: error.message };
    }
  }

  async structured(messages, signal, format, temperature) {
    const data = await this.request('/api/chat', {
      model: this.config.model, messages, stream: false, format,
      options: { temperature, top_p: 0.9, num_predict: 1600, num_ctx: 8192 },
      keep_alive: '5m'
    }, signal, this.config.timeoutSeconds * 1000);
    if (data.done !== true || data.done_reason === 'length') return { invalid: 'The model output was cut off. Return a complete passage within 300 words.' };
    const content = data.message?.content;
    if (typeof content !== 'string') return { invalid: 'Return valid JSON with one string field named rewrite.' };
    try {
      const parsed = JSON.parse(content);
      return parsed;
    } catch { return { invalid: 'Return valid JSON with one string field named rewrite.' }; }
  }

  async generate(messages, signal, options = {}) {
    const data = await this.structured(messages, signal, schema, options.temperature ?? 0.55);
    if (data?.invalid) return data;
    if (!data || typeof data.rewrite !== 'string') return { invalid: 'Return valid JSON with one string field named rewrite.' };
    return { text: data.rewrite };
  }

  async review(messages, signal) { return this.structured(messages, signal, reviewSchema, 0.1); }
}
