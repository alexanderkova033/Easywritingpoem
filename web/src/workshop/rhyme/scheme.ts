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

  const letterFor = (n: number): string => {
    const base = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (n < 26) return base[n]!;
    return base[Math.floor(n / 26) - 1]! + base[n % 26]!;
  };

  // Per-line normalized end-word.
  const endNorms: (string | null)[] = lines.map((line) => {
    const lw = lastWordInLine(line);
    if (!lw) return null;
    const norm = normalizeWordToken(lw);
    return norm || null;
  });

  // Group lines into rhyme-equivalence classes.
  // Class id = the line index of the canonical representative (smallest line idx).
  // Line i's class starts as i itself; lines with the same auto-detected ending
  // share the same class; manual links merge classes.
  const cls: number[] = lines.map((_, i) => i);
  const findCls = (i: number): number => {
    while (cls[i] !== i) {
      cls[i] = cls[cls[i]!]!; // path compression
      i = cls[i]!;
    }
    return i;
  };
  const unionCls = (a: number, b: number) => {
    const ra = findCls(a);
    const rb = findCls(b);
    if (ra === rb) return;
    if (ra < rb) cls[rb] = ra; else cls[ra] = rb;
  };

  // Auto-detection: lines sharing the same breadth-key are merged.
  const endingToFirstLine = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const norm = endNorms[i];
    if (!norm) continue;
    const ending = endingForBreadth(norm, breadth);
    if (!ending) continue;
    const prev = endingToFirstLine.get(ending);
    if (prev === undefined) endingToFirstLine.set(ending, i);
    else unionCls(prev, i);
  }

  // Manual links: any line with end-word `a` and any line with end-word `b`
  // get merged into the same class.
  for (const key of manualLinks) {
    const parts = key.split("+");
    if (parts.length !== 2) continue;
    const [a, b] = parts as [string, string];
    const aLines: number[] = [];
    const bLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const w = endNorms[i];
      if (!w) continue;
      if (w === a) aLines.push(i);
      else if (w === b) bLines.push(i);
    }
    if (aLines.length === 0 || bLines.length === 0) continue;
    const anchor = aLines[0]!;
    for (const i of aLines.slice(1)) unionCls(anchor, i);
    for (const i of bLines) unionCls(anchor, i);
  }

  // Manual unlinks: split class so lines with end-word `b` move to a new class.
  for (const key of manualUnlinks) {
    const parts = key.split("+");
    if (parts.length !== 2) continue;
    const [a, b] = parts as [string, string];
    const aLines: number[] = [];
    const bLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const w = endNorms[i];
      if (!w) continue;
      if (w === a) aLines.push(i);
      else if (w === b) bLines.push(i);
    }
    if (aLines.length === 0 || bLines.length === 0) continue;
    const aClasses = new Set(aLines.map((i) => findCls(i)));
    const conflict = bLines.some((i) => aClasses.has(findCls(i)));
    if (!conflict) continue;
    // Re-anchor every b-line to a fresh isolated class (its own index).
    const bAnchor = bLines[0]!;
    cls[bAnchor] = bAnchor;
    for (const i of bLines.slice(1)) {
      cls[i] = i;
      unionCls(bAnchor, i);
    }
  }

  // Assign letters by the order each class is first seen along the lines.
  const classToLetter = new Map<number, string>();
  let nextCode = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!endNorms[i]) continue;
    const root = findCls(i);
    if (!classToLetter.has(root)) classToLetter.set(root, letterFor(nextCode++));
    labels[i] = classToLetter.get(root)!;
  }

  return labels;
}
