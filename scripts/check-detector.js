import { readFile } from 'node:fs/promises';
import { VeritasDetector } from '../src/detector.js';
import { validateInput } from '../src/validation.js';

const detector = new VeritasDetector();
try {
  if (!process.argv[2]) throw new Error('Usage: node scripts/check-detector.js passage.txt');
  const { text } = validateInput({ text: await readFile(process.argv[2], 'utf8'), targetPercent: 20 });
  const ai = await detector.score(text);
  console.log(JSON.stringify({ text, ai, date: new Date().toISOString() }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await detector.close(); }
