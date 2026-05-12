import { normalizeWordToken, wordSpansInLine, wordsInLine } from "@/workshop/meter/tokenize";

const STOP = new Set(
  [
    "the", "and", "a", "an", "to", "of", "in", "on", "for", "with", "as", "at",
    "by", "from", "or", "but", "so", "if", "is", "are", "was", "were", "be",
    "been", "being", "it", "its", "this", "that", "these", "those", "i", "you",
    "he", "she", "we", "they", "me", "him", "her", "us", "them", "my", "your",
    "his", "our", "their", "not", "no", "yes", "all", "can", "will", "would",
    "could", "should", "than", "then", "there", "here", "when", "where",
    "what", "who", "which", "do", "does", "did", "have", "has", "had", "into",
    "out", "up", "down", "over", "under", "off",
  ].map((s) => s.toLowerCase()),
);

export type Severity = "low" | "med" | "high";

export interface WordOccurrence {
  line: number;
  start: number;
  end: number;
  surface: string;
  lineText: string;
}

export interface RepeatedWord {
  word: string;
  display: string;
  count: number;
  lines: number[];
  occurrences: WordOccurrence[];
  severity: Severity;
  minGap: number;
  variants: string[];
}

export interface PhraseRepeat {
  phrase: string;
  display: string;
  n: number;
  count: number;
  lines: number[];
  severity: Severity;
  snippets: Array<{ line: number; text: string }>;
}

export interface AnaphoraGroup {
  prefix: string;
  display: string;
  n: number;
  lines: number[];
  snippets: Array<{ line: number; text: string }>;
}

export interface RepetitionAnalysis {
  words: RepeatedWord[];
  phrases: PhraseRepeat[];
  anaphora: AnaphoraGroup[];
  epistrophe: AnaphoraGroup[];
}

export interface RepetitionOptions {
  minLen?: number;
  minCount?: number;
  includePhrases?: boolean;
  includeStems?: boolean;
  maxWords?: number;
  maxPhrases?: number;
}

function simpleStem(w: string): string {
  if (w.length <= 4) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("es") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 4) return w.slice(0, -1);
  return w;
}

function severityFromCounts(count: number, minGap: number): Severity {
  if (count >= 4 || minGap <= 1) return "high";
  if (count === 3 || minGap <= 3) return "med";
  return "low";
}

function phraseSeverity(count: number, minGap: number, n: number): Severity {
  if (count >= 3 || (n >= 3 && count >= 2) || minGap <= 1) return "high";
  if (minGap <= 3) return "med";
  return "low";
}

export function analyzeRepetition(
  lines: string[],
  opts: RepetitionOptions = {},
): RepetitionAnalysis {
  const {
    minLen = 4,
    minCount = 2,
    includePhrases = true,
    includeStems = true,
    maxWords = 40,
    maxPhrases = 20,
  } = opts;

  const wordMap = new Map<
    string,
    {
      count: number;
      lines: Set<number>;
      occ: WordOccurrence[];
      surfaceCounts: Map<string, number>;
    }
  >();

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]!;
    const spans = wordSpansInLine(lineText);
    for (const span of spans) {
      const w = normalizeWordToken(span.raw);
      if (w.length < minLen) continue;
      if (STOP.has(w)) continue;
      const cur =
        wordMap.get(w) ?? {
          count: 0,
          lines: new Set<number>(),
          occ: [],
          surfaceCounts: new Map<string, number>(),
        };
      cur.count += 1;
      cur.lines.add(i + 1);
      cur.occ.push({
        line: i + 1,
        start: span.start,
        end: span.end,
        surface: span.raw,
        lineText,
      });
      cur.surfaceCounts.set(span.raw, (cur.surfaceCounts.get(span.raw) ?? 0) + 1);
      wordMap.set(w, cur);
    }
  }

  let rawWords: RepeatedWord[] = [];
  for (const [word, info] of wordMap) {
    if (info.count < minCount) continue;
    const sortedLines = [...info.lines].sort((a, b) => a - b);
    const minGap = computeMinGap(sortedLines);
    let display = word;
    let best = 0;
    for (const [s, c] of info.surfaceCounts) {
      if (c > best) {
        best = c;
        display = s;
      }
    }
    rawWords.push({
      word,
      display,
      count: info.count,
      lines: sortedLines,
      occurrences: info.occ.sort((a, b) => a.line - b.line || a.start - b.start),
      severity: severityFromCounts(info.count, minGap),
      minGap,
      variants: [word],
    });
  }

  if (includeStems && rawWords.length > 1) {
    rawWords = mergeStems(rawWords);
  }

  rawWords.sort((a, b) => {
    const sev = severityRank(b.severity) - severityRank(a.severity);
    if (sev !== 0) return sev;
    if (b.count !== a.count) return b.count - a.count;
    return a.word.localeCompare(b.word);
  });
  const words = rawWords.slice(0, maxWords);

  const phrases: PhraseRepeat[] = includePhrases
    ? findPhrases(lines, minCount).slice(0, maxPhrases)
    : [];

  const anaphora = findEdgeRepeats(lines, "start");
  const epistrophe = findEdgeRepeats(lines, "end");

  return { words, phrases, anaphora, epistrophe };
}

function computeMinGap(sortedLines: number[]): number {
  if (sortedLines.length < 2) return Number.POSITIVE_INFINITY;
  let m = Number.POSITIVE_INFINITY;
  for (let i = 1; i < sortedLines.length; i++) {
    const g = sortedLines[i]! - sortedLines[i - 1]! - 1;
    if (g < m) m = g;
  }
  return m;
}

function severityRank(s: Severity): number {
  return s === "high" ? 3 : s === "med" ? 2 : 1;
}

function mergeStems(words: RepeatedWord[]): RepeatedWord[] {
  const byStem = new Map<string, RepeatedWord[]>();
  for (const w of words) {
    const stem = simpleStem(w.word);
    const arr = byStem.get(stem) ?? [];
    arr.push(w);
    byStem.set(stem, arr);
  }
  const out: RepeatedWord[] = [];
  for (const group of byStem.values()) {
    if (group.length === 1) {
      out.push(group[0]!);
      continue;
    }
    group.sort((a, b) => b.count - a.count);
    const primary = group[0]!;
    const occ = group.flatMap((g) => g.occurrences).sort(
      (a, b) => a.line - b.line || a.start - b.start,
    );
    const lineSet = new Set<number>();
    let count = 0;
    for (const g of group) {
      g.lines.forEach((l) => lineSet.add(l));
      count += g.count;
    }
    const sortedLines = [...lineSet].sort((a, b) => a - b);
    const minGap = computeMinGap(sortedLines);
    out.push({
      word: primary.word,
      display: primary.display,
      count,
      lines: sortedLines,
      occurrences: occ,
      severity: severityFromCounts(count, minGap),
      minGap,
      variants: group.map((g) => g.word),
    });
  }
  return out;
}

function findPhrases(lines: string[], minCount: number): PhraseRepeat[] {
  type Slot = { line: number; text: string };
  const bigrams = new Map<string, Slot[]>();
  const trigrams = new Map<string, Slot[]>();

  for (let i = 0; i < lines.length; i++) {
    const ws = wordsInLine(lines[i]!).map(normalizeWordToken).filter(Boolean);
    for (let j = 0; j + 1 < ws.length; j++) {
      const a = ws[j]!;
      const b = ws[j + 1]!;
      if (STOP.has(a) && STOP.has(b)) continue;
      const key = `${a} ${b}`;
      let arr = bigrams.get(key);
      if (!arr) {
        arr = [];
        bigrams.set(key, arr);
      }
      arr.push({ line: i + 1, text: lines[i]! });
    }
    for (let j = 0; j + 2 < ws.length; j++) {
      const a = ws[j]!;
      const b = ws[j + 1]!;
      const c = ws[j + 2]!;
      if (STOP.has(a) && STOP.has(b) && STOP.has(c)) continue;
      const key = `${a} ${b} ${c}`;
      let arr = trigrams.get(key);
      if (!arr) {
        arr = [];
        trigrams.set(key, arr);
      }
      arr.push({ line: i + 1, text: lines[i]! });
    }
  }

  const out: PhraseRepeat[] = [];
  const trigramKeys = new Set<string>();
  for (const [phrase, slots] of trigrams) {
    if (slots.length < minCount) continue;
    trigramKeys.add(phrase);
    const lineNums = uniqLines(slots);
    const minGap = computeMinGap(lineNums);
    out.push({
      phrase,
      display: phrase,
      n: 3,
      count: slots.length,
      lines: lineNums,
      severity: phraseSeverity(slots.length, minGap, 3),
      snippets: dedupeSnippets(slots),
    });
  }
  for (const [phrase, slots] of bigrams) {
    if (slots.length < minCount) continue;
    let coveredByTrigram = false;
    for (const t of trigramKeys) {
      if (t.includes(phrase)) {
        coveredByTrigram = true;
        break;
      }
    }
    if (coveredByTrigram) continue;
    const lineNums = uniqLines(slots);
    const minGap = computeMinGap(lineNums);
    out.push({
      phrase,
      display: phrase,
      n: 2,
      count: slots.length,
      lines: lineNums,
      severity: phraseSeverity(slots.length, minGap, 2),
      snippets: dedupeSnippets(slots),
    });
  }

  out.sort((a, b) => {
    const sev = severityRank(b.severity) - severityRank(a.severity);
    if (sev !== 0) return sev;
    if (b.n !== a.n) return b.n - a.n;
    if (b.count !== a.count) return b.count - a.count;
    return a.phrase.localeCompare(b.phrase);
  });
  return out;
}

function uniqLines(slots: Array<{ line: number }>): number[] {
  const s = new Set<number>();
  slots.forEach((x) => s.add(x.line));
  return [...s].sort((a, b) => a - b);
}

function dedupeSnippets(
  slots: Array<{ line: number; text: string }>,
): Array<{ line: number; text: string }> {
  const seen = new Set<number>();
  const out: Array<{ line: number; text: string }> = [];
  for (const s of slots) {
    if (seen.has(s.line)) continue;
    seen.add(s.line);
    out.push(s);
  }
  return out;
}

function findEdgeRepeats(
  lines: string[],
  edge: "start" | "end",
): AnaphoraGroup[] {
  const map = new Map<
    string,
    { display: string; lines: number[]; snippets: Array<{ line: number; text: string }>; n: number }
  >();
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    const ws = wordsInLine(text);
    if (ws.length === 0) continue;
    let key1: string;
    let key2: string | null;
    let disp1: string;
    let disp2: string | null = null;
    if (edge === "start") {
      disp1 = ws[0]!;
      key1 = normalizeWordToken(disp1);
      if (ws.length >= 2) {
        disp2 = `${ws[0]} ${ws[1]}`;
        key2 = `${normalizeWordToken(ws[0]!)} ${normalizeWordToken(ws[1]!)}`;
      } else {
        key2 = null;
      }
    } else {
      disp1 = ws[ws.length - 1]!;
      key1 = normalizeWordToken(disp1);
      if (ws.length >= 2) {
        disp2 = `${ws[ws.length - 2]} ${ws[ws.length - 1]}`;
        key2 = `${normalizeWordToken(ws[ws.length - 2]!)} ${normalizeWordToken(ws[ws.length - 1]!)}`;
      } else {
        key2 = null;
      }
    }
    if (key1.length >= 2) {
      const e = map.get(key1) ?? { display: disp1, lines: [], snippets: [], n: 1 };
      e.lines.push(i + 1);
      e.snippets.push({ line: i + 1, text });
      map.set(key1, e);
    }
    if (key2 && key2.length >= 4) {
      const e = map.get(key2) ?? { display: disp2!, lines: [], snippets: [], n: 2 };
      e.lines.push(i + 1);
      e.snippets.push({ line: i + 1, text });
      map.set(key2, e);
    }
  }
  const out: AnaphoraGroup[] = [];
  const taken = new Set<string>();
  const entries = [...map.entries()].filter(([, v]) => v.lines.length >= 2);
  entries.sort((a, b) => b[0].split(" ").length - a[0].split(" ").length || b[1].lines.length - a[1].lines.length);
  for (const [prefix, v] of entries) {
    if (v.n === 1) {
      let coveredByLonger = false;
      for (const t of taken) {
        const parts = t.split(" ");
        if (parts[edge === "start" ? 0 : parts.length - 1] === prefix && t !== prefix) {
          if (parts.length > 1) {
            coveredByLonger = true;
            break;
          }
        }
      }
      if (coveredByLonger) continue;
    }
    taken.add(prefix);
    out.push({
      prefix,
      display: v.display,
      n: v.n,
      lines: [...v.lines].sort((a, b) => a - b),
      snippets: v.snippets,
    });
  }
  out.sort((a, b) => b.lines.length - a.lines.length || b.n - a.n);
  return out;
}

export function findRepeatedWords(
  lines: string[],
  minLen = 4,
): RepeatedWord[] {
  return analyzeRepetition(lines, { minLen, includePhrases: false, includeStems: false }).words;
}
