import { readFile, writeFile } from 'node:fs/promises';
import { readConfig } from '../src/config.js';
import { OllamaClient } from '../src/ollama.js';
import { validateInput } from '../src/validation.js';
import { rewrite } from '../src/rewrite.js';

try {
  const config = readConfig();
  const client = new OllamaClient(config);
  await client.ensureLocal();
  const cases = JSON.parse(await readFile(new URL('../examples/evaluation-cases.json', import.meta.url), 'utf8'));
  const results = [];
  for (const item of cases) {
    console.log(`Running ${item.id} with the real local model…`);
    const started = performance.now();
    try {
      const result = await rewrite(validateInput(item), client, config);
      results.push({ id: item.id, input: item.text, result, seconds: Math.round((performance.now() - started) / 1000), automatedChecks: 'passed', humanReview: { meaningPreserved: null, naturalness1to5: null, citationsCorrect: null, notes: '' } });
      console.log(`  Passed automated checks. ${result.report.outputWords} words. Human review still needed.`);
    } catch (error) { results.push({ id: item.id, input: item.text, automatedChecks: 'failed', code: error.code, message: error.message }); console.log(`  ${error.code}: ${error.message}`); }
  }
  const report = { generatedAt: new Date().toISOString(), model: config.model, note: 'Automated checks verify limits and selected exact text. They do not establish meaning preservation, plagiarism, authorship, or human naturalness.', results };
  const location = new URL('../evaluation-results.json', import.meta.url);
  await writeFile(location, JSON.stringify(report, null, 2) + '\n');
  console.log('\nSaved evaluation-results.json. Compare each input and output and complete the humanReview fields.');
  if (results.some(x => x.automatedChecks !== 'passed')) process.exitCode = 1;
} catch (error) { console.error(`Evaluation could not start: ${error.message}`); process.exitCode = 1; }
