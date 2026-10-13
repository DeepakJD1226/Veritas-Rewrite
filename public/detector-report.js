// Read exported Veritas Scanner reports. This module never calls a detector.
function canonical(text) { return text.normalize('NFC').replace(/\r\n?/g, '\n').trim(); }

export function readDetectorReport(report, expectedText) {
  if (!report || typeof report !== 'object' || typeof report.text !== 'string' || !report.ai || typeof report.ai !== 'object') throw new Error('Choose a Veritas Scanner Export report JSON file containing its text and AI analysis.');
  if (canonical(report.text) !== canonical(expectedText)) throw new Error('This report is for a different passage. Analyse the exact original or selected rewrite and export that report.');
  const ai = report.ai;
  if (ai.status !== 'complete') throw new Error('This detector check is incomplete. Wait for the full analysis and export again.');
  if (typeof ai.score !== 'number' || !Number.isFinite(ai.score) || ai.score < 0 || ai.score > 1) throw new Error('The report has no valid AI-class score.');
  if (typeof ai.model !== 'string' || !ai.model || typeof ai.revision !== 'string' || !ai.revision) throw new Error('The report is missing its detector model or revision.');
  if (!Number.isFinite(ai.checkedTokens) || !Number.isFinite(ai.totalTokens) || ai.totalTokens <= 0 || ai.checkedTokens < ai.totalTokens) throw new Error('The report does not confirm full text coverage.');
  return { score: ai.score, percent: Math.round(ai.score * 1000) / 10, model: ai.model, revision: ai.revision,
    fallback: /fallback/i.test(ai.model), checkedTokens: ai.checkedTokens, totalTokens: ai.totalTokens,
    date: typeof report.date === 'string' ? report.date : null,
    provenance: 'Imported from a user-supplied scanner export; not measured by Veritas Rewrite.' };
}

export function compareDetectorReports(before, after) {
  if (!before || !after) return { comparable: false, message: 'Import reports for both the original and selected rewrite to compare measured AI-class signals.' };
  if (before.model !== after.model || before.revision !== after.revision || before.fallback !== after.fallback) {
    return { comparable: false, message: 'These reports used different detector models, revisions, or full-model/fallback paths. Their scores are not a like-for-like comparison. Recheck both with the same method.' };
  }
  const delta = Math.round((after.score - before.score) * 1000) / 10;
  const direction = delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'unchanged';
  return { comparable: true, beforePercent: before.percent, afterPercent: after.percent, differencePercentagePoints: delta, direction,
    message: direction === 'unchanged' ? 'No measured change in the displayed AI-class signal.' : `AI-class signal ${direction} by ${Math.abs(delta).toFixed(1)} percentage points.`,
    note: `${before.fallback ? 'Both results are heuristic fallback estimates. ' : ''}This measures this detector only. Small differences are not evidence of better writing, and neither score measures the percentage of AI-written words.` };
}
