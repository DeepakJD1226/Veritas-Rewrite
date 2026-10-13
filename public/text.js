// Shared by browser and backend so their word limits cannot drift apart.
export const MAX_WORDS = 300;
export const MAX_CHARS = 12000;

export function normalizeText(value) {
  return value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
}

export function words(text) {
  // Contractions and hyphenated terms count as one; decimals count as one.
  return text.match(/[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*(?:[.,]\p{N}+)*%?/gu) || [];
}

export function wordCount(text) { return words(text).length; }

export function tokens(text) {
  return words(text.toLocaleLowerCase('en')).map(x => x.replace(/’/g, "'"));
}

export function phraseOverlap(text, reference, size = 5) {
  const target = tokens(text);
  const source = tokens(reference);
  if (target.length < size || source.length < size) return null;
  const phrases = new Set();
  for (let i = 0; i <= source.length - size; i++) phrases.add(source.slice(i, i + size).join(' '));
  const covered = new Set();
  for (let i = 0; i <= target.length - size; i++) {
    if (phrases.has(target.slice(i, i + size).join(' '))) {
      for (let j = i; j < i + size; j++) covered.add(j);
    }
  }
  return { percent: Math.round(covered.size / target.length * 100), matchedWords: covered.size, totalWords: target.length, phraseLength: size };
}

export function wordingChange(before, after) {
  const a = tokens(before), b = tokens(after);
  if (!a.length || !b.length) return 0;
  const dp = new Uint16Array(b.length + 1);
  for (const token of a) {
    let previous = 0;
    for (let j = 1; j <= b.length; j++) {
      const saved = dp[j];
      dp[j] = token === b[j - 1] ? previous + 1 : Math.max(dp[j], dp[j - 1]);
      previous = saved;
    }
  }
  return Math.round((1 - (2 * dp[b.length]) / (a.length + b.length)) * 100);
}

export function wordDiff(before, after) {
  // Mark inserted/replaced output words; this is an editorial diff, not an AI score.
  const a = before.match(/\S+/g) || [];
  const b = after.match(/\s+|\S+/g) || [];
  const indices = b.flatMap((v, i) => /\S/.test(v) ? [i] : []);
  const width = indices.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j < width; j++) {
      table[i * width + j] = a[i - 1] === b[indices[j - 1]]
        ? table[(i - 1) * width + j - 1] + 1
        : Math.max(table[(i - 1) * width + j], table[i * width + j - 1]);
    }
  }
  const unchanged = new Set();
  let i = a.length, j = indices.length;
  while (i && j) {
    if (a[i - 1] === b[indices[j - 1]]) { unchanged.add(indices[j - 1]); i--; j--; }
    else if (table[(i - 1) * width + j] >= table[i * width + j - 1]) i--;
    else j--;
  }
  return b.map((text, index) => ({ text, changed: /\S/.test(text) && !unchanged.has(index) }));
}
