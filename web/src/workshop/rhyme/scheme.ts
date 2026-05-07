import { lastWordInLine, normalizeWordToken } from "@/workshop/meter/tokenize";
import { vowelTailFromNormalized } from "./hints";

export type RhymeBreadth = "strict" | "near" | "broad";

function endingForBreadth(norm: string, breadth: RhymeBreadth): string | null {
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
 */
export function detectRhymeScheme(
  lines: string[],
  breadth: RhymeBreadth = "near",
): string[] {
  const labels: string[] = new Array(lines.length).fill("");
  const endingToLabel = new Map<string, string>();
  let nextCode = 0;

  const letterFor = (n: number): string => {
    const base = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (n < 26) return base[n]!;
    return base[Math.floor(n / 26) - 1]! + base[n % 26]!;
  };

  for (let i = 0; i < lines.length; i++) {
    const lw = lastWordInLine(lines[i]!);
    if (!lw) continue;
    const norm = normalizeWordToken(lw);
    const ending = endingForBreadth(norm, breadth);
    if (!ending) continue;
    if (!endingToLabel.has(ending)) endingToLabel.set(ending, letterFor(nextCode++));
    labels[i] = endingToLabel.get(ending)!;
  }

  return labels;
}
