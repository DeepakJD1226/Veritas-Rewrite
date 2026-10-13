import { wordCount, words, wordingChange, phraseOverlap } from '../public/text.js';
import { anchors } from './integrity.js';

// Editorial cues only. These are not an AI classifier or a calibrated score.
const PHRASES = ['in the current digital era', "in today's rapidly evolving", 'in the modern era', 'it is important to note', 'it is essential to', 'plays a crucial role', 'plays a pivotal role', 'a wide range of', 'in conclusion', 'in summary', 'furthermore', 'moreover', 'additionally', 'seamlessly', 'delve into', 'leverage', 'utilization', 'underscores the importance', 'transformative potential'];

export function writingProfile(text) {
  const sentences = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)].map(item => item.segment.trim()).filter(sentence => wordCount(sentence));
  const lengths = sentences.map(wordCount);
  const starters = new Map();
  for (const sentence of sentences) {
    const opening = words(sentence).slice(0, 2).join(' ').toLowerCase();
    if (opening) starters.set(opening, (starters.get(opening) || 0) + 1);
  }
  const lower = text.toLowerCase();
  return { words: wordCount(text), sentences: sentences.length, sentenceLengths: lengths,
    longSentences: lengths.filter(n => n > 30).length,
    repeatedOpenings: [...starters].filter(([, n]) => n > 1).map(([text, count]) => ({ text, count })),
    stockPhrases: PHRASES.filter(phrase => lower.includes(phrase)),
    note: 'Descriptive editing cues, not evidence of authorship. Technical and academic language may legitimately contain these patterns.' };
}

function editableText(input, text) {
  const protectedStrings = [...Object.values(anchors(input.text)).flat(), ...input.protectedTerms].sort((a, b) => b.length - a.length);
  for (const value of protectedStrings) text = text.split(value).join(' ');
  return text;
}

export function assessRevision(input, output) {
  const before = editableText(input, input.text), after = editableText(input, output);
  const editableWords = wordCount(before), changed = wordingChange(before, after);
  const minimum = editableWords < 20 ? { light: 0, balanced: 6, substantial: 8 }[input.strength] : { light: 4, balanced: 12, substantial: 20 }[input.strength];
  const issues = [];
  if (editableWords >= 8 && changed < minimum) issues.push(`Only ${changed}% of editable wording changed. Rebuild sentence phrasing and structure; this revision level requires at least ${minimum}% change. Preserve facts and protected text.`);
  if (editableWords >= 8 && words(before.toLowerCase()).join(' ') === words(after.toLowerCase()).join(' ')) issues.push('The editable wording is unchanged. Produce a substantive edit, not only punctuation or capital changes.');
  return { issues, editableWords, editableWordingChangedPercent: changed, minimumChangePercent: minimum };
}

export function candidateRank(input, candidate) {
  const profile = writingProfile(candidate.text);
  const overlap = input.reference ? phraseOverlap(candidate.text, input.reference) : null;
  return candidate.review.naturalness * 12 + candidate.review.fluency * 8
    - Math.min(12, profile.stockPhrases.length * 2) - Math.min(8, profile.repeatedOpenings.length * 2)
    - (overlap ? overlap.percent / 25 : 0);
}

export function distinctFrom(candidates, text) { return candidates.every(candidate => wordingChange(candidate.text, text) >= 10); }
