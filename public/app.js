import { MAX_WORDS, MAX_CHARS, wordCount, wordDiff, normalizeText } from './text.js';
import { readDetectorReport, compareDetectorReports } from './detector-report.js';
import { scannerWordCount, formatSignal, selectedTargetState } from './target-score.js';

const $ = id => document.getElementById(id);
const sample = 'In the current digital era, the utilization of automated inventory management systems has become increasingly important for businesses. These systems facilitate the efficient tracking of stock levels and enable organizations to make informed decisions. For an automobile service centre, maintaining accurate records of spare parts can reduce delays during repairs. However, the benefits depend on staff entering each stock movement correctly. A digital tool can support this process, but it does not remove the need for regular physical stock checks. When the physical stock differs from the recorded amount, staff should investigate the difference before ordering more parts. The system should also retain a record of corrections so that the team can review recurring mistakes.';
let ready = false, busy = false, result = null, controller = null, timer = null, toastTimer = null;
let detectorInstalled = false, progressTimer = null;
const hosted = document.body.dataset.deployment === 'render';
let connectionTimer = null;
if (hosted) {
  $('engine-label').textContent = 'SERVER ENGINE';
  $('setup-title').textContent = 'Preparing your writing models';
  $('setup-message').textContent = 'The first startup downloads both models. This page updates automatically.';
  $('setup-ollama').hidden = true; $('setup-pull').hidden = true;
  $('setup-footnote').textContent = 'Models run on your Render server. Drafts are sent to that server over HTTPS. Check Render logs if setup stops.';
}
let original = '';
let lastInput = null, originalDetectorReport = null;
const rewrittenDetectorReports = new Map();

function showError(message = '') { $('error-message').textContent = message; $('error-message').hidden = !message; }
function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}
function updateCounts() {
  const count = wordCount($('draft').value), referenceCount = wordCount($('reference').value), voiceCount = wordCount($('voice-sample').value);
  $('draft-count').replaceChildren(document.createTextNode(`${count} `));
  const suffix = document.createElement('span'); suffix.textContent = '/ 300 words'; $('draft-count').append(suffix);
  $('draft-count').classList.toggle('over', count > MAX_WORDS);
  $('reference-count').textContent = `${referenceCount} / 300 words`;
  $('voice-count').textContent = `${voiceCount} / 120 words`;
  const targeting = $('target-enabled').checked;
  const scannerWords = scannerWordCount($('draft').value);
  $('target-percent').disabled = busy || !targeting;
  $('target-value').textContent = `Below ${$('target-percent').value}%`;
  $('target-percent').setAttribute('aria-valuetext', `Below ${$('target-percent').value} percent`);
  $('target-availability').textContent = !targeting ? 'Target mode is off. Normal rewriting will not measure an AI score.' : !detectorInstalled ? (hosted ? 'The server is preparing the detector. The status panel shows startup progress.' : 'Detector setup needed: run SETUP_TARGET_WINDOWS.bat once, then check the connection. Turn target mode off for normal rewriting.') : scannerWords < 100 ? `Detector installed · ${scannerWords} / 100 minimum scanner words. Shorter drafts can use target mode off.` : 'Detector installed · each candidate is measured after its meaning review.';
  $('rewrite-button').disabled = busy || !ready || !count || count > MAX_WORDS || referenceCount > MAX_WORDS || voiceCount > 120 || (targeting && (!detectorInstalled || scannerWords < 100));
  if (!busy && (count > MAX_WORDS || referenceCount > MAX_WORDS)) {
    showError(`${count > MAX_WORDS ? 'Your draft' : 'The reference excerpt'} is over 300 words. Please shorten it before rewriting.`);
  }
  if (!busy && voiceCount > 120) showError('Keep your writing sample to 120 words or fewer.');
}
function resetResult() {
  result = null; original = '';
  lastInput = null; originalDetectorReport = null; rewrittenDetectorReports.clear();
  $('original-report').value = ''; $('rewrite-report').value = '';
  $('rewrite-output').replaceChildren(); $('rewrite-output').hidden = true;
  $('empty-state').hidden = false; $('review-panel').hidden = true;
  $('copy-button').disabled = true; $('download-button').disabled = true;
  $('output-count').textContent = '— / 300 words'; $('status-message').textContent = '';
  renderDetectorComparison();
}
function edited() { showError(); resetResult(); updateCounts(); }

async function checkConnection() {
  clearTimeout(connectionTimer);
  $('check-connection').disabled = true;
  $('model-status').textContent = 'Checking model';
  let failedStartup = false;
  try {
    const response = await fetch('/api/status', { signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Unable to reach the local backend.');
    ready = data.ready;
    detectorInstalled = data.detector?.installed === true;
    failedStartup = data.startup?.phase === 'failed';
    $('model-status').textContent = ready ? (hosted ? 'Server models ready' : 'Local model ready') : hosted ? (failedStartup ? 'Server needs attention' : 'Preparing server models') : 'Model needs setup';
    $('status-dot').classList.toggle('ready', ready);
    $('setup-message').textContent = ready ? `${data.model} is ready · app v${data.version}. Deep rewrite generates alternatives and runs a second editor pass ${hosted ? 'on your server' : 'locally'}.` : data.message;
    $('model-command').textContent = `ollama pull ${data.model}`;
    $('setup-panel').hidden = ready;
  } catch (error) {
    ready = false; detectorInstalled = false; $('model-status').textContent = 'Backend unavailable'; $('status-dot').classList.remove('ready');
    $('setup-message').textContent = hosted ? 'The server is unavailable or restarting. Check the service logs in Render, then retry.' : 'Start START_WINDOWS.bat and keep its terminal open, then reload this page.';
    $('setup-panel').hidden = false;
  } finally {
    $('check-connection').disabled = false; updateCounts();
    if (hosted && !ready && !failedStartup) connectionTimer = setTimeout(checkConnection, 5000);
  }
}

function setBusy(value) {
  busy = value;
  document.body.classList.toggle('busy', value);
  $('output-area').setAttribute('aria-busy', String(value));
  $('loading-state').hidden = !value; $('cancel-button').hidden = !value;
  $('draft').disabled = value; $('reference').disabled = value; $('protected-terms').disabled = value;
  $('strength').disabled = value;
  $('quality').disabled = value; $('voice-sample').disabled = value;
  $('target-enabled').disabled = value;
  document.querySelectorAll('input[name="tone"]').forEach(radio => { radio.disabled = value; });
  for (const id of ['sample-button', 'clear-button', 'import-button', 'use-rewrite']) $(id).disabled = value;
  if (value) {
    $('empty-state').hidden = true; $('rewrite-output').hidden = true;
    $('loading-message').textContent = $('target-enabled').checked ? 'Measuring the original, then rewriting, reviewing and measuring alternatives.' : $('quality').value === 'deep' ? 'Generating alternative rewrites, then reviewing their meaning and fluency.' : 'Rewriting the draft, then reviewing its meaning and fluency.';
    $('elapsed').textContent = '0s';
    const start = Date.now();
    timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - start) / 1000);
      $('elapsed').textContent = `${seconds}s`;
      if (seconds > 95) $('elapsed').textContent += ' · local passes can take several minutes';
    }, 1000);
    const activeController = controller;
    let polling = false;
    progressTimer = setInterval(async () => {
      if (polling || !busy) return; polling = true;
      try {
        const response = await fetch('/api/progress', { signal: AbortSignal.timeout(3000) });
        const data = await response.json();
        if (busy && controller === activeController && data.busy && data.message) $('loading-message').textContent = data.message;
      } catch {} finally { polling = false; }
    }, 1200);
  } else { clearInterval(timer); clearInterval(progressTimer); $('empty-state').hidden = !!result; $('rewrite-output').hidden = !result; }
  updateCounts();
}

function renderOutput() {
  if (!result) return;
  const fragment = document.createDocumentFragment();
  if ($('show-changes').checked) {
    for (const part of wordDiff(original, result.text)) {
      if (part.changed) { const mark = document.createElement('mark'); mark.textContent = part.text; fragment.append(mark); }
      else fragment.append(document.createTextNode(part.text));
    }
  } else fragment.append(document.createTextNode(result.text));
  $('rewrite-output').replaceChildren(fragment);
}
function renderReport() {
  const report = result.report;
  $('output-count').textContent = `${report.outputWords} / 300 words`;
  $('metric-words').textContent = report.outputWords;
  $('metric-change').textContent = `${report.wordingChangedPercent}%`;
  $('metric-preserved').textContent = Object.values(report.preserved).reduce((sum, n) => sum + n, 0);
  $('metric-preserved').title = Object.entries(report.preserved).map(([key, value]) => `${value} ${key}`).join(', ') + '. Checks may overlap.';
  $('review-notes').replaceChildren();
  for (const message of report.warnings) { const li = document.createElement('li'); li.textContent = message; $('review-notes').append(li); }
  $('reference-report').hidden = !report.reference;
  if (report.reference) {
    const display = value => value ? `${value.percent}%` : 'Too short';
    $('overlap-before').textContent = display(report.reference.before);
    $('overlap-after').textContent = display(report.reference.after);
  }
  $('review-panel').hidden = false;
  $('copy-button').disabled = false; $('download-button').disabled = false;
  const editing = report.editing;
  $('editor-summary').textContent = editing ? `Local editor: naturalness ${editing.localReview.naturalness}/5 · fluency ${editing.localReview.fluency}/5. Stock phrases: ${editing.before.stockPhrases.length} → ${editing.after.stockPhrases.length}. These are editing observations, not detector scores.` : 'Unchanged original. No meaning or fluency rating is claimed for this version.';
  $('pipeline-summary').textContent = `${result.reviewedCandidates} candidates reviewed in completed batches · ${result.alternatives.length} versions available${result.failedRounds ? ` · ${result.failedRounds} rounds failed quality checks` : ''}`;
  renderTargetReport();
  renderDetectorComparison();
}

function renderCandidates() {
  $('candidate-select').replaceChildren();
  result.alternatives.forEach((candidate, index) => {
    const option = document.createElement('option'); option.value = candidate.id;
    option.textContent = `${index + 1}. ${candidate.label}${candidate.ai ? ` · ${formatSignal(candidate.ai.score, result.target.requestedPercent)}` : index === 0 ? ' · editor’s pick' : ''}`;
    $('candidate-select').append(option);
  });
  $('candidate-select').value = result.selectedId;
}

function renderTargetReport() {
  const state = selectedTargetState(result);
  $('target-report').hidden = !state;
  if (!state) return;
  $('target-report').classList.toggle('target-met', state.met);
  $('target-result').textContent = state.message;
  $('target-run-summary').textContent = `Goal: below ${state.target}% · ${result.target.roundsUsed} / ${result.target.maxRounds} rounds · ${result.target.detectorChecks} checks`;
  $('before-signal').textContent = formatSignal(state.before, state.target);
  $('after-signal').textContent = formatSignal(state.after, state.target);
  for (const [id, score] of [['before-meter', state.before], ['after-meter', state.after]]) {
    $(id).value = score * 100; $(id).low = state.target; $(id).optimum = 0;
    $(id).setAttribute('aria-valuetext', formatSignal(score, state.target));
  }
  $('target-outcome').textContent = `${state.change > 0 ? 'Decreased' : state.change < 0 ? 'Increased' : 'Unchanged'}${state.change ? ` by ${Math.abs(state.change).toFixed(2)} percentage points` : ''} compared with the original.${result.kind === 'original' && !state.met ? ' No reviewed rewrite improved its score, so the original was retained.' : ''}`;
  $('target-method').textContent = `Detector: ${result.ai.model} · revision ${result.ai.revision.slice(0, 8)} · q8 · full ${result.ai.checkedTokens}/${result.ai.totalTokens} token coverage.`;
  $('target-attempts').replaceChildren();
  for (const candidate of result.alternatives) {
    const row = document.createElement('tr');
    for (const text of [candidate.label, formatSignal(candidate.ai.score, state.target), candidate.ai.score < state.target / 100 ? 'Met' : 'Not reached']) {
      const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
    }
    $('target-attempts').append(row);
  }
  for (const round of result.target.rounds) for (const rejection of round.rejected) {
    const row = document.createElement('tr');
    for (const text of [`Round ${round.round} · ${rejection.code}`, 'Not scored', rejection.message]) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell); }
    $('target-attempts').append(row);
  }
}

function renderDetectorComparison() {
  const after = result ? rewrittenDetectorReports.get(result.selectedId) : null;
  $('original-report-status').textContent = originalDetectorReport ? `${originalDetectorReport.percent}% · ${originalDetectorReport.fallback ? 'fallback' : 'full model'}` : 'Not imported';
  $('rewrite-report-status').textContent = after ? `${after.percent}% · ${after.fallback ? 'fallback' : 'full model'}` : 'Not imported for this version';
  const comparison = compareDetectorReports(originalDetectorReport, after);
  $('detector-result').textContent = comparison.comparable ? `${comparison.beforePercent}% → ${comparison.afterPercent}%. ${comparison.message}` : comparison.message;
  $('detector-note').textContent = comparison.note || 'Reports must match these exact passages and use the same completed detector method.';
}

$('rewrite-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  showError();
  const text = normalizeText($('draft').value);
  const reference = normalizeText($('reference').value);
  const voiceSample = normalizeText($('voice-sample').value);
  const terms = $('protected-terms').value.split(',').map(x => x.trim()).filter(Boolean);
  if (!text || !wordCount(text)) { showError('Add a draft first.'); return; }
  if (wordCount(text) > MAX_WORDS || wordCount(reference) > MAX_WORDS) { updateCounts(); return; }
  if (wordCount(voiceSample) > 120) { updateCounts(); return; }
  if (terms.some(term => !text.includes(term))) { showError('Each protected term must appear exactly in your draft, including capitals.'); return; }
  if (terms.length > 20) { showError('Use at most 20 protected terms.'); return; }
  if (!ready) { $('setup-panel').hidden = false; return; }
  resetResult(); original = text;
  const payload = { text, reference, voiceSample, quality: $('quality').value, protectedTerms: terms, tone: document.querySelector('input[name="tone"]:checked').value, strength: $('strength').value, targetPercent: $('target-enabled').checked ? Number($('target-percent').value) : null };
  lastInput = { ...payload };
  controller = new AbortController(); setBusy(true);
  try {
    const response = await fetch('/api/rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
    const data = await response.json();
    if (!response.ok) {
      if (['OLLAMA_OFFLINE', 'MODEL_MISSING', 'CLOUD_MODEL_BLOCKED', 'LOCAL_MODEL_UNVERIFIED'].includes(data.error?.code)) void checkConnection();
      throw new Error([data.error?.message || 'The rewrite did not complete.', ...(data.error?.checks || [])].join('\n'));
    }
    if (typeof data.text !== 'string' || wordCount(data.text) > MAX_WORDS || !data.report || !Array.isArray(data.alternatives) || data.alternatives.length < 1 || data.alternatives.length > 10 || data.alternatives.some(item => typeof item.text !== 'string' || wordCount(item.text) > MAX_WORDS || (!item.report?.editing && item.kind !== 'original'))) throw new Error('The backend returned an invalid rewrite. Please retry.');
    result = data; renderCandidates(); renderOutput(); renderReport();
    $('status-message').textContent = data.target ? `${selectedTargetState(data).message} Check the measured results below and verify the meaning.` : 'Reviewed versions are ready. Choose your preferred wording and verify the meaning. Target mode was off; no AI score was measured.';
  } catch (error) {
    if (error.name === 'AbortError') $('status-message').textContent = 'Rewrite cancelled. Your draft is unchanged.';
    else showError(error.message === 'Failed to fetch' ? 'The local backend disconnected. Keep START_WINDOWS.bat running and try again.' : error.message);
  } finally { controller = null; setBusy(false); }
});

for (const id of ['draft', 'reference', 'protected-terms', 'voice-sample']) $(id).addEventListener('input', edited);
$('strength').addEventListener('change', edited);
$('quality').addEventListener('change', edited);
$('target-enabled').addEventListener('change', edited);
$('target-percent').addEventListener('input', edited);
document.querySelectorAll('input[name="tone"]').forEach(radio => radio.addEventListener('change', edited));
$('show-changes').addEventListener('change', renderOutput);
$('status-button').addEventListener('click', () => { $('setup-panel').hidden = !$('setup-panel').hidden; });
$('check-connection').addEventListener('click', checkConnection);
$('cancel-button').addEventListener('click', () => controller?.abort());
$('sample-button').addEventListener('click', () => { $('draft').value = sample; $('protected-terms').value = ''; edited(); $('draft').focus(); });
$('clear-button').addEventListener('click', () => { for (const id of ['draft', 'reference', 'protected-terms', 'voice-sample']) $(id).value = ''; edited(); $('draft').focus(); });
$('use-rewrite').addEventListener('click', () => { if (result) { $('draft').value = result.text; edited(); $('draft').focus(); toast('Rewrite moved to your draft'); } });
$('copy-button').addEventListener('click', async () => {
  if (!result) return;
  try { await navigator.clipboard.writeText(result.text); toast('Rewrite copied'); }
  catch { const range = document.createRange(); range.selectNodeContents($('rewrite-output')); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); toast('Press Ctrl+C (or Cmd+C) to copy the selected rewrite'); }
});
$('download-button').addEventListener('click', () => {
  if (!result) return;
  const url = URL.createObjectURL(new Blob([result.text + '\n'], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'veritas-rewrite.txt'; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('candidate-select').addEventListener('change', () => {
  if (!result) return;
  const selected = result.alternatives.find(candidate => candidate.id === $('candidate-select').value);
  if (!selected) return;
  result = { ...result, ...selected, selectedId: selected.id };
  $('rewrite-report').value = ''; renderOutput(); renderReport();
  if (result.target) $('status-message').textContent = selectedTargetState(result).message;
});
async function importDetectorReport(side, file) {
  if (!file || !result) return;
  const activeResult = result;
  const expected = side === 'original' ? original : result.text;
  const selectedId = result.selectedId;
  try {
    if (!file.name.toLowerCase().endsWith('.json') || file.size > 5_000_000) throw new Error('Choose a JSON report smaller than 5 MB.');
    const report = readDetectorReport(JSON.parse(await file.text()), expected);
    if (result !== activeResult) throw new Error('The selected text changed while importing. Import the report again.');
    if (side === 'original') originalDetectorReport = report;
    else rewrittenDetectorReports.set(selectedId, report);
    showError(); renderDetectorComparison();
  } catch (error) { showError(error instanceof SyntaxError ? 'This file is not valid JSON.' : error.message); }
}
$('original-report').addEventListener('change', async () => { await importDetectorReport('original', $('original-report').files[0]); $('original-report').value = ''; });
$('rewrite-report').addEventListener('change', async () => { await importDetectorReport('rewrite', $('rewrite-report').files[0]); $('rewrite-report').value = ''; });
$('export-comparison').addEventListener('click', () => {
  if (!result) return;
  const data = { app: 'Veritas Rewrite', version: '3.0.0', exportedAt: new Date().toISOString(), input: lastInput, result,
    detector: { original: originalDetectorReport, rewrites: Object.fromEntries(rewrittenDetectorReports), selectedComparison: compareDetectorReports(originalDetectorReport, rewrittenDetectorReports.get(result.selectedId)) } };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'veritas-rewrite-comparison.json'; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
async function importFile(file) {
  if (!file || busy) return;
  if (!file.name.toLowerCase().endsWith('.txt')) { showError('Import a .txt file, or copy the text from your document and paste it here.'); return; }
  if (file.size > 50000) { showError('This file is too large. Paste a passage of up to 300 words instead.'); return; }
  try {
    const content = (await file.text()).replace(/^\uFEFF/, '');
    if (content.length > MAX_CHARS) { showError('This file exceeds 12,000 characters. Paste a smaller passage.'); return; }
    $('draft').value = content; $('protected-terms').value = ''; edited();
    if (wordCount(content) <= MAX_WORDS) toast('Text imported');
    $('draft').focus();
  } catch { showError('Could not read that text file. Please paste the text instead.'); }
}
$('import-button').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async () => { await importFile($('file-input').files[0]); $('file-input').value = ''; });
$('draft').addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
$('draft').addEventListener('drop', event => { if (event.dataTransfer.files.length) { event.preventDefault(); void importFile(event.dataTransfer.files[0]); } });
$('draft').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !$('rewrite-button').disabled) { event.preventDefault(); $('rewrite-form').requestSubmit(); } });
updateCounts();
void checkConnection();
