import { lastWordInLine, normalizeWordToken } from "@/workshop/meter/tokenize";
import { vowelTailFromNormalized } from "./hints";

export type RhymeBreadth = "strict" | "near" | "broad";

export function endingForBreadth(norm: string, breadth: RhymeBreadth): string | null {
  if (norm.length < 2) return null;
  switch (breadth) {
    case "strict":
      return norm.slice(-Math.min(4, norm.length));
    case "near":
      return vowelTailFromNormalized(norm) ?? norm.slice(-Math.min(3, norm.length));
    case "broad":
      return norm.slice(-2);
  }
}

/**
 * Assigns end-rhyme scheme labels (A, B, C…) to each line.
 * Lines with no last word or blank lines get an empty string.
 *
 * `manualLinks` is a list of alphabetised `"wordA+wordB"` keys. End-words
 * appearing in a link pair are union-merged so they share a single label —
 * lets the user fix rhymes the heuristic misses (slant rhymes, near-rhymes
 * the lexicon doesn't catch).
 */
export function detectRhymeScheme(
  lines: string[],
  breadth: RhymeBreadth = "near",
  manualLinks: string[] = [],
  manualUnlinks: string[] = [],
): string[] {
  const labels: string[] = new Array(lines.length).fill("");
  const endingToLabel = new Map<string, string>();
  let nextCode = 0;

  const letterFor = (n: number): string => {
    const base = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (n < 26) return base[n]!;
    return base[Math.floor(n / 26) - 1]! + base[n % 26]!;
  };

  // Per-line normalized end-word (cached so the manual-link pass can reuse).
  const endNorms: (string | null)[] = lines.map((line) => {
    const lw = lastWordInLine(line);
    if (!lw) return null;
    const norm = normalizeWordToken(lw);
    return norm || null;
  });

  for (let i = 0; i < lines.length; i++) {
    const norm = endNorms[i];
    if (!norm) continue;
    const ending = endingForBreadth(norm, breadth);
    if (!ending) continue;
    if (!endingToLabel.has(ending)) endingToLabel.set(ending, letterFor(nextCode++));
    labels[i] = endingToLabel.get(ending)!;
  }

  if (manualLinks.length > 0) {
    // Union-find across labels using the manual link pairs (matched by end-word).
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== r && parent.has(r)) r = parent.get(r)!;
      parent.set(x, r);
      return r;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) return;
      // Keep the alphabetically earlier label as the representative so the
      // visible scheme stays stable as the user adds links.
      if (ra < rb) parent.set(rb, ra); else parent.set(ra, rb);
    };
    for (const lbl of new Set(labels.filter(Boolean))) parent.set(lbl, lbl);

    // Build word→labels map.
    const wordToLabels = new Map<string, Set<string>>();
    for (let i = 0; i < lines.length; i++) {
      const w = endNorms[i];
      if (!w || !labels[i]) continue;
      const set = wordToLabels.get(w) ?? new Set<string>();
      set.add(labels[i]!);
      wordToLabels.set(w, set);
    }

    // For each manual link pair, union all labels of one word with all labels of the other.
    for (const key of manualLinks) {
      const parts = key.split("+");
      if (parts.length !== 2) continue;
      const [a, b] = parts as [string, string];
      const aLabels = wordToLabels.get(a);
      const bLabels = wordToLabels.get(b);
      if (!aLabels || !bLabels) continue;
      for (const la of aLabels) for (const lb of bLabels) union(la, lb);
    }

    // Rewrite labels to representatives.
    for (let i = 0; i < labels.length; i++) {
      if (labels[i]) labels[i] = find(labels[i]!);
    }
  }

  // Apply manual unlink pairs: for each (a,b), if any line whose end-word
  // matches `a` shares a label with any line whose end-word matches `b`,
  // shift all `b` lines onto a fresh label so the cluster splits.
  if (manualUnlinks.length > 0) {
    const letterFor = (n: number): string => {
      const base = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      if (n < 26) return base[n]!;
      return base[Math.floor(n / 26) - 1]! + base[n % 26]!;
    };
    const usedLabels = new Set(labels.filter(Boolean));
    let nextFresh = nextCode;
    const freshLabel = () => {
      let label = letterFor(nextFresh++);
      while (usedLabels.has(label)) label = letterFor(nextFresh++);
      usedLabels.add(label);
      return label;
    };

    for (const key of manualUnlinks) {
      const parts = key.split("+");
      if (parts.length !== 2) continue;
      const [a, b] = parts as [string, string];
      const aLines: number[] = [];
      const bLines: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        const w = endNorms[i];
        if (!w || !labels[i]) continue;
        if (w === a) aLines.push(i);
        else if (w === b) bLines.push(i);
      }
      if (aLines.length === 0 || bLines.length === 0) continue;
      const aLabels = new Set(aLines.map((i) => labels[i]!));
      const conflict = bLines.some((i) => aLabels.has(labels[i]!));
      if (!conflict) continue;
      const newLabel = freshLabel();
      for (const i of bLines) labels[i] = newLabel;
    }
  }

  return labels;
}
