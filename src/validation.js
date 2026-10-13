import { MAX_WORDS, MAX_CHARS, normalizeText, wordCount } from '../public/text.js';
import { AppError } from './errors.js';
import { assertDetectorEligible } from './detector-core.js';

export const TONES = Object.freeze({
  natural: 'Use direct, natural English with varied sentence lengths. Avoid stock openings, inflated language, and forced slang. Use contractions only when they fit.',
  academic: 'Use clear formal academic English. Keep technical precision, hedging, citations and the original level of certainty. Avoid unnecessary jargon and do not invent sources.',
  simple: 'Use everyday English and shorter sentences. Explain the same ideas clearly without adding facts or losing technical meaning.'
});
export const STRENGTHS = Object.freeze({
  light: 'Make small editorial changes to phrasing and flow. Keep the original organization.',
  balanced: 'Rewrite awkward wording and vary sentence structure while retaining every substantive claim and paragraph role.',
  substantial: 'Use fresh phrasing and reorganize sentences within their paragraphs where useful. Do not summarize away substantive details or change the argument.'
});

function validatePassage(value, label, allowEmpty = false) {
  if (typeof value !== 'string') throw new AppError(400, 'INVALID_TEXT', `${label} must be plain text.`);
  if (value.length > MAX_CHARS) throw new AppError(413, 'TEXT_TOO_LONG', `${label} exceeds ${MAX_CHARS.toLocaleString('en')} characters.`);
  const text = normalizeText(value);
  const count = wordCount(text);
  if (!count && !(allowEmpty && !text)) throw new AppError(400, 'EMPTY_TEXT', `${label} must contain at least one word.`);
  if (count > MAX_WORDS) throw new AppError(422, 'WORD_LIMIT', `${label} has ${count} words. The maximum is 300. Please shorten it; nothing was sent to the model.`, { words: count, maxWords: MAX_WORDS });
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u.test(text)) {
    throw new AppError(400, 'INVISIBLE_CHARACTERS', `${label} contains hidden control characters. Paste plain text without these characters.`);
  }
  return text;
}

export function validateInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'INVALID_BODY', 'Send a JSON object.');
  const text = validatePassage(body.text, 'Your draft');
  const reference = validatePassage(body.reference ?? '', 'Reference excerpt', true);
  const voiceSample = validatePassage(body.voiceSample ?? '', 'Your writing sample', true);
  if (wordCount(voiceSample) > 120) throw new AppError(422, 'VOICE_LIMIT', 'Your writing sample must be 120 words or fewer. It is a style example, separate from the 300-word draft.');
  const quality = body.quality ?? 'deep';
  if (!['deep', 'quick'].includes(quality)) throw new AppError(400, 'INVALID_OPTIONS', 'Choose Deep rewrite or Quick edit.');
  const targetPercent = body.targetPercent ?? null;
  if (targetPercent !== null) {
    if (!Number.isInteger(targetPercent) || targetPercent < 5 || targetPercent > 80) throw new AppError(400, 'INVALID_TARGET', 'Choose a target between 5 and 80 percent, or turn target mode off.');
    assertDetectorEligible(text);
  }
  const tone = body.tone ?? 'natural', strength = body.strength ?? 'balanced';
  if (!Object.hasOwn(TONES, tone) || !Object.hasOwn(STRENGTHS, strength)) throw new AppError(400, 'INVALID_OPTIONS', 'Choose a listed tone and revision level.');
  if (body.protectedTerms !== undefined && !Array.isArray(body.protectedTerms)) throw new AppError(400, 'INVALID_TERMS', 'Protected terms must be an array of phrases.');
  const rawTerms = body.protectedTerms ?? [];
  if (rawTerms.length > 20 || rawTerms.some(x => typeof x !== 'string' || !x.trim() || x.length > 100 || /[\n\r\u0000]/u.test(x))) {
    throw new AppError(400, 'INVALID_TERMS', 'Use at most 20 protected terms, each 1–100 characters.');
  }
  const protectedTerms = [...new Set(rawTerms.map(x => x.trim()))];
  const missing = protectedTerms.filter(x => !text.includes(x));
  if (missing.length) throw new AppError(400, 'TERM_NOT_FOUND', 'Each protected term must appear exactly in your draft.', { terms: missing });
  return { text, reference, tone, strength, protectedTerms, voiceSample, quality, targetPercent };
}
