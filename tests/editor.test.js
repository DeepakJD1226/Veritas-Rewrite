import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInput } from '../src/validation.js';
import { rewrite, buildMessages, buildReviewMessages } from '../src/rewrite.js';
import { assessRevision, writingProfile, distinctFrom } from '../src/editor.js';
import { readDetectorReport, compareDetectorReports } from '../public/detector-report.js';

const config = { model: 'test-local', maxAttempts: 4, candidateCount: 3 };
const source = 'The team maintains accurate records of all spare parts in the workshop. Staff update the records whenever parts arrive or are used for repairs.';
const versions = [
  'Staff keep the workshop inventory accurate by recording every spare part that arrives or goes into a repair. The team maintains these stock records.',
  'Accurate spare-parts records are maintained by the workshop team. Whenever parts arrive or staff use them for a repair, the records are updated.',
  'Every delivery and repair changes the workshop stock records. Staff record incoming and used spare parts to keep the team’s inventory information accurate.'
];
const good = c => ({ id: c.id, meaningPreserved: true, naturalness: 4, fluency: 4, issues: [] });
function model(outputs = versions, review = candidates => candidates.map(good)) {
  let index = 0;
  return { ensureLocal: async () => {}, generate: async () => ({ text: outputs[index++] ?? outputs.at(-1) }), review: async messages => ({ reviews: review(JSON.parse(messages[1].content).candidates) }) };
}
const input = options => validateInput({ text: source, ...options });
function detector(text, score, fields = {}) { return { text, date: '2026-10-11', ai: { status: 'complete', score, model: 'tmr-ai', revision: 'abc', checkedTokens: 150, totalTokens: 150, ...fields } }; }

test('version two rejects a near-identical rewrite that version one accepted', () => {
  const data = input();
  assert.ok(assessRevision(data, source).issues.length);
  assert.ok(assessRevision(data, source.replace('maintains', 'keeps')).issues.length);
});
test('protected quotations do not dilute editable-word revision checks', () => {
  const quote = '"' + Array(100).fill('evidence').join(' ') + '"';
  const data = validateInput({ text: quote + ' The group uses digital records to find the stock details quickly.' });
  const assessment = assessRevision(data, quote + ' Digital records help the group quickly locate stock information.');
  assert.ok(assessment.editableWords < 20);
  assert.equal(assessment.issues.length, 0);
});
test('style cues describe text without returning a fabricated AI percentage', () => {
  const profile = writingProfile('Furthermore, the utilization of tools is useful. Moreover, it is important to note the result.');
  assert.ok(profile.stockPhrases.includes('utilization'));
  assert.equal(profile.aiScore, undefined);
  assert.equal(profile.sentences, 2);
});
test('equivalent candidates are deduplicated without maximizing changes', () => {
  assert.equal(distinctFrom([{ text: versions[0] }], versions[0].toUpperCase()), false);
  assert.equal(distinctFrom([{ text: versions[0] }], versions[1]), true);
});
test('deep rewrite compares candidates and can select a later better-rated candidate', async () => {
  const client = model(versions, candidates => candidates.map((c, i) => ({ ...good(c), naturalness: i === 1 ? 5 : 3 })));
  const result = await rewrite(input(), client, config);
  assert.equal(result.alternatives.length, 3);
  assert.equal(result.selectedId, 'candidate-2');
  assert.equal(result.text, versions[1]);
  assert.equal(result.reviewedCandidates, 3);
  assert.ok(result.report.warnings.some(x => x.includes('same local model')));
});
test('critic-detected negation or causality errors exclude the candidate', async () => {
  const client = model(versions, candidates => candidates.map((c, i) => i === 0 ? { ...good(c), meaningPreserved: false, issues: ['Changed a factual relationship.'] } : good(c)));
  const result = await rewrite(input(), client, config);
  assert.equal(result.alternatives.length, 2);
  assert.ok(result.alternatives.every(c => c.text !== versions[0]));
});
test('every rejected meaning review fails without presenting unreviewed text', async () => {
  const client = model(versions, candidates => candidates.map(c => ({ ...good(c), meaningPreserved: false, issues: ['Omitted a condition.'] })));
  await assert.rejects(rewrite(input(), client, config), { code: 'MEANING_REVIEW_FAILED' });
});
test('incomplete, duplicated and invalid reviewer fields fail closed', async () => {
  for (const review of [c => c.slice(0, 1).map(good), c => c.map(() => good(c[0])), c => c.map(x => ({ ...good(x), meaningPreserved: 'yes' })), c => c.map(x => ({ ...good(x), naturalness: 9 }))]) {
    await assert.rejects(rewrite(input(), model(versions, review), config), { code: 'REVIEW_UNAVAILABLE' });
  }
});
test('quick edit still requires a local meaning review', async () => {
  let reviewed = false;
  const client = model([versions[0]], c => { reviewed = true; return c.map(good); });
  const result = await rewrite(input({ quality: 'quick' }), client, config);
  assert.equal(result.attempts, 1); assert.equal(result.alternatives.length, 1); assert.ok(reviewed);
});
test('unchanged output can be repaired within the bounded candidate budget', async () => {
  const result = await rewrite(input(), model([source, ...versions]), config);
  assert.equal(result.attempts, 4);
  assert.equal(result.alternatives.length, 3);
  assert.equal(result.rejectedCandidates, 1);
});
test('writing sample has an independent 120-word cap and does not expand the draft limit', () => {
  assert.throws(() => input({ voiceSample: Array(121).fill('word').join(' ') }), { code: 'VOICE_LIMIT' });
  assert.throws(() => validateInput({ text: Array(301).fill('word').join(' '), voiceSample: 'My writing sample.' }), { code: 'WORD_LIMIT' });
  assert.throws(() => input({ quality: 'unlimited' }), { code: 'INVALID_OPTIONS' });
});
test('voice is supplied as data to generation and review, and the reference stays out', () => {
  const data = input({ voiceSample: 'I write plainly.', reference: 'PRIVATE_REFERENCE_EXCERPT' });
  for (const messages of [buildMessages(data), buildReviewMessages(data, [{ id: 'a', text: 'A rewrite.' }])]) {
    assert.equal(JSON.parse(messages[1].content).writingSampleForStyleOnly, 'I write plainly.');
    assert.ok(!JSON.stringify(messages).includes('PRIVATE_REFERENCE_EXCERPT'));
  }
});
test('98 to 98.1 is honestly reported as a 0.1 percentage point increase', () => {
  const before = readDetectorReport(detector(source, .98), source);
  const after = readDetectorReport(detector(versions[0], .981), versions[0]);
  const result = compareDetectorReports(before, after);
  assert.equal(result.direction, 'increased'); assert.equal(result.differencePercentagePoints, .1);
  assert.match(result.message, /increased/);
});
test('detector reports must be complete and match the exact target passage', () => {
  assert.throws(() => readDetectorReport(detector('Other text', .4), source), /different passage/);
  assert.throws(() => readDetectorReport(detector(source, .4, { status: 'partial' }), source), /incomplete/);
  assert.throws(() => readDetectorReport(detector(source, .4, { checkedTokens: 30 }), source), /coverage/);
  assert.throws(() => readDetectorReport(detector(source, 98), source), /valid/);
  assert.throws(() => readDetectorReport(detector(source, .4, { revision: '' }), source), /revision/);
});
test('falling back to a different detector cannot be counted as improvement', () => {
  const a = readDetectorReport(detector(source, .98), source);
  const b = readDetectorReport(detector(versions[0], .3, { model: 'Veritas local stylometric fallback', revision: '1.1' }), versions[0]);
  assert.equal(compareDetectorReports(a, b).comparable, false);
});
test('different model revisions cannot be compared as the same benchmark', () => {
  const a = readDetectorReport(detector(source, .98), source);
  const b = readDetectorReport(detector(versions[0], .3, { revision: 'new' }), versions[0]);
  assert.equal(compareDetectorReports(a, b).comparable, false);
});
test('missing detector reports never produce a fabricated lower score', () => {
  const comparison = compareDetectorReports(null, null);
  assert.equal(comparison.comparable, false);
  assert.equal(comparison.afterPercent, undefined);
});
