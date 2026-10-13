import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { VeritasDetector, CACHE_DIR, MARKER_URL } from '../src/detector.js';
import { DETECTOR_METHOD } from '../src/detector-core.js';
import { pathToFileURL } from 'node:url';

// Public synthetic passage only; never a user's submitted draft.
export const smokeText = 'The workshop keeps a record of spare parts so staff can see what is available before starting a repair. A delivery changes the stock count when someone records the received parts. A repair changes it again when a mechanic uses those parts. The software can make these updates easier to review, but the records still depend on people entering accurate information. Staff also need to compare the records with the items on the shelves. If the figures do not agree, they should investigate the difference before ordering more stock. A useful system makes these checks clear and keeps the relevant details together without replacing the physical count.';

export async function setupDetector() {
const detector = new VeritasDetector({ allowDownload: true, timeoutMs: 20 * 60 * 1000 });
try {
  console.log('Installing the pinned Veritas AI classifier. Internet is needed for this one-time model download.\nAfter setup, draft scoring runs on this computer with remote model downloads disabled.\n');
  await mkdir(CACHE_DIR, { recursive: true });
  await rm(MARKER_URL, { force: true });
  let last = '';
  const ai = await detector.score(smokeText, undefined, message => { if (message !== last) { last = message; console.log(message); } });
  const pending = new URL('ready.pending.json', MARKER_URL);
  await writeFile(pending, JSON.stringify({ ...DETECTOR_METHOD, installedAt: new Date().toISOString() }, null, 2) + '\n');
  await rename(pending, MARKER_URL);
  await detector.close();
  // A separate process verifies that the same cached model loads without network.
  const offline = new VeritasDetector();
  try { await offline.score(smokeText); }
  catch (error) { await rm(MARKER_URL, { force: true }); throw error; }
  finally { await offline.close(); }
  console.log(`\nDetector installed and verified in offline mode (${ai.checkedTokens} tokens checked).\nNo target achievement has been inferred from this setup check.\n${process.env.VERITAS_DEPLOYMENT === 'render' ? 'The server will finish its readiness check automatically.' : 'Run START_WINDOWS.bat, then enable the AI-signal target.'}`);
} catch (error) {
  console.error(`\n${error.message}\nIf packages are missing, run npm install in the project folder and retry. A failed setup never creates a substitute score.`);
  process.exitCode = 1;
} finally { await detector.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await setupDetector();
