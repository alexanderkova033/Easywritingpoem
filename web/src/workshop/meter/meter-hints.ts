import type { DocumentStats } from "@/workshop/analysis/line-stats";
import { countSyllablesInLine, countSyllablesInWord } from "./syllables";
import { wordsInLine } from "./tokenize";

const FUNCTION_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "as", "at", "by", "for",
  "from", "in", "into", "of", "on", "to", "with", "without", "so", "than",
  "then", "this", "that", "these", "those", "it", "its", "is", "are", "was",
  "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "done", "will", "would", "could", "should", "may", "might", "must", "can",
  "not", "no", "nor", "too", "very", "just", "only", "own", "same", "such",
  "there", "here", "when", "where", "while", "upon", "about", "above",
  "below", "again", "once", "also",
]);

export type LineStressSource = "lexicon" | "mixed" | "heuristic" | "manual";

export type ManualStressOverrides = Readonly<Record<string, string>>;

export interface LineMeterHint {
  lineNumber: number;
  syllables: number;
  /** One mark per estimated syllable: '/' stressed, 'x' unstressed. */
  stressPattern: string;
  /** Share of positions matching a weak-strong (iambic) alternation starting weak. */
  iambicFitPercent: number | null;
  /** How stress marks were derived for this line. */
  stressSource: LineStressSource;
}

function normalizeWordForLex(raw: string): string {
  return raw.replace(/^'+|'+$/g, "").toLowerCase();
}

/** Heuristic-only stress (no CMU). Exported for tests and fallback. */
export function stressPatternForWordHeuristic(raw: string): string {
  const w = normalizeWordForLex(raw);
  if (!w) return "";
  const n = countSyllablesInWord(raw);
  if (n <= 0) return "";
  if (n === 1) return FUNCTION_WORDS.has(w) ? "x" : "/";
  return "/" + "x".repeat(n - 1);
}

function stressPatternFromLexiconToken(
  raw: string,
  lexicon: ReadonlyMap<string, string> | null,
  overrides: ManualStressOverrides | null = null,
): { pattern: string; hit: boolean; manual: boolean } {
  const w = normalizeWordForLex(raw);
  if (!w) return { pattern: "", hit: false, manual: false };
  const override = overrides?.[w];
  if (override) return { pattern: override, hit: true, manual: true };
  const direct = lexicon?.get(w);
  if (direct) return { pattern: direct, hit: true, manual: false };
  if (w.includes("-")) {
    const parts = w.split("-").filter(Boolean);
    let acc = "";
    let any = false;
    let manualAny = false;
    for (const p of parts) {
      const pOverride = overrides?.[p];
      if (pOverride) { acc += pOverride; any = true; manualAny = true; continue; }
      const pat = lexicon?.get(p);
      if (pat) { acc += pat; any = true; }
      else acc += stressPatternForWordHeuristic(p);
    }
    return { pattern: acc, hit: any, manual: manualAny };
  }
  return { pattern: stressPatternForWordHeuristic(raw), hit: false, manual: false };
}

export function stressPatternForWord(
  raw: string,
  lexicon: ReadonlyMap<string, string> | null,
  overrides: ManualStressOverrides | null = null,
): string {
  return stressPatternFromLexiconToken(raw, lexicon, overrides).pattern;
}

export interface WordPatternSegment {
  /** Raw word as it appears in the line (including punctuation/case). */
  word: string;
  /** Lowercased, stripped form used as override key. */
  normalized: string;
  /** Per-syllable pattern (combination of '/' and 'x'). */
  pattern: string;
  /** Inclusive start position of this word's pattern in the line-level stressPattern. */
  start: number;
  /** Exclusive end position of this word's pattern in the line-level stressPattern. */
  end: number;
  /** True when stress came from a manual override. */
  manual: boolean;
}

/** Walk one line and return per-word stress segments aligned to the concatenated line pattern. */
export function wordPatternsForLine(
  text: string,
  lexicon: ReadonlyMap<string, string> | null,
  overrides: ManualStressOverrides | null = null,
): WordPatternSegment[] {
  const words = wordsInLine(text);
  const out: WordPatternSegment[] = [];
  let cursor = 0;
  for (const w of words) {
    const { pattern, manual } = stressPatternFromLexiconToken(w, lexicon, overrides);
    const normalized = normalizeWordForLex(w);
    const start = cursor;
    cursor += pattern.length;
    out.push({ word: w, normalized, pattern, start, end: cursor, manual });
  }
  return out;
}

export function iambicFitPercentForPattern(pattern: string): number | null {
  if (!pattern) return null;
  let matched = 0;
  for (let i = 0; i < pattern.length; i++) {
    const expect = i % 2 === 0 ? "x" : "/";
    if (pattern[i] === expect) matched++;
  }
  return Math.round((100 * matched) / pattern.length);
}

function classifyLineStressSource(hits: number, total: number, manualHits: number): LineStressSource {
  if (total <= 0) return "heuristic";
  if (manualHits > 0) return "manual";
  if (hits === total) return "lexicon";
  if (hits > 0) return "mixed";
  return "heuristic";
}

export function meterHintsForBody(
  body: string,
  lexicon: ReadonlyMap<string, string> | null,
  overrides: ManualStressOverrides | null = null,
): LineMeterHint[] {
  const rawLines = body.split("\n");
  const out: LineMeterHint[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i]!;
    const words = wordsInLine(text);
    let stressPattern = "";
    let lexHits = 0;
    let lexTotal = 0;
    let manualHits = 0;
    for (const w of words) {
      const { pattern, hit, manual } = stressPatternFromLexiconToken(w, lexicon, overrides);
      stressPattern += pattern;
      if (normalizeWordForLex(w)) {
        lexTotal++;
        if (hit) lexHits++;
        if (manual) manualHits++;
      }
    }
    const syllables = countSyllablesInLine(text);
    const iambicFitPercent = iambicFitPercentForPattern(stressPattern);
    const stressSource = classifyLineStressSource(lexHits, lexTotal, manualHits);
    out.push({ lineNumber: i + 1, syllables, stressPattern, iambicFitPercent, stressSource });
  }
  return out;
}

export interface MeterCoverageSummary {
  nonEmptyLines: number;
  lexiconLines: number;
  mixedLines: number;
  heuristicLines: number;
}

export function summarizeMeterCoverage(
  hints: LineMeterHint[],
  docStats: Pick<DocumentStats, "lines">,
): MeterCoverageSummary {
  let nonEmptyLines = 0, lexiconLines = 0, mixedLines = 0, heuristicLines = 0;
  const n = Math.min(hints.length, docStats.lines.length);
  for (let i = 0; i < n; i++) {
    const text = docStats.lines[i]!.text;
    if (text.trim() === "") continue;
    nonEmptyLines++;
    const src = hints[i]!.stressSource;
    if (src === "lexicon" || src === "manual") lexiconLines++;
    else if (src === "mixed") mixedLines++;
    else heuristicLines++;
  }
  return { nonEmptyLines, lexiconLines, mixedLines, heuristicLines };
}
