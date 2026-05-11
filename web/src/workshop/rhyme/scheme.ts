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
 * `manualLinks` is a list of alphabetised `"wordA+wordB"` keys. Manual links
 * create *dedicated* rhyme classes — the involved lines are detached from
 * whatever auto-class the heuristic put them in and grouped together.
 * Multiple links that share a line transitively form a single class
 * (so the user can build groups of 3+ rhyming words by adding pairs).
 *
 * Lettering policy: auto classes get A, B, C… in line order; manual
 * classes get fresh letters allocated *after* every auto letter, so the
 * user can see at a glance which groups they added by hand.
 *
 * `manualUnlinks` peel `b`-end-words off the auto-class that `a` lives in,
 * giving them a separate fresh letter.
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

  // === Auto-only union-find (heuristic groupings). ===
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

  // === Manual classes: each line touched by any manual link sits in a
  // dedicated class detached from its auto-class. Links that share a line
  // are chained into the same manual class via union-find on synthetic
  // anchor ids (kept separate from line indices to avoid colliding with
  // auto roots). ===
  const manualParent = new Map<number, number>();
  const manualLineToAnchor = new Map<number, number>();
  let nextAnchor = 1_000_000;
  const findManual = (a: number): number => {
    let cur = a;
    while ((manualParent.get(cur) ?? cur) !== cur) {
      const p = manualParent.get(cur)!;
      const pp = manualParent.get(p) ?? p;
      manualParent.set(cur, pp);
      cur = pp;
    }
    return cur;
  };
  const unionManual = (a: number, b: number) => {
    const ra = findManual(a);
    const rb = findManual(b);
    if (ra === rb) return;
    if (ra < rb) manualParent.set(rb, ra); else manualParent.set(ra, rb);
  };

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
    const involved = [...aLines, ...bLines];

    let anchor = -1;
    for (const i of involved) {
      const existing = manualLineToAnchor.get(i);
      if (existing !== undefined) { anchor = findManual(existing); break; }
    }
    if (anchor < 0) {
      anchor = nextAnchor++;
      manualParent.set(anchor, anchor);
    }
    for (const i of involved) {
      const existing = manualLineToAnchor.get(i);
      if (existing !== undefined) unionManual(existing, anchor);
      manualLineToAnchor.set(i, anchor);
    }
  }

  // Resolve each manual line to its final anchor root.
  const lineToManualRoot = new Map<number, number>();
  for (const [line, a] of manualLineToAnchor) {
    lineToManualRoot.set(line, findManual(a));
  }

  // Manual unlinks: lines with end-word `b` get peeled off `a`'s auto-class
  // into a fresh manual class (one per unlink key), unless they already
  // belong to a manual class.
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
    // Only act when at least one b-line shares an auto-class with an a-line.
    const aAutos = new Set(aLines.map((i) => findAuto(i)));
    const bToPeel = bLines.filter((i) => aAutos.has(findAuto(i)) && !lineToManualRoot.has(i));
    if (bToPeel.length === 0) continue;
    const anchor = nextAnchor++;
    manualParent.set(anchor, anchor);
    for (const i of bToPeel) lineToManualRoot.set(i, anchor);
  }

  // === Letter allocation. Auto labels come first, in line order, skipping
  // any line that's been claimed by a manual class. Manual labels come
  // next, also in line order — so the user can read the poem top-to-bottom
  // and see the same letter for the same rhyme group. ===
  const autoLabelByRoot = new Map<number, string>();
  let autoCode = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!endNorms[i]) continue;
    if (lineToManualRoot.has(i)) continue;
    const r = findAuto(i);
    if (!autoLabelByRoot.has(r)) autoLabelByRoot.set(r, letterFor(autoCode++));
  }

  const manualLabelByRoot = new Map<number, string>();
  let manualCode = autoCode;
  for (let i = 0; i < lines.length; i++) {
    if (!endNorms[i]) continue;
    const mr = lineToManualRoot.get(i);
    if (mr === undefined) continue;
    if (!manualLabelByRoot.has(mr)) manualLabelByRoot.set(mr, letterFor(manualCode++));
  }

  for (let i = 0; i < lines.length; i++) {
    if (!endNorms[i]) continue;
    const mr = lineToManualRoot.get(i);
    if (mr !== undefined) {
      labels[i] = manualLabelByRoot.get(mr)!;
      continue;
    }
    const r = findAuto(i);
    labels[i] = autoLabelByRoot.get(r) ?? "";
  }

  return labels;
}
