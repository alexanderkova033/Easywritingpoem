export type WordDiffOp =
  | { kind: "keep"; text: string }
  | { kind: "add"; text: string }
  | { kind: "remove"; text: string };

/**
 * Tokenize for word-level diff. Splits into runs of:
 *   - word chars including apostrophes:  [A-Za-z0-9_']+
 *   - newline (kept as standalone token, since line breaks matter for poetry)
 *   - other whitespace / punctuation runs
 *
 * Adjacent equal tokens compare cheaply; LCS picks longest common token sequence.
 */
function tokenize(s: string): string[] {
  const tokens: string[] = [];
  const re = /([A-Za-z0-9_']+|\n|[^\S\n]+|[^A-Za-z0-9_'\s])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) tokens.push(m[0]);
  return tokens;
}

/**
 * Word-level diff using LCS (same shape as diff-lines.ts but on word tokens).
 * Coalesces consecutive same-kind operations so decorations render as ranges
 * rather than per-token spans.
 *
 * Cost: O(n*m) time and space. Acceptable for poems (<= a few thousand tokens).
 */
export function diffWords(snapshot: string, current: string): WordDiffOp[] {
  const a = tokenize(snapshot);
  const b = tokenize(current);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j]
          ? 1 + dp[i + 1]![j + 1]!
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const raw: WordDiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ kind: "keep", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      raw.push({ kind: "remove", text: a[i]! });
      i++;
    } else {
      raw.push({ kind: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    raw.push({ kind: "remove", text: a[i]! });
    i++;
  }
  while (j < m) {
    raw.push({ kind: "add", text: b[j]! });
    j++;
  }

  // Coalesce consecutive ops of the same kind into single ranges.
  const out: WordDiffOp[] = [];
  for (const op of raw) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === op.kind) {
      prev.text += op.text;
    } else {
      out.push({ ...op });
    }
  }
  return out;
}
