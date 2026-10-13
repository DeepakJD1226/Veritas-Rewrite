import { readFile, writeFile } from 'node:fs/promises';
import { readConfig } from '../src/config.js';
import { OllamaClient } from '../src/ollama.js';
import { VeritasDetector } from '../src/detector.js';
import { validateInput } from '../src/validation.js';
import { rewriteToTarget } from '../src/target-rewrite.js';

const detector = new VeritasDetector();
try {
  if (!process.argv[2]) throw new Error('Usage: node scripts/evaluate-target.js passage.txt 20');
  const input = validateInput({ text: await readFile(process.argv[2], 'utf8'), targetPercent: process.argv[3] === undefined ? 20 : Number(process.argv[3]), strength: 'substantial', quality: 'deep' });
  const config = readConfig(), started = Date.now();
  const result = await rewriteToTarget(input, new OllamaClient(config), detector, config, undefined, update => console.log(update.message));
  const report = { app: 'Veritas Rewrite', version: '3.0.0', exportedAt: new Date().toISOString(), input, result,
    seconds: (Date.now() - started) / 1000, humanReview: { meaningPreserved: null, naturalness1to5: null, citationsCorrect: null, notes: '' } };
  await writeFile(new URL('../target-evaluation-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(`\nOriginal ${(result.target.before.score * 100).toFixed(2)}% -> best ${(result.ai.score * 100).toFixed(2)}%. ${result.target.met ? 'Target met.' : 'Target not reached.'}\nSaved target-evaluation-results.json, including the input and output text. Review the wording and complete the humanReview fields.`);
} catch (error) { console.error(`Evaluation could not complete: ${error.message}`); process.exitCode = 1; }
finally { await detector.close(); }
