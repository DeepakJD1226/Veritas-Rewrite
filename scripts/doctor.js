import { readConfig } from '../src/config.js';
import { OllamaClient } from '../src/ollama.js';
import { VeritasDetector } from '../src/detector.js';

try {
  const config = readConfig();
  console.log(`Node: ${process.version} ${Number(process.versions.node.split('.')[0]) >= 22 ? '(supported)' : '(needs 22+)'}\nApp address: http://127.0.0.1:${config.port}\nModel: ${config.model}\nModel connection: http://127.0.0.1:11434 (fixed local address)`);
  const status = await new OllamaClient(config).status();
  console.log(`Model status: ${status.ready ? 'READY' : status.code}\n${status.message}`);
  const detector = await new VeritasDetector().status();
  console.log(`Target detector: ${detector.installed ? 'INSTALLED' : 'NEEDS SETUP'}\n${detector.message}`);
  if (!status.ready) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
