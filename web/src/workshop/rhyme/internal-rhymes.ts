import { wordSpansInLine, normalizeWordToken } from "@/workshop/meter/tokenize";
import { endingForBreadth, type RhymeBreadth } from "@/workshop/rhyme/scheme";

export interface InternalRhymeMark {
  /** 1-based line number. */
  line: number;
  /** Word-character ranges within the line that participate in an internal rhyme. */
  ranges: Array<{ start: number; end: number }>;
}

const STOPWORDS = new Set([
  "a","an","the","and","or","but","of","to","in","on","at","by","for","with",
  "is","it","be","as","i","my","me","we","us","our","you","your","he","she","they","them",
  "this","that","these","those","so","do","did","done","not","no","yes","if",
]);

/**
 * Detects internal rhyme: two or more words within the same line whose endings
 * (per breadth) match. The poem's last word is excluded — it's already covered
 * by the end-rhyme pass.
 */
export function detectInternalRhymes(
  lines: string[],
  breadth: RhymeBreadth = "near",
): InternalRhymeMark[] {
  const out: InternalRhymeMark[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    const spans = wordSpansInLine(line);
    if (spans.length < 2) continue;

    const byKey = new Map<string, Array<{ start: number; end: number }>>();
    for (const sp of spans) {
      const norm = normalizeWordToken(sp.raw);
      if (norm.length < 3) continue;
      if (STOPWORDS.has(norm)) continue;
      const key = endingForBreadth(norm, breadth);
      if (!key) continue;
      const arr = byKey.get(key) ?? [];
      arr.push({ start: sp.start, end: sp.end });
      byKey.set(key, arr);
    }

    const ranges: Array<{ start: number; end: number }> = [];
    const lastSpan = spans[spans.length - 1]!;
    for (const arr of byKey.values()) {
      if (arr.length < 2) continue;
      // Drop matches that *only* exist because the line-end word collides with
      // a single mid-line word — those overlap with the end-rhyme decoration.
      const midOnly = arr.filter((r) => r.start !== lastSpan.start);
      if (midOnly.length === 0) continue;
      for (const r of arr) ranges.push(r);
    }

    if (ranges.length >= 2) {
      ranges.sort((a, b) => a.start - b.start);
      out.push({ line: i + 1, ranges });
    }
  }
  return out;
}
