import { normalizeWordToken, wordSpansInLine } from "@/workshop/meter/tokenize";
import { suggestCorrections } from "./suggest";

export interface SpellHit {
  lineNumber: number;
  word: string;
  normalized: string;
  suggestions: string[];
  /** Document offsets in the same string passed to {@link spellHitsFromText} (0-based, end-exclusive). */
  docFrom: number;
  docTo: number;
}

function lineNumberAtOffset(text: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Same misspellings as {@link spellErrorRangesFromText}, with line metadata and suggestions.
 * Use this for the workshop list so it stays aligned with editor underlines.
 */
export function spellHitsFromText(
  fullText: string,
  dict: Set<string>,
  personal: Set<string>,
  sessionIgnores: Set<string>,
): SpellHit[] {
  const ranges = spellErrorRangesFromText(fullText, dict, personal, sessionIgnores);
  const hits: SpellHit[] = [];
  for (const r of ranges) {
    const raw = fullText.slice(r.from, r.to);
    const normalized = normalizeWordToken(raw);
    hits.push({
      lineNumber: lineNumberAtOffset(fullText, r.from),
      word: raw,
      normalized,
      suggestions: suggestCorrections(normalized, dict, 5),
      docFrom: r.from,
      docTo: r.to,
    });
  }
  return hits;
}

function shouldSkipToken(token: string, normalized: string): boolean {
  if (normalized.length <= 2) return true;
  if (/\d/.test(token)) return true;
  if (/[^a-zA-Z']/.test(token.replace(/'/g, ""))) return true;
  if (token === token.toUpperCase() && token.length >= 2 && /[A-Z]/.test(token))
    return true;
  if (/[a-z][A-Z]/.test(token)) return true;
  if (/^[ivxlcdm]+$/i.test(normalized) && normalized.length >= 2) return true;
  return false;
}

const CONTRACTION_SUFFIXES = new Set(["s", "re", "ve", "ll", "d", "m"]);
// Bases that don't appear in the wordlist (single-letter words are excluded
// from spell-checking) but are valid contraction stems.
const EXTRA_CONTRACTION_BASES = new Set(["i"]);

function isKnownBase(base: string, dict: Set<string>): boolean {
  return dict.has(base) || EXTRA_CONTRACTION_BASES.has(base);
}

function isContraction(normalized: string, dict: Set<string>): boolean {
  if (!normalized.includes("'")) return false;
  if (normalized.endsWith("n't") && normalized.length > 3) {
    const base = normalized.slice(0, -3);
    if (isKnownBase(base, dict)) return true;
  }
  const apos = normalized.lastIndexOf("'");
  if (apos > 0 && apos < normalized.length - 1) {
    const suffix = normalized.slice(apos + 1);
    if (
      CONTRACTION_SUFFIXES.has(suffix) &&
      isKnownBase(normalized.slice(0, apos), dict)
    ) {
      return true;
    }
  }
  return false;
}

function inDictionary(dict: Set<string>, normalized: string): boolean {
  if (dict.has(normalized)) return true;
  const flat = normalized.replace(/'/g, "");
  if (flat !== normalized && dict.has(flat)) return true;
  if (isContraction(normalized, dict)) return true;
  return false;
}

function inWordSet(set: Set<string>, normalized: string): boolean {
  if (set.has(normalized)) return true;
  const flat = normalized.replace(/'/g, "");
  if (flat !== normalized && set.has(flat)) return true;
  return false;
}

function isMisspelled(
  raw: string,
  normalized: string,
  dict: Set<string>,
  personal: Set<string>,
  sessionIgnores: Set<string>,
): boolean {
  if (!normalized) return false;
  if (shouldSkipToken(raw, normalized)) return false;
  if (inWordSet(personal, normalized) || inWordSet(sessionIgnores, normalized))
    return false;
  if (inDictionary(dict, normalized)) return false;
  return true;
}

/** Character offsets in `fullText` for unknown tokens (for editor decorations). */
export function spellErrorRangesFromText(
  fullText: string,
  dict: Set<string>,
  personal: Set<string>,
  sessionIgnores: Set<string>,
): { from: number; to: number }[] {
  const lines = fullText.split("\n");
  const ranges: { from: number; to: number }[] = [];
  let base = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const span of wordSpansInLine(line)) {
      const normalized = normalizeWordToken(span.raw);
      if (!isMisspelled(span.raw, normalized, dict, personal, sessionIgnores))
        continue;
      ranges.push({ from: base + span.start, to: base + span.end });
    }
    base += line.length + 1;
  }
  return ranges;
}

export function scanLinesForSpelling(
  lines: string[],
  dict: Set<string>,
  personal: Set<string>,
  sessionIgnores: Set<string>,
): SpellHit[] {
  return spellHitsFromText(lines.join("\n"), dict, personal, sessionIgnores);
}
