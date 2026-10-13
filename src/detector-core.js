// Scoring contract copied from Veritas Scanner 3.1.0 (ai.js, ai-types.js,
// input.js): same model, revision, q8, tokenizer, window and coverage weighting.
// Target mode deliberately has NO stylometric fallback.
import { AppError } from './errors.js';
import { scannerWordCount } from '../public/target-score.js';

export const AI_MODEL = 'onnx-community/tmr-ai-text-detector-ONNX';
export const AI_REVISION = 'b9aa251e5bcda7e429fcc936767d921435945b60';
export const TRANSFORMERS_VERSION = '3.8.1';
export const DETECTOR_METHOD = Object.freeze({ model: AI_MODEL, revision: AI_REVISION, dtype: 'q8', transformersVersion: TRANSFORMERS_VERSION, windowTokens: 448, strideTokens: 384 });
// This is intentionally the SCANNER's counting rule, distinct from the editor's.
export const detectorWordCount = scannerWordCount;
export function assertDetectorEligible(text) {
  if (detectorWordCount(text) < 100) throw new AppError(422, 'DETECTOR_TOO_SHORT', 'Target mode needs at least 100 words by the scanner’s count. Shorter drafts can use normal rewriting with target mode off. The draft maximum stays 300 words.');
  const letters = text.match(/\p{L}/gu) || [], latin = text.match(/\p{Script=Latin}/gu) || [];
  if (letters.length && latin.length / letters.length < .85) throw new AppError(422, 'DETECTOR_UNSUPPORTED', 'The Veritas detector is English-focused. Target mode cannot assess this passage reliably.');
}
export function active(signal) { if (signal?.aborted) throw new AppError(499, 'CANCELLED', 'The rewrite was cancelled.'); }
export function aiProbability(result) {
  const ai = (Array.isArray(result) ? result : []).find(v => v && String(v.label).toLowerCase() === 'ai');
  if (!ai || typeof ai.score !== 'number' || !Number.isFinite(ai.score) || ai.score < 0 || ai.score > 1) throw new AppError(502, 'DETECTOR_INVALID', 'The detector returned no valid AI-class score. No target verdict is available.');
  return ai.score;
}
export function summaryScore(chunks) {
  let sum = 0, total = 0, covered = 0;
  for (const c of chunks) {
    const added = Math.max(0, c.endToken - Math.max(covered, c.startToken));
    sum += c.score * added; total += added; covered = Math.max(covered, c.endToken);
  }
  return total ? sum / total : null;
}
export async function scoreWithClassifier(text, classifier, progress = () => {}, signal) {
  assertDetectorEligible(text); active(signal);
  const ids = classifier.tokenizer.encode(text, { add_special_tokens: false });
  if (!ids.length) throw new AppError(502, 'DETECTOR_INVALID', 'The detector produced no tokens.');
  const chunks = [];
  for (let start = 0; start < ids.length; start += 384) {
    active(signal);
    const end = Math.min(start + 448, ids.length);
    const fragment = classifier.tokenizer.decode(ids.slice(start, end), { skip_special_tokens: true, clean_up_tokenization_spaces: false });
    const output = await classifier(fragment, { top_k: 2 });
    active(signal);
    chunks.push({ startToken: start, endToken: end, score: aiProbability(output), text: fragment });
    progress({ checkedTokens: end, totalTokens: ids.length });
    if (end === ids.length) break;
  }
  return { ...DETECTOR_METHOD, status: 'complete', score: summaryScore(chunks), fallback: false,
    checkedTokens: ids.length, totalTokens: ids.length, chunks, runtime: 'Node.js / ONNX CPU',
    reason: 'Measured locally with the pinned Veritas classifier. This AI-class signal is not a percentage of AI-written words. CPU and browser WASM results can differ slightly.' };
}
export function validateMeasurement(result) {
  if (!result || result.status !== 'complete' || result.model !== AI_MODEL || result.revision !== AI_REVISION || result.dtype !== 'q8' || result.fallback !== false || result.transformersVersion !== TRANSFORMERS_VERSION || result.windowTokens !== 448 || result.strideTokens !== 384 || typeof result.score !== 'number' || !Number.isFinite(result.score) || result.score < 0 || result.score > 1 || !Number.isInteger(result.totalTokens) || result.totalTokens <= 0 || result.checkedTokens !== result.totalTokens) {
    throw new AppError(502, 'DETECTOR_INVALID', 'The pinned detector did not complete a comparable full-text check. No lower score or target success has been inferred.');
  }
  return result;
}
