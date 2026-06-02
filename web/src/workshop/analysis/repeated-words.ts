import { normalizeWordToken, wordSpansInLine } from "@/workshop/meter/tokenize";

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

export interface PhraseOccurrence {
  line: number;
  start: number;
  end: number;
  lineText: string;
}

export interface PhraseRepeat {
  phrase: string;
  display: string;
  n: number;
  count: number;
  lines: number[];
  severity: Severity;
  snippets: Array<{ line: number; text: string }>;
  occurrences: PhraseOccurrence[];
}

export interface EdgeOccurrence {
  line: number;
  start: number;
  end: number;
  lineText: string;
}

export interface AnaphoraGroup {
  prefix: string;
  display: string;
  n: number;
  lines: number[];
  snippets: Array<{ line: number; text: string }>;
  occurrences: EdgeOccurrence[];
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

  const phrases: PhraseRepeat[] = includePhrases
    ? findPhrases(lines, minCount).slice(0, maxPhrases)
    : [];

  // Phrase repeats dominate: drop a word repeat if every one of its occurrences
  // sits inside a phrase occurrence. Otherwise the same span lights up twice
  // (once as a phrase, once per constituent word) and the Phrases panel and
  // editor highlights disagree on what's a "real" repeat.
  const phraseRangesByLine = new Map<number, Array<{ start: number; end: number }>>();
  for (const p of phrases) {
    for (const o of p.occurrences) {
      let arr = phraseRangesByLine.get(o.line);
      if (!arr) {
        arr = [];
        phraseRangesByLine.set(o.line, arr);
      }
      arr.push({ start: o.start, end: o.end });
    }
  }
  const occCoveredByPhrase = (occ: WordOccurrence): boolean => {
    const ranges = phraseRangesByLine.get(occ.line);
    if (!ranges) return false;
    return ranges.some((r) => occ.start >= r.start && occ.end <= r.end);
  };
  const dedupedWords = rawWords.filter(
    (w) => !w.occurrences.every(occCoveredByPhrase),
  );

  const words = dedupedWords.slice(0, maxWords);

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

const PHRASE_MAX_N = 12;

function findPhrases(lines: string[], minCount: number): PhraseRepeat[] {
  type Slot = { line: number; text: string; start: number; end: number };
  // Bucket candidate n-grams per width so we can walk widest→narrowest.
  const byN: Array<Map<string, Slot[]>> = [];
  for (let n = 0; n <= PHRASE_MAX_N; n++) byN.push(new Map());

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]!;
    const spans = wordSpansInLine(lineText);
    if (spans.length < 2) continue;
    const norms = spans.map((s) => normalizeWordToken(s.raw));
    const maxN = Math.min(PHRASE_MAX_N, spans.length);
    for (let n = 2; n <= maxN; n++) {
      const map = byN[n]!;
      for (let j = 0; j + n <= spans.length; j++) {
        // Skip runs that are entirely stop words — those are filler, not echoes.
        let allStop = true;
        let anyEmpty = false;
        for (let k = 0; k < n; k++) {
          const tok = norms[j + k]!;
          if (!tok) {
            anyEmpty = true;
            break;
          }
          if (!STOP.has(tok)) allStop = false;
        }
        if (anyEmpty || allStop) continue;
        const parts = norms.slice(j, j + n);
        const key = parts.join(" ");
        let arr = map.get(key);
        if (!arr) {
          arr = [];
          map.set(key, arr);
        }
        arr.push({
          line: i + 1,
          text: lineText,
          start: spans[j]!.start,
          end: spans[j + n - 1]!.end,
        });
      }
    }
  }

  // Walk widest n first. Accept any phrase that still has an occurrence not
  // covered by an already-accepted (longer) phrase; mark its spans as covered.
  type Range = { line: number; start: number; end: number };
  type Accepted = { phrase: string; n: number; slots: Slot[] };
  const covered: Range[] = [];
  const accepted: Accepted[] = [];
  const isCovered = (s: { line: number; start: number; end: number }) =>
    covered.some(
      (r) => r.line === s.line && s.start >= r.start && s.end <= r.end,
    );

  for (let n = PHRASE_MAX_N; n >= 2; n--) {
    const candidates: Array<{ phrase: string; slots: Slot[] }> = [];
    for (const [phrase, slots] of byN[n]!) {
      if (slots.length < minCount) continue;
      candidates.push({ phrase, slots });
    }
    // Stable order across runs: highest count first, then phrase text.
    candidates.sort((a, b) => {
      if (b.slots.length !== a.slots.length) return b.slots.length - a.slots.length;
      return a.phrase.localeCompare(b.phrase);
    });
    for (const cand of candidates) {
      // If every occurrence is already inside a wider accepted phrase, drop.
      let allCovered = true;
      for (const s of cand.slots) {
        if (!isCovered(s)) {
          allCovered = false;
          break;
        }
      }
      if (allCovered) continue;
      accepted.push({ phrase: cand.phrase, n, slots: cand.slots });
      for (const s of cand.slots) {
        covered.push({ line: s.line, start: s.start, end: s.end });
      }
    }
  }

  const out: PhraseRepeat[] = accepted.map(({ phrase, n, slots }) => {
    const lineNums = uniqLines(slots);
    const minGap = computeMinGap(lineNums);
    return {
      phrase,
      display: phrase,
      n,
      count: slots.length,
      lines: lineNums,
      severity: phraseSeverity(slots.length, minGap, n),
      snippets: dedupeSnippets(slots),
      occurrences: slotsToPhraseOccurrences(slots),
    };
  });

  out.sort((a, b) => {
    const sev = severityRank(b.severity) - severityRank(a.severity);
    if (sev !== 0) return sev;
    if (b.n !== a.n) return b.n - a.n;
    if (b.count !== a.count) return b.count - a.count;
    return a.phrase.localeCompare(b.phrase);
  });
  return out;
}

function slotsToPhraseOccurrences(
  slots: Array<{ line: number; text: string; start: number; end: number }>,
): PhraseOccurrence[] {
  return slots
    .map((s) => ({ line: s.line, start: s.start, end: s.end, lineText: s.text }))
    .sort((a, b) => a.line - b.line || a.start - b.start);
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
    {
      display: string;
      lines: number[];
      snippets: Array<{ line: number; text: string }>;
      occurrences: EdgeOccurrence[];
      n: number;
    }
  >();
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    const spans = wordSpansInLine(text);
    if (spans.length === 0) continue;
    const ws = spans.map((s) => s.raw);
    let key1: string;
    let key2: string | null;
    let disp1: string;
    let disp2: string | null = null;
    let occ1: EdgeOccurrence;
    let occ2: EdgeOccurrence | null = null;
    if (edge === "start") {
      disp1 = ws[0]!;
      key1 = normalizeWordToken(disp1);
      occ1 = { line: i + 1, start: spans[0]!.start, end: spans[0]!.end, lineText: text };
      if (spans.length >= 2) {
        disp2 = `${ws[0]} ${ws[1]}`;
        key2 = `${normalizeWordToken(ws[0]!)} ${normalizeWordToken(ws[1]!)}`;
        occ2 = { line: i + 1, start: spans[0]!.start, end: spans[1]!.end, lineText: text };
      } else {
        key2 = null;
      }
    } else {
      const last = spans.length - 1;
      disp1 = ws[last]!;
      key1 = normalizeWordToken(disp1);
      occ1 = { line: i + 1, start: spans[last]!.start, end: spans[last]!.end, lineText: text };
      if (spans.length >= 2) {
        disp2 = `${ws[last - 1]} ${ws[last]}`;
        key2 = `${normalizeWordToken(ws[last - 1]!)} ${normalizeWordToken(ws[last]!)}`;
        occ2 = { line: i + 1, start: spans[last - 1]!.start, end: spans[last]!.end, lineText: text };
      } else {
        key2 = null;
      }
    }
    if (key1.length >= 2) {
      const e =
        map.get(key1) ?? { display: disp1, lines: [], snippets: [], occurrences: [], n: 1 };
      e.lines.push(i + 1);
      e.snippets.push({ line: i + 1, text });
      e.occurrences.push(occ1);
      map.set(key1, e);
    }
    if (key2 && key2.length >= 4 && occ2) {
      const e =
        map.get(key2) ?? { display: disp2!, lines: [], snippets: [], occurrences: [], n: 2 };
      e.lines.push(i + 1);
      e.snippets.push({ line: i + 1, text });
      e.occurrences.push(occ2);
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
      occurrences: [...v.occurrences].sort((a, b) => a.line - b.line || a.start - b.start),
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
