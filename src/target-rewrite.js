import { rewrite } from './rewrite.js';
import { inspectCandidate, makeReport } from './integrity.js';
import { writingProfile } from './editor.js';
import { active, assertDetectorEligible, validateMeasurement, DETECTOR_METHOD } from './detector-core.js';
import { AppError } from './errors.js';

// All successful scores are model outputs. Target affects search, never scoring.
export async function rewriteToTarget(input, client, detector, config, signal, progress = () => {}, runRound = rewrite) {
  if (!Number.isInteger(input.targetPercent) || input.targetPercent < 5 || input.targetPercent > 80) throw new AppError(400, 'INVALID_TARGET', 'Choose a target from 5 to 80 percent.');
  assertDetectorEligible(input.text); active(signal);
  const maxRounds = Math.max(1, Math.min(3, config.targetRounds ?? 3));
  const rounds = [], alternatives = [], seen = new Set([input.text]);
  let detectorChecks = 0, attempts = 0, reviewedCandidates = 0, generatedCandidates = 0, rejectedCandidates = 0;
  const measure = async (text, message) => {
    active(signal); progress({ stage: 'scoring', message });
    const ai = validateMeasurement(await detector.score(text, signal, detail => progress({ stage: 'scoring', message: `${message} ${detail}` })));
    active(signal); detectorChecks++; return ai;
  };
  const baseline = await measure(input.text, 'Measuring the original with the Veritas classifier…');
  const originalReport = makeReport(input, input.text, inspectCandidate(input, input.text));
  originalReport.warnings = ['This is your unchanged original, retained because a rewrite did not improve the measured score or the target was already met. It has not received a model meaning review.'];
  originalReport.editing = null;
  let best = { id: 'original', kind: 'original', label: 'Original (unchanged)', text: input.text, report: originalReport, ai: baseline };
  alternatives.push(best);
  let feedback = null;
  if (baseline.score >= input.targetPercent / 100) {
    for (let round = 1; round <= maxRounds; round++) {
      active(signal);
      progress({ stage: 'generating', round, maxRounds, message: `Round ${round} of ${maxRounds}: creating and reviewing alternatives…` });
      const record = { round, candidates: [], rejected: [], bestScore: best.ai.score };
      rounds.push(record);
      let batch;
      try {
        // Every round rewrites and reviews against the original, not an accumulating paraphrase.
        batch = await runRound({ ...input, targetFeedback: feedback, roundOffset: (round - 1) * 2 }, client, config, signal, detail => progress({ ...detail, round, maxRounds }));
      } catch (error) {
        active(signal);
        if (!['REWRITE_CHECK_FAILED', 'MEANING_REVIEW_FAILED'].includes(error.code)) throw error;
        record.rejected.push({ code: error.code, message: error.message });
        // A failed batch consumed up to its full budget. Record separately, not as fabricated exact counts.
        record.failedBatch = true;
        feedback = { previousRoundIssues: error.details?.checks || [error.message], direction: 'Produce a new version that preserves all original meaning and protected text.' };
        continue;
      }
      attempts += batch.attempts; generatedCandidates += batch.generatedCandidates; reviewedCandidates += batch.reviewedCandidates; rejectedCandidates += batch.rejectedCandidates;
      for (const candidate of batch.alternatives) {
        active(signal);
        if (seen.has(candidate.text)) { record.rejected.push({ id: candidate.id, code: 'DUPLICATE', message: 'Already checked in an earlier round.' }); continue; }
        seen.add(candidate.text);
        try { assertDetectorEligible(candidate.text); }
        catch (error) { record.rejected.push({ id: candidate.id, code: error.code, message: 'This candidate cannot use the same full-model detector. It is not eligible for target selection.' }); continue; }
        const ai = await measure(candidate.text, `Round ${round}: measuring a reviewed rewrite…`);
        const scored = { ...candidate, kind: 'rewrite', id: `round-${round}-${candidate.id}`, label: `Round ${round} · ${candidate.label}`, ai };
        alternatives.push(scored);
        record.candidates.push({ id: scored.id, score: ai.score, words: scored.report.outputWords });
        if (ai.score < best.ai.score) best = scored; // Ties retain earlier best; worsening never replaces it.
      }
      record.bestScore = best.ai.score;
      progress({ stage: 'round_complete', round, maxRounds, message: `Round ${round} complete. Best measured signal: ${(best.ai.score * 100).toFixed(2)}%.` });
      if (best.ai.score < input.targetPercent / 100) break;
      feedback = {
        round, bestCandidateSoFar: best.text, measuredSignalPercent: best.ai.score * 100,
        desiredSignalBelowPercent: input.targetPercent, editingCues: writingProfile(best.text),
        direction: 'Try a distinct sentence structure and more direct, context-specific phrasing while preserving every original claim. Do not add facts, personal anecdotes or errors. The target may not be reachable.'
      };
    }
  }
  active(signal);
  alternatives.sort((a, b) => a.ai.score - b.ai.score);
  const met = best.ai.score < input.targetPercent / 100;
  const target = { enabled: true, requestedPercent: input.targetPercent, comparison: 'strictly_below', met,
    status: rounds.length === 0 ? 'already_met' : met ? 'met' : 'not_reached',
    before: baseline, after: best.ai, rounds, roundsUsed: rounds.length, maxRounds, detectorChecks,
    bestCandidateId: best.id, improvementPercentagePoints: (baseline.score - best.ai.score) * 100,
    method: DETECTOR_METHOD,
    note: 'A target is a search goal for this detector, not a promised authorship percentage. Scores are unmodified. Other detector versions and runtimes may disagree.' };
  return { ...best, selectedId: best.id, alternatives, target, model: config.model,
    tone: input.tone, strength: input.strength, quality: input.quality,
    attempts, generatedCandidates, reviewedCandidates, rejectedCandidates,
    failedRounds: rounds.filter(r => r.failedBatch).length,
    selection: 'Lowest measured Veritas AI-class score among reviewed eligible rewrites and the original. The original is kept when no rewrite improves its score.' };
}
