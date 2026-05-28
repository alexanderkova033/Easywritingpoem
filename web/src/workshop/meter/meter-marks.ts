import { stressPatternForWord, type ManualStressOverrides } from "./meter-hints";
import { wordSpansInLine } from "./tokenize";

/** Index of each vowel-group start within `raw` (ASCII a–z, y counts as vowel). */
export function vowelNucleiInWord(raw: string): number[] {
  const positions: number[] = [];
  let prevVowel = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    const lower = c >= 65 && c <= 90 ? c + 32 : c;
    const isLetter = lower >= 97 && lower <= 122;
    const isVowel =
      isLetter &&
      (lower === 97 || lower === 101 || lower === 105 || lower === 111 || lower === 117 || lower === 121);
    if (isVowel && !prevVowel) positions.push(i);
    prevVowel = isVowel;
  }
  return positions;
}

export interface MeterMark {
  col: number;
  stress: boolean;
}

/** Compute per-line meter marks anchored at vowel positions. */
export function meterMarksForLine(
  text: string,
  lexicon: ReadonlyMap<string, string> | null,
  overrides: ManualStressOverrides | null,
): MeterMark[] {
  const marks: MeterMark[] = [];
  const seen = new Set<number>();
  for (const span of wordSpansInLine(text)) {
    const pattern = stressPatternForWord(span.raw, lexicon, overrides);
    if (!pattern) continue;
    const nuclei = vowelNucleiInWord(span.raw);
    const positions: number[] = [];
    if (nuclei.length === pattern.length) {
      for (const off of nuclei) positions.push(span.start + off);
    } else {
      // Fallback: distribute marks across the word's range when our vowel-walk
      // disagrees with the lexicon's syllable count (e.g. silent 'e').
      const n = pattern.length;
      const width = Math.max(1, span.end - span.start);
      for (let i = 0; i < n; i++) {
        const frac = (i + 0.5) / n;
        positions.push(span.start + Math.min(width - 1, Math.floor(frac * width)));
      }
    }
    for (let i = 0; i < pattern.length; i++) {
      const col = positions[i]!;
      if (seen.has(col)) continue;
      seen.add(col);
      marks.push({ col, stress: pattern[i] === "/" });
    }
  }
  return marks;
}
