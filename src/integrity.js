import { MAX_WORDS, MAX_CHARS, wordCount, wordingChange, phraseOverlap } from '../public/text.js';

function matches(text, regex) { return [...text.matchAll(regex)].map(match => match[0]); }
function counts(items) {
  const map = new Map();
  for (const item of items) map.set(item, (map.get(item) || 0) + 1);
  return map;
}
function sameItems(a, b) {
  const left = counts(a), right = counts(b);
  return left.size === right.size && [...left].every(([value, n]) => right.get(value) === n);
}

export function anchors(text) {
  return {
    numbers: matches(text, /(?<![\p{L}\p{N}])[+−-]?\d+(?:[.,]\d+)*(?:\s?%|\s?°[CF])?/gu),
    citations: matches(text, /\[[^\]\n]{1,160}\]|\([^()\n]{0,140}\b(?:19|20)\d{2}[a-z]?[^()\n]{0,60}\)/gu),
    quotes: matches(text, /“[^”\n]+”|"[^"\n]+"|‘[^’\n]+’|(?<![\p{L}\p{N}])'[^'\n]+'(?![\p{L}\p{N}])/gu),
    links: matches(text, /https?:\/\/[^\s<>"\])]+/gu).map(x => x.replace(/[.,;!?]+$/g, ''))
  };
}

function occurrences(text, term) { return text.split(term).length - 1; }

export function inspectCandidate(input, output) {
  const issues = [];
  const a = anchors(input.text), b = anchors(output);
  const count = wordCount(output);
  if (!count) issues.push('Return a nonempty rewritten passage.');
  if (count > MAX_WORDS) issues.push(`The draft has ${count} words. Return at most 300 words, aiming below 285 without omitting substantive details.`);
  if (output.length > MAX_CHARS) issues.push('Return at most 12000 characters.');
  if (wordCount(input.text) >= 20 && count < Math.ceil(wordCount(input.text) * 0.6)) issues.push('Too much was removed. Preserve all substantive details; this is rewriting, not summarizing.');
  if (count > Math.min(MAX_WORDS, Math.ceil(wordCount(input.text) * 1.4 + 10))) issues.push('The rewrite expands too much. Stay close to the original length without adding claims.');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u.test(output)) issues.push('Remove hidden control characters.');
  for (const [key, label] of [['numbers', 'numerical values'], ['citations', 'citations'], ['quotes', 'direct quotes'], ['links', 'URLs']]) {
    if (!sameItems(a[key], b[key])) issues.push(`Preserve exactly the original ${label} and their occurrence counts. Do not add or remove any.`);
  }
  if (input.protectedTerms.some(term => occurrences(input.text, term) !== occurrences(output, term))) issues.push('Preserve each protected term exactly, with its original occurrence count.');
  if (/^(?:here(?:'s| is) (?:a|the|your) (?:revised|rewritten)|rewritten (?:text|version)\s*:|as an ai)/i.test(output)) issues.push('Return only the passage, without prefatory commentary.');
  return { issues, anchors: a, outputWords: count };
}

export function makeReport(input, output, inspection) {
  const warnings = ['Review meaning, names, units, and citation placement before using the rewrite. Exact-text checks cannot verify every factual relationship.'];
  const change = wordingChange(input.text, output);
  if (change < 10) warnings.push('The wording changed very little. Try a stronger revision level if you need a fuller rewrite.');
  const paragraphsBefore = input.text.split(/\n\s*\n/u).length;
  const paragraphsAfter = output.split(/\n\s*\n/u).length;
  if (paragraphsBefore !== paragraphsAfter) warnings.push('Paragraph structure changed. Check that the organization still fits your draft.');
  const reference = input.reference ? {
    before: phraseOverlap(input.text, input.reference),
    after: phraseOverlap(output, input.reference),
    description: 'Words in exact five-word sequences shared with the supplied excerpt. This is not a plagiarism or originality score.'
  } : null;
  if (reference?.before && reference?.after && reference.after.percent >= reference.before.percent && reference.before.percent > 0) {
    warnings.push('Phrase overlap with your excerpt did not decrease. Review the wording and keep the source citation.');
  }
  return {
    inputWords: wordCount(input.text), outputWords: inspection.outputWords, maxWords: MAX_WORDS,
    wordingChangedPercent: change,
    preserved: {
      numbers: inspection.anchors.numbers.length, citations: inspection.anchors.citations.length,
      quotes: inspection.anchors.quotes.length, links: inspection.anchors.links.length,
      terms: input.protectedTerms.length
    },
    reference, warnings
  };
}
