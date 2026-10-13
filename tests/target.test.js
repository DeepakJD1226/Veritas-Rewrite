import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { rewriteToTarget } from '../src/target-rewrite.js';
import { validateInput } from '../src/validation.js';
import { scoreWithClassifier, summaryScore, aiProbability, DETECTOR_METHOD, validateMeasurement, detectorWordCount } from '../src/detector-core.js';
import { VeritasDetector } from '../src/detector.js';
import { AppError } from '../src/errors.js';
import { formatSignal, selectedTargetState } from '../public/target-score.js';

const source = Array(12).fill('Staff record every stock movement and check physical parts regularly.').join(' ');
const passage = label => `${label} ${source}`;
const config = { model: 'test-local', targetRounds: 3, candidateCount: 3, maxAttempts: 4 };
const input = options => validateInput({ text: source, targetPercent: 20, ...options });
const measurement = (score, overrides = {}) => ({ ...DETECTOR_METHOD, status: 'complete', score, fallback: false, checkedTokens: 120, totalTokens: 120, chunks: [], ...overrides });
function scorer(scores) {
  const calls = [];
  return { calls, async score(text) { calls.push(text); const value = scores[calls.length - 1]; if (value instanceof Error) throw value; return measurement(value); } };
}
function batches(items) {
  const calls = [];
  const run = async draft => {
    calls.push(draft);
    const contents = items[calls.length - 1] ?? items.at(-1);
    if (contents instanceof Error) throw contents;
    const alternatives = contents.map((text, i) => ({ id: `candidate-${i + 1}`, label: `Version ${i + 1}`, text,
      report: { outputWords: detectorWordCount(text), editing: { localReview: { meaningPreserved: true } } } }));
    return { alternatives, attempts: alternatives.length, generatedCandidates: alternatives.length, reviewedCandidates: alternatives.length, rejectedCandidates: 0 };
  };
  return { run, calls };
}

test('target bounds and 100-word eligibility are server-side; the 300-word cap still wins', () => {
  for (const targetPercent of [0, 4, 81, 20.5, '20', true, NaN]) assert.throws(() => input({ targetPercent }), { code: 'INVALID_TARGET' });
  assert.equal(input().targetPercent, 20);
  assert.equal(validateInput({ text: 'A shorter draft.' }).targetPercent, null);
  assert.throws(() => input({ text: Array(99).fill('word').join(' ') }), { code: 'DETECTOR_TOO_SHORT' });
  assert.throws(() => input({ text: Array(301).fill('word').join(' ') }), { code: 'WORD_LIMIT' });
  assert.throws(() => input({ text: Array(100).fill('தமிழ்').join(' ') }), { code: 'DETECTOR_UNSUPPORTED' });
});
test('target loop measures candidates and stops after reaching the goal in a later round', async () => {
  const detector = scorer([.98, .81, .42, .19, .37]);
  const batch = batches([[passage('First'), passage('Second')], [passage('Third'), passage('Fourth')]]);
  const result = await rewriteToTarget(input(), {}, detector, config, undefined, () => {}, batch.run);
  assert.equal(result.target.met, true); assert.equal(result.ai.score, .19);
  assert.equal(result.target.before.score, .98); assert.equal(result.target.roundsUsed, 2);
  assert.equal(result.target.detectorChecks, 5); assert.equal(result.text, passage('Third'));
  assert.ok(batch.calls.every(c => c.text === source));
  assert.equal(batch.calls[1].targetFeedback.bestCandidateSoFar, passage('Second'));
});
test('98 to 98.1 keeps the original and never declares a lower score', async () => {
  const detector = scorer([.98, .981, .99, .985]);
  const batch = batches([[passage('One')], [passage('Two')], [passage('Three')]]);
  const result = await rewriteToTarget(input(), {}, detector, config, undefined, () => {}, batch.run);
  assert.equal(result.kind, 'original'); assert.equal(result.text, source);
  assert.equal(result.target.met, false); assert.equal(result.target.status, 'not_reached');
  assert.equal(result.ai.score, .98); assert.equal(result.report.editing, null);
  assert.equal(result.alternatives.find(x => x.ai.score === .981).ai.score, .981);
});
test('a missed target returns the best measured acceptable candidate after three rounds', async () => {
  const detector = scorer([.98, .7, .32, .5]);
  const batch = batches([[passage('One')], [passage('Two')], [passage('Three')]]);
  const result = await rewriteToTarget(input(), {}, detector, { ...config, targetRounds: 99 }, undefined, () => {}, batch.run);
  assert.equal(result.ai.score, .32); assert.equal(result.target.met, false);
  assert.equal(result.target.roundsUsed, 3); assert.equal(batch.calls.length, 3);
});
test('20 percent exactly does not satisfy a strictly below-20 goal', async () => {
  const result = await rewriteToTarget(input(), {}, scorer([.98, .2]), { ...config, targetRounds: 1 }, undefined, () => {}, batches([[passage('One')]]).run);
  assert.equal(result.target.met, false); assert.equal(result.ai.score, .2);
});
test('already-low original does not need generation and is explicitly identified', async () => {
  const result = await rewriteToTarget(input(), {}, scorer([.15]), config, undefined, () => {}, () => { throw new Error('Must not generate'); });
  assert.equal(result.kind, 'original'); assert.equal(result.target.status, 'already_met');
  assert.equal(result.target.roundsUsed, 0); assert.equal(result.attempts, 0);
});
test('shortening below the classifier minimum cannot earn a target success', async () => {
  const detector = scorer([.98]);
  const batch = batches([['A short rewrite.']]);
  const result = await rewriteToTarget(input(), {}, detector, { ...config, targetRounds: 1 }, undefined, () => {}, batch.run);
  assert.equal(detector.calls.length, 1); assert.equal(result.target.met, false);
  assert.equal(result.target.rounds[0].rejected[0].code, 'DETECTOR_TOO_SHORT');
});
test('duplicate later candidates are not rescored or counted as new measured versions', async () => {
  const detector = scorer([.98, .4]);
  const result = await rewriteToTarget(input(), {}, detector, config, undefined, () => {}, batches([[passage('One')]]).run);
  assert.equal(detector.calls.length, 2); assert.equal(result.alternatives.length, 2);
  assert.equal(result.target.rounds[1].rejected[0].code, 'DUPLICATE');
});
test('review failures stay out of scoring and can lead to an explicit original-only result', async () => {
  const detector = scorer([.98]);
  const batch = batches([new AppError(422, 'MEANING_REVIEW_FAILED', 'Meaning changed.')]);
  const result = await rewriteToTarget(input(), {}, detector, config, undefined, () => {}, batch.run);
  assert.equal(detector.calls.length, 1); assert.equal(result.target.met, false);
  assert.equal(result.failedRounds, 3); assert.equal(result.kind, 'original');
});
test('detector failure is surfaced; a previous measured success is not fabricated', async () => {
  const detector = scorer([.98, new AppError(503, 'DETECTOR_UNAVAILABLE', 'Unavailable')]);
  await assert.rejects(rewriteToTarget(input(), {}, detector, config, undefined, () => {}, batches([[passage('One')]]).run), { code: 'DETECTOR_UNAVAILABLE' });
});
test('partial, fallback and other-revision measurements fail closed', () => {
  for (const overrides of [{ status: 'partial' }, { fallback: true }, { revision: 'other' }, { model: 'heuristic' }, { score: null }, { score: NaN }, { score: 1.1 }, { checkedTokens: 99 }, { dtype: 'fp32' }, { strideTokens: 448 }, { transformersVersion: '4.0.0' }]) assert.throws(() => validateMeasurement(measurement(.19, overrides)), { code: 'DETECTOR_INVALID' });
});
test('cancellation after scoring prevents all further generation', async () => {
  const controller = new AbortController();
  const detector = { async score() { controller.abort(); return measurement(.98); } };
  await assert.rejects(rewriteToTarget(input(), {}, detector, config, controller.signal, () => {}, () => { throw new Error('Must not generate'); }), { code: 'CANCELLED' });
});
test('classifier windows and weighting match saved Veritas, excluding double-counted overlap', async () => {
  const calls = [], decode = [];
  const classifier = async (fragment, options) => { calls.push({ fragment, options }); return [{ label: 'human', score: .1 }, { label: 'AI', score: calls.length === 1 ? .9 : .1 }]; };
  classifier.tokenizer = { encode: (_, options) => { assert.equal(options.add_special_tokens, false); return Array.from({ length: 600 }, (_, i) => i); }, decode: (ids, options) => { decode.push({ ids, options }); return `fragment ${ids[0]}`; } };
  const result = await scoreWithClassifier(source, classifier);
  assert.equal(decode[0].ids.length, 448); assert.equal(decode[1].ids[0], 384);
  assert.equal(decode[1].ids.length, 216); assert.equal(calls[0].options.top_k, 2);
  assert.equal(result.score, (.9 * 448 + .1 * 152) / 600);
  assert.equal(result.checkedTokens, 600); assert.equal(result.totalTokens, 600);
  assert.equal(result.revision, DETECTOR_METHOD.revision);
});
test('missing AI labels do not convert to a convenient low score', () => {
  assert.throws(() => aiProbability([{ label: 'LABEL_1', score: .9 }]), { code: 'DETECTOR_INVALID' });
  assert.equal(summaryScore([]), null);
});
test('changing selected candidate recomputes target status instead of reusing best-candidate status', () => {
  const state = selectedTargetState({ target: { enabled: true, requestedPercent: 20, before: measurement(.98), met: true }, ai: measurement(.45), kind: 'rewrite' });
  assert.equal(state.met, false); assert.match(state.message, /not reached/);
  assert.equal(formatSignal(.1999999, 20), '<20%');
  assert.equal(formatSignal(.2, 20), '20.00%'); assert.equal(formatSignal(null), 'Not measured');
});

function fakeProcess() {
  const child = new EventEmitter(); child.killed = false;
  child.send = (message, callback) => { child.message = message; callback?.(); child.emit('sent'); };
  child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('exit', 0)); return true; };
  return child;
}
test('detector cancellation terminates inference and a later request gets a fresh process', async () => {
  const children = [];
  const detector = new VeritasDetector({ allowDownload: true, processFactory: () => { const child = fakeProcess(); children.push(child); return child; } });
  const controller = new AbortController();
  const pending = detector.score(source, controller.signal); controller.abort();
  await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(children[0].killed, true);
  const next = detector.score(source);
  children[1].emit('message', { id: children[1].message.id, type: 'result', result: measurement(.4) });
  assert.equal((await next).score, .4); await detector.close();
});
test('detector timeout terminates the subprocess and fails without a score', async () => {
  const child = fakeProcess();
  const detector = new VeritasDetector({ allowDownload: true, timeoutMs: 5, processFactory: () => child });
  await assert.rejects(detector.score(source), { code: 'DETECTOR_TIMEOUT' });
  assert.equal(child.killed, true);
});
test('runtime scoring explicitly forbids downloading and transmits no score target to the classifier', async () => {
  const child = fakeProcess();
  const detector = new VeritasDetector({ processFactory: () => child });
  detector.status = async () => ({ installed: true });
  const sent = new Promise(resolve => child.once('sent', resolve));
  const pending = detector.score(source); await sent;
  assert.equal(child.message.config.allowDownload, false); assert.equal(child.message.targetPercent, undefined);
  child.emit('message', { id: child.message.id, type: 'result', result: measurement(.7) });
  await pending; await detector.close();
});
