import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function readConfig(env = process.env) {
  let file = {};
  try { file = JSON.parse(readFileSync(fileURLToPath(new URL('../settings.json', import.meta.url)), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('settings.json must contain valid JSON. Start with settings.example.json.'); }
  const hosted = env.VERITAS_DEPLOYMENT === 'render';
  if (env.VERITAS_DEPLOYMENT && !['local', 'render'].includes(env.VERITAS_DEPLOYMENT)) throw new Error('VERITAS_DEPLOYMENT must be local or render.');
  const port = Number(hosted ? env.PORT || 10000 : env.VERITAS_PORT || file.port || 8788);
  const model = env.VERITAS_MODEL || file.model || 'llama3.2:latest';
  const timeoutSeconds = Number(env.VERITAS_TIMEOUT || file.timeoutSeconds || 180);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be an integer from 1024 to 65535.');
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(model) || /cloud|:\/\//i.test(model)) {
    throw new Error('Choose an installed local Ollama model; cloud models and URLs are not allowed.');
  }
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 600) throw new Error('Timeout must be between 5 and 600 seconds.');
  const publicOrigins = [];
  const accessUser = env.VERITAS_ACCESS_USER || 'admin';
  const accessPassword = env.VERITAS_ACCESS_PASSWORD || '';
  if (hosted) {
    for (const value of [env.RENDER_EXTERNAL_URL, env.VERITAS_PUBLIC_URL].filter(Boolean)) {
      let url;
      try { url = new URL(value); } catch { throw new Error('The public URL must be a valid HTTPS origin.'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('The public URL must be an HTTPS origin without a path or credentials.');
      publicOrigins.push(url.origin);
    }
    if (!publicOrigins.length) throw new Error('Render must provide RENDER_EXTERNAL_URL, or set VERITAS_PUBLIC_URL to the HTTPS service address.');
    if (accessPassword.length < 16 || accessPassword.length > 256 || /[\r\n\x00]/.test(accessPassword)) throw new Error('Set VERITAS_ACCESS_PASSWORD to a unique password of 16–256 characters.');
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(accessUser)) throw new Error('VERITAS_ACCESS_USER must use 1–64 letters, digits, dots, underscores or hyphens.');
  }
  return { host: hosted ? '0.0.0.0' : '127.0.0.1', port, model, timeoutSeconds, maxAttempts: 4, candidateCount: 3, targetRounds: 3, hosted, publicOrigins, accessUser, accessPassword };
}
