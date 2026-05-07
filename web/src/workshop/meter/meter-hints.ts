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

export type LineStressSource = "lexicon" | "mixed" | "heuristic";

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
): { pattern: string; hit: boolean } {
  const w = normalizeWordForLex(raw);
  if (!w) return { pattern: "", hit: false };
  const direct = lexicon?.get(w);
  if (direct) return { pattern: direct, hit: true };
  if (w.includes("-")) {
    const parts = w.split("-").filter(Boolean);
    let acc = "";
    let any = false;
    for (const p of parts) {
      const pat = lexicon?.get(p);
      if (pat) { acc += pat; any = true; }
      else acc += stressPatternForWordHeuristic(p);
    }
    return { pattern: acc, hit: any };
  }
  return { pattern: stressPatternForWordHeuristic(raw), hit: false };
}

export function stressPatternForWord(
  raw: string,
  lexicon: ReadonlyMap<string, string> | null,
): string {
  return stressPatternFromLexiconToken(raw, lexicon).pattern;
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

function classifyLineStressSource(hits: number, total: number): LineStressSource {
  if (total <= 0) return "heuristic";
  if (hits === total) return "lexicon";
  if (hits > 0) return "mixed";
  return "heuristic";
}

export function meterHintsForBody(
  body: string,
  lexicon: ReadonlyMap<string, string> | null,
): LineMeterHint[] {
  const rawLines = body.split("\n");
  const out: LineMeterHint[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i]!;
    const words = wordsInLine(text);
    let stressPattern = "";
    let lexHits = 0;
    let lexTotal = 0;
    for (const w of words) {
      const { pattern, hit } = stressPatternFromLexiconToken(w, lexicon);
      stressPattern += pattern;
      if (normalizeWordForLex(w)) {
        lexTotal++;
        if (hit) lexHits++;
      }
    }
    const syllables = countSyllablesInLine(text);
    const iambicFitPercent = iambicFitPercentForPattern(stressPattern);
    const stressSource = classifyLineStressSource(lexHits, lexTotal);
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
    if (src === "lexicon") lexiconLines++;
    else if (src === "mixed") mixedLines++;
    else heuristicLines++;
  }
  return { nonEmptyLines, lexiconLines, mixedLines, heuristicLines };
}
