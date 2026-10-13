// UI-only presentation. The backend owns all measurements and comparisons.
export function scannerWordCount(text) { return (text.match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu) || []).length; }
export function formatSignal(score, target) {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) return 'Not measured';
  const percent = score * 100, rounded = Number(percent.toFixed(2));
  if (target !== undefined && percent < target && rounded >= target) return `<${target}%`;
  return `${percent.toFixed(2)}%`;
}
export function selectedTargetState(result) {
  if (!result?.target?.enabled || !result.ai) return null;
  const target = result.target.requestedPercent, met = result.ai.score < target / 100;
  return { met, target, before: result.target.before.score, after: result.ai.score,
    message: result.kind === 'original' && result.target.status === 'already_met' ? 'Your original already meets this target.' : met ? 'Selected version meets the measured target.' : 'Target not reached for the selected version.',
    change: (result.target.before.score - result.ai.score) * 100 };
}
