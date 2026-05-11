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
 *
 * Lettering policy: auto-detected rhyme classes get labels A, B, C… in
 * line order. Classes produced by manual links (Fix-rhymes merges of two
 * distinct auto-classes) get a fresh letter allocated *after* all auto
 * letters, so the user can see at a glance which groups were added by
 * hand. Manual unlinks similarly hand off a fresh letter to the split-off
 * remnant.
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

  // === Pass 1: auto-only union-find (heuristic groupings, no manual ops). ===
  const autoCls: number[] = lines.map((_, i) => i);
  const findAuto = (i: number): number => {
    while (autoCls[i] !== i) {
      autoCls[i] = autoCls[autoCls[i]!]!;
      i = autoCls[i]!;
    }
    return i;
  };
  const unionAuto = (a: number, b: number) => {
    const ra = findAuto(a);
    const rb = findAuto(b);
    if (ra === rb) return;
    if (ra < rb) autoCls[rb] = ra; else autoCls[ra] = rb;
  };
  const endingToFirstLine = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const norm = endNorms[i];
    if (!norm) continue;
    const ending = endingForBreadth(norm, breadth);
    if (!ending) continue;
    const prev = endingToFirstLine.get(ending);
    if (prev === undefined) endingToFirstLine.set(ending, i);
    else unionAuto(prev, i);
  }

  // Auto-only label map (allocated in line order) — used as the source of
  // truth for classes the user hasn't touched.
  const autoLabelByRoot = new Map<number, string>();
  let autoCode = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!endNorms[i]) continue;
    const r = findAuto(i);
    if (!autoLabelByRoot.has(r)) autoLabelByRoot.set(r, letterFor(autoCode++));
  }

  // === Pass 2: full union-find (auto + manual links + manual unlinks). ===
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
  // Re-apply auto unions into the full union-find.
  for (let i = 0; i < lines.length; i++) {
    const r = findAuto(i);
    if (r !== i) unionCls(r, i);
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

  // Map each final class to the set of auto-classes it spans.
  // - size > 1  → manual link merged distinct auto-classes (fresh letter).
  // - size = 1, but the auto-class is split across multiple final classes
  //   → manual unlink (first-encountered keeps auto letter, rest fresh).
  const finalRootToAutoRoots = new Map<number, Set<number>>();
  const autoRootToFinalRoots = new Map<number, Set<number>>();
  for (let i = 0; i < lines.length; i++) {
    if (!endNorms[i]) continue;
    const fr = findCls(i);
    const ar = findAuto(i);
    if (!finalRootToAutoRoots.has(fr)) finalRootToAutoRoots.set(fr, new Set());
    finalRootToAutoRoots.get(fr)!.add(ar);
    if (!autoRootToFinalRoots.has(ar)) autoRootToFinalRoots.set(ar, new Set());
    autoRootToFinalRoots.get(ar)!.add(fr);
  }

  // Assign final letters in line order. Manual-influenced classes draw from
  // a fresh counter that starts past every auto label.
  const classToLetter = new Map<number, string>();
  const usedAutoLabels = new Set<string>();
  let nextManualCode = autoCode;
  for (let i = 0; i < lines.length; i++) {
    if (!endNorms[i]) continue;
    const fr = findCls(i);
    if (classToLetter.has(fr)) {
      labels[i] = classToLetter.get(fr)!;
      continue;
    }
    const autoRoots = finalRootToAutoRoots.get(fr)!;
    const isManualMerge = autoRoots.size > 1;

    let letter: string;
    if (isManualMerge) {
      letter = letterFor(nextManualCode++);
    } else {
      const ar = autoRoots.values().next().value!;
      const autoLbl = autoLabelByRoot.get(ar)!;
      // Auto-class was split (manual unlink): first remnant keeps its
      // original letter; later remnants get fresh letters.
      if (usedAutoLabels.has(autoLbl)) {
        letter = letterFor(nextManualCode++);
      } else {
        letter = autoLbl;
        usedAutoLabels.add(autoLbl);
      }
    }
    classToLetter.set(fr, letter);
    labels[i] = letter;
  }

  return labels;
}
