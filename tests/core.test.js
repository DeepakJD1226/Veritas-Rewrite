import test from 'node:test';
import assert from 'node:assert/strict';
import { wordCount, phraseOverlap, wordingChange, wordDiff } from '../public/text.js';
import { validateInput } from '../src/validation.js';
import { anchors, inspectCandidate, makeReport } from '../src/integrity.js';
import { rewrite, buildMessages } from '../src/rewrite.js';
import { readConfig } from '../src/config.js';

const config = { model: 'llama3.2:latest', maxAttempts: 2, candidateCount: 1 };
const draft = (text, rest = {}) => validateInput({ text, ...rest });
const repeats = n => Array(n).fill('word').join(' ');
function fakeModel(outputs) {
  const calls = [];
  return { calls, ensureLocal: async () => {}, generate: async messages => { calls.push(messages); return outputs.shift(); }, review: async messages => ({ reviews: JSON.parse(messages[1].content).candidates.map(c => ({ id: c.id, meaningPreserved: true, naturalness: 4, fluency: 4, issues: [] })) }) };
}

test('word definition handles contractions, hyphens, decimals and Unicode consistently', () => {
  assert.equal(wordCount("Don't re-write 12.5% café naïve."), 5);
  assert.equal(wordCount('word\nword\tword'), 3);
  assert.equal(wordCount('!! — 😀'), 0);
});
test('300 words pass; 301 words fail server-side with the actual count', () => {
  assert.equal(wordCount(draft(repeats(300)).text), 300);
  assert.throws(() => draft(repeats(301)), error => error.code === 'WORD_LIMIT' && error.details.words === 301);
});
test('empty, nonstring, huge and hidden-character drafts are rejected', () => {
  for (const text of ['', ' \n ', null, 52, ['hello'], '😀 !!']) assert.throws(() => draft(text));
  assert.throws(() => draft('a'.repeat(12001)), { code: 'TEXT_TOO_LONG' });
  assert.throws(() => draft('hello\u200bworld'), { code: 'INVISIBLE_CHARACTERS' });
});
test('reference also has a 300-word cap and is optional', () => {
  assert.equal(draft('Hello world').reference, '');
  assert.throws(() => draft('Hello world', { reference: repeats(301) }), { code: 'WORD_LIMIT' });
});
test('options cannot use object prototype keys', () => {
  for (const value of ['__proto__', 'constructor', 'toString', 'unknown']) {
    assert.throws(() => draft('Hello world', { tone: value }), { code: 'INVALID_OPTIONS' });
    assert.throws(() => draft('Hello world', { strength: value }), { code: 'INVALID_OPTIONS' });
  }
});
test('protected terms require exact draft presence, bounded size and array type', () => {
  assert.throws(() => draft('A CNN model', { protectedTerms: ['cnn'] }), { code: 'TERM_NOT_FOUND' });
  assert.throws(() => draft('A CNN model', { protectedTerms: 'CNN' }), { code: 'INVALID_TERMS' });
  assert.throws(() => draft('A CNN model', { protectedTerms: Array(21).fill('CNN') }), { code: 'INVALID_TERMS' });
  assert.deepEqual(draft('A CNN model', { protectedTerms: ['CNN', 'CNN'] }).protectedTerms, ['CNN']);
});
test('automatic anchor extraction includes negative numbers, citations, quotes and URLs', () => {
  const a = anchors('It fell by -4.5% in 2024 (Rao, 2024) [1]. “Keep this.” See https://example.org/report.');
  assert.deepEqual(a.numbers, ['-4.5%', '2024', '2024', '1']);
  assert.deepEqual(a.citations, ['(Rao, 2024)', '[1]']);
  assert.deepEqual(a.quotes, ['“Keep this.”']);
  assert.deepEqual(a.links, ['https://example.org/report']);
});
test('changed, invented, missing and duplicated numerical values fail', () => {
  const input = draft('The value was 20 and the sample had 20 cases.');
  for (const output of ['The value was 21 and the sample had 20 cases.', 'The value was 20.', 'The value was 20 and the sample had 20 cases in 2024.']) {
    assert.ok(inspectCandidate(input, output).issues.some(x => x.includes('numerical')));
  }
});
test('loss of quote, citation or protected term fails', () => {
  const input = draft('CNN says "Keep evidence" (Rao, 2024) [1].', { protectedTerms: ['CNN'] });
  const check = inspectCandidate(input, 'A model says "Change evidence" (Rao, 2024) [2].');
  for (const marker of ['citations', 'quotes', 'protected term']) assert.ok(check.issues.some(x => x.includes(marker)));
});
test('unchanged anchors pass when the surrounding wording changes', () => {
  const input = draft('The prototype had 50 samples and is described as "promising" [1].');
  assert.deepEqual(inspectCandidate(input, 'With 50 samples, the prototype is described as "promising" [1].').issues, []);
});
test('overlong, empty and excessively compressed generated text fails', () => {
  const input = draft(repeats(100));
  assert.ok(inspectCandidate(input, repeats(301)).issues.some(x => x.includes('300')));
  assert.ok(inspectCandidate(input, '').issues.length);
  assert.ok(inspectCandidate(input, 'Brief summary only.').issues.some(x => x.includes('removed')));
});
test('phrase overlap is literal five-word coverage and is undefined for short passages', () => {
  assert.equal(phraseOverlap('one two three four five six', 'one two three four five six').percent, 100);
  assert.equal(phraseOverlap('red blue black brown gray green', 'one two three four five six').percent, 0);
  assert.equal(phraseOverlap('one two', 'one two three four five'), null);
});
test('wording difference is not an authorship score', () => {
  assert.equal(wordingChange('Cats sleep well.', 'Cats sleep well.'), 0);
  assert.equal(wordingChange('Cats sleep well.', 'Dogs run fast.'), 100);
  const report = makeReport(draft('Cats sleep well.'), 'Dogs run fast.', inspectCandidate(draft('Cats sleep well.'), 'Dogs run fast.'));
  assert.equal(report.aiScore, undefined);
  assert.equal(report.plagiarism, undefined);
  assert.ok(report.warnings.some(x => x.includes('meaning')));
});
test('diff preserves output exactly, including whitespace and HTML-like content', () => {
  const output = 'New  words.\n<script>text</script>';
  assert.equal(wordDiff('Old words.', output).map(x => x.text).join(''), output);
});
test('source excerpt is never sent to the model', () => {
  const messages = buildMessages(draft('A normal sentence.', { reference: 'SECRET_REFERENCE_ONLY' }));
  assert.ok(!JSON.stringify(messages).includes('SECRET_REFERENCE_ONLY'));
});
test('retry fixes an over-limit candidate before returning a result', async () => {
  const client = fakeModel([{ text: repeats(301) }, { text: Array(280).fill('term').join(' ') }]);
  const result = await rewrite(draft(repeats(300)), client, config);
  assert.equal(result.report.outputWords, 280);
  assert.equal(result.attempts, 2);
  assert.ok(client.calls[1][1].content.includes('issuesToCorrect'));
});
test('two invalid candidates fail without silently returning the original or trimming', async () => {
  const client = fakeModel([{ text: repeats(301) }, { text: repeats(301) }]);
  await assert.rejects(rewrite(draft(repeats(300)), client, config), { code: 'REWRITE_CHECK_FAILED' });
  assert.equal(client.calls.length, 2);
});
test('truncated model outputs are retried', async () => {
  const client = fakeModel([{ invalid: 'Truncated.' }, { text: 'A clearer sentence.' }]);
  const result = await rewrite(draft('A readable sentence.'), client, config);
  assert.equal(result.attempts, 2);
});
test('an aborted request never starts generation', async () => {
  const controller = new AbortController(); controller.abort();
  const client = fakeModel([]);
  await assert.rejects(rewrite(draft('A readable sentence.'), client, config, controller.signal), { code: 'CANCELLED' });
  assert.equal(client.calls.length, 0);
});
test('configuration fixes loopback and rejects cloud names and unsafe ports', () => {
  assert.equal(readConfig({}).host, '127.0.0.1');
  assert.equal(readConfig({}).port, 8788);
  for (const model of ['model:cloud', 'https://remote.example/model', 'x;bad']) assert.throws(() => readConfig({ VERITAS_MODEL: model }));
  for (const port of ['-1', '65536', 'oops', '1234.5']) assert.throws(() => readConfig({ VERITAS_PORT: port }));
});
