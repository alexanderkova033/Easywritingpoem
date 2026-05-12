import { countSyllablesInLine } from "@/workshop/meter/syllables";
import { wordsInLine } from "@/workshop/meter/tokenize";

/** Typical aloud pace for poetry (words per minute), for a rough reading-time hint. */
export const POETRY_READING_WPM = 130;

export interface LineStatRow {
  lineNumber: number;
  text: string;
  syllables: number;
  words: number;
  chars: number;
}

/** Per-stanza aggregates (stanzas separated by one or more blank lines). */
export interface StanzaStat {
  stanzaIndex: number;
  startLine: number;
  endLine: number;
  /** Lines in this stanza from startLine–endLine (includes the stanza’s own lines only). */
  lineCountInStanza: number;
  nonEmptyLines: number;
  words: number;
  syllables: number;
  /** Mean estimated syllables per non-empty line in this stanza (1 decimal). */
  avgSyllablesPerNonEmptyLine: number;
}

/** Live counts for the header / overview (no syllable work — cheap on every keystroke). */
export interface QuickDocumentStats {
  totalLines: number;
  nonEmptyLines: number;
  totalWords: number;
  totalChars: number;
  stanzaCount: number;
}

export function computeQuickDocumentStats(body: string): QuickDocumentStats {
  if (!body) {
    return {
      totalLines: 0,
      nonEmptyLines: 0,
      totalWords: 0,
      totalChars: 0,
      stanzaCount: 0,
    };
  }
  const rawLines = body.split("\n");
  let nonEmpty = 0;
  let totalWords = 0;
  for (const text of rawLines) {
    const isNonEmpty = text.trim().length > 0;
    if (isNonEmpty) {
      nonEmpty++;
      totalWords += wordsInLine(text).length;
    }
  }
  let stanzaCount = 0;
  let prevBlank = true;
  for (const text of rawLines) {
    const blank = text.trim().length === 0;
    if (!blank && prevBlank) stanzaCount++;
    prevBlank = blank;
  }
  return {
    totalLines: rawLines.length,
    nonEmptyLines: nonEmpty,
    totalWords,
    totalChars: body.length,
    stanzaCount,
  };
}

export interface DocumentStats {
  lines: LineStatRow[];
  totalLines: number;
  nonEmptyLines: number;
  totalSyllables: number;
  totalWords: number;
  totalChars: number;
  /** Non-empty line groups separated by one or more blank lines. */
  stanzaCount: number;
  /** Estimated minutes to read aloud at {@link POETRY_READING_WPM} (1 decimal); 0 if no words. */
  estimatedReadingMinutes: number;
  /** One entry per stanza; empty if there are no non-empty lines. */
  stanzaStats: StanzaStat[];
  /** Mean words per non-empty line (1 decimal); 0 if no non-empty lines. */
  avgWordsPerNonEmptyLine: number;
  /** Line with the most words (ties: earliest line). */
  longestLineByWords: { lineNumber: number; words: number } | null;
  /** Line with the most characters (ties: earliest line). */
  longestLineByChars: { lineNumber: number; chars: number } | null;
}

export function computeDocumentStats(body: string): DocumentStats {
  const rawLines = body.split("\n");
  if (rawLines.length === 0) {
    return {
      lines: [],
      totalLines: 0,
      nonEmptyLines: 0,
      totalSyllables: 0,
      totalWords: 0,
      totalChars: 0,
      stanzaCount: 0,
      estimatedReadingMinutes: 0,
      stanzaStats: [],
      avgWordsPerNonEmptyLine: 0,
      longestLineByWords: null,
      longestLineByChars: null,
    };
  }

  const lines: LineStatRow[] = [];
  let totalSyllables = 0;
  let totalWords = 0;
  let nonEmpty = 0;
  let longestWords: { lineNumber: number; words: number } | null = null;
  let longestChars: { lineNumber: number; chars: number } | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i]!;
    const ws = wordsInLine(text);
    const wn = ws.length;
    const syllables = countSyllablesInLine(text);
    const ch = text.length;
    const isNonEmpty = text.trim().length > 0;
    if (isNonEmpty) nonEmpty++;
    totalSyllables += syllables;
    totalWords += wn;
    if (isNonEmpty) {
      if (!longestWords || wn > longestWords.words) {
        longestWords = { lineNumber: i + 1, words: wn };
      }
      if (!longestChars || ch > longestChars.chars) {
        longestChars = { lineNumber: i + 1, chars: ch };
      }
    }
    lines.push({
      lineNumber: i + 1,
      text,
      syllables,
      words: wn,
      chars: ch,
    });
  }

  let stanzaCount = 0;
  let prevBlank = true;
  for (const text of rawLines) {
    const blank = text.trim().length === 0;
    if (!blank && prevBlank) stanzaCount++;
    prevBlank = blank;
  }

  const avgWordsPerNonEmptyLine =
    nonEmpty > 0 ? Math.round((10 * totalWords) / nonEmpty) / 10 : 0;

  const stanzaStats: StanzaStat[] = [];
  let si = 0;
  while (si < rawLines.length) {
    while (si < rawLines.length && rawLines[si]!.trim() === "") si++;
    if (si >= rawLines.length) break;
    const startLine = si + 1;
    let end = si;
    let stNonEmpty = 0;
    let stWords = 0;
    let stSyl = 0;
    let stLines = 0;
    while (end < rawLines.length && rawLines[end]!.trim() !== "") {
      const row = lines[end]!;
      stLines++;
      if (row.text.trim().length > 0) {
        stNonEmpty++;
        stWords += row.words;
        stSyl += row.syllables;
      }
      end++;
    }
    stanzaStats.push({
      stanzaIndex: stanzaStats.length + 1,
      startLine,
      endLine: end,
      lineCountInStanza: stLines,
      nonEmptyLines: stNonEmpty,
      words: stWords,
      syllables: stSyl,
      avgSyllablesPerNonEmptyLine:
        stNonEmpty > 0 ? Math.round((10 * stSyl) / stNonEmpty) / 10 : 0,
    });
    si = end;
  }

  const estimatedReadingMinutes =
    totalWords <= 0
      ? 0
      : Math.max(0.1, Math.round((10 * totalWords) / POETRY_READING_WPM) / 10);

  return {
    lines,
    totalLines: rawLines.length,
    nonEmptyLines: nonEmpty,
    totalSyllables,
    totalWords,
    totalChars: body.length,
    stanzaCount,
    estimatedReadingMinutes,
    stanzaStats,
    avgWordsPerNonEmptyLine,
    longestLineByWords: longestWords,
    longestLineByChars: longestChars,
  };
}
