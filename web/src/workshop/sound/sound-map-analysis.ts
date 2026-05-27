/**
 * Sound-map analysis: pure, client-side helpers that turn a poem into per-line
 * highlight data for the Sound Map panel. Uses the loaded CMU stress lexicon
 * when available for accurate vowel/consonant detection, falling back to
 * letter-pattern heuristics so it works before the lexicon loads.
 */

import { wordsInLine } from "@/workshop/meter/tokenize";

export type SoundClass =
  | "alliteration"
  | "assonance"
  | "consonance"
  | "sibilance"
  | "plosive"
  | "liquid";

/** Phoneme groupings — keyed on simplified vowel/consonant labels. */
const SIBILANT_PHONEMES = new Set(["S", "SH", "Z", "ZH"]);
const PLOSIVE_PHONEMES = new Set(["P", "B", "T", "D", "K", "G"]);
const LIQUID_PHONEMES = new Set(["L", "R", "M", "N", "NG"]);

const SIBILANT_LETTERS = /^(sh|zh|s|z|c)/i;
const PLOSIVE_LETTERS = /^(p|b|t|d|k|g|c)/i;
const LIQUID_LETTERS = /^(l|r|m|n)/i;

const VOWEL_BUCKETS: Record<string, string> = {
  AA: "ah", AE: "a",  AH: "uh", AO: "aw",
  AW: "ow", AY: "i",  EH: "e",  ER: "er",
  EY: "ay", IH: "ih", IY: "ee", OW: "oh",
  OY: "oy", UH: "uh", UW: "oo",
};
const LETTER_VOWEL_FALLBACK: Record<string, string> = {
  a: "a", e: "e", i: "i", o: "o", u: "u", y: "ih",
};

export interface WordToken {
  /** Raw word as written (incl. punctuation/case stripped to letters). */
  word: string;
  /** Lowercased a–z only. */
  normalized: string;
  /** Inclusive index of first character in the line. */
  start: number;
  /** Exclusive index after last character. */
  end: number;
  /** Vowel bucket (one of VOWEL_BUCKETS values) or "" if unknown. */
  dominantVowel: string;
  /** First-letter / first phoneme used for alliteration grouping. */
  initialSound: string;
  /** Set of sound classes this word participates in. */
  classes: Set<SoundClass>;
  /** Last vowel-tail (for rhyme web). */
  endingKey: string;
}

export interface LineSound {
  lineNumber: number;
  text: string;
  tokens: WordToken[];
  dominantVowel: string;
  /** Whether this line ends with a hard end-stop (.!?) or comma vs no-punct (enjambment). */
  endStop: "hard" | "soft" | "open";
  /** Word index where a caesura sits, or null if none. */
  caesuraAt: number | null;
}

function firstPhoneme(pat: string | undefined): string | null {
  if (!pat) return null;
  const t = pat.trim().split(/\s+/)[0];
  return t ? t.replace(/[0-9]/g, "") : null;
}

function lastVowelPhoneme(pat: string | undefined): string | null {
  if (!pat) return null;
  const tokens = pat.trim().split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!.replace(/[0-9]/g, "");
    if (t in VOWEL_BUCKETS) return t;
  }
  return null;
}

function dominantVowelLetter(word: string): string {
  const m = word.toLowerCase().match(/[aeiouy]/g);
  if (!m || m.length === 0) return "";
  return LETTER_VOWEL_FALLBACK[m[0]!] ?? "";
}

function endingKeyHeuristic(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return "";
  // Take the last vowel + everything after.
  const m = w.match(/[aeiouy][a-z]*$/);
  return m ? m[0]! : w.slice(-2);
}

function endingKeyFromPhonemes(pat: string | undefined): string {
  if (!pat) return "";
  const tokens = pat.trim().split(/\s+/).map((t) => t.replace(/[0-9]/g, ""));
  let lastVowelIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i]! in VOWEL_BUCKETS) { lastVowelIdx = i; break; }
  }
  if (lastVowelIdx < 0) return "";
  return tokens.slice(lastVowelIdx).join("-");
}

function classifyInitial(letter: string, firstPh: string | null): Set<SoundClass> {
  const out = new Set<SoundClass>();
  if (firstPh) {
    if (SIBILANT_PHONEMES.has(firstPh)) out.add("sibilance");
    if (PLOSIVE_PHONEMES.has(firstPh)) out.add("plosive");
    if (LIQUID_PHONEMES.has(firstPh)) out.add("liquid");
  } else {
    if (SIBILANT_LETTERS.test(letter)) out.add("sibilance");
    if (PLOSIVE_LETTERS.test(letter)) out.add("plosive");
    if (LIQUID_LETTERS.test(letter)) out.add("liquid");
  }
  return out;
}

export function buildLineSounds(
  lines: string[],
  lexicon: ReadonlyMap<string, string> | null,
): LineSound[] {
  const out: LineSound[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? "";
    const tokens: WordToken[] = [];
    const initialCounts = new Map<string, number>();
    const vowelCounts = new Map<string, number>();

    let cursor = 0;
    for (const raw of wordsInLine(text)) {
      // Locate this word in the line text from `cursor`.
      const idx = text.indexOf(raw, cursor);
      const start = idx >= 0 ? idx : cursor;
      const end = start + raw.length;
      cursor = end;

      const normalized = raw.toLowerCase().replace(/[^a-z]/g, "");
      if (!normalized) continue;

      const pat = lexicon?.get(normalized);
      const fp = firstPhoneme(pat);
      const lv = lastVowelPhoneme(pat);
      const dom = lv ? (VOWEL_BUCKETS[lv] ?? "") : dominantVowelLetter(normalized);
      const initialSound = fp ?? normalized[0]!;
      const cls = classifyInitial(normalized[0]!, fp);
      const endingKey = pat ? endingKeyFromPhonemes(pat) : endingKeyHeuristic(normalized);

      tokens.push({
        word: raw,
        normalized,
        start,
        end,
        dominantVowel: dom,
        initialSound,
        classes: cls,
        endingKey,
      });
      initialCounts.set(initialSound, (initialCounts.get(initialSound) ?? 0) + 1);
      if (dom) vowelCounts.set(dom, (vowelCounts.get(dom) ?? 0) + 1);
    }

    // Mark assonance and alliteration and consonance based on counts.
    for (const tok of tokens) {
      if ((initialCounts.get(tok.initialSound) ?? 0) >= 2) tok.classes.add("alliteration");
      if (tok.dominantVowel && (vowelCounts.get(tok.dominantVowel) ?? 0) >= 2) tok.classes.add("assonance");
      // Consonance — same initial sound that isn't a vowel (treat as a consonant cluster signal).
      if ((initialCounts.get(tok.initialSound) ?? 0) >= 2 &&
          !/^[aeiou]/i.test(tok.normalized)) {
        tok.classes.add("consonance");
      }
    }

    // Dominant line vowel.
    let domLineVowel = "";
    let best = 0;
    for (const [k, v] of vowelCounts.entries()) {
      if (v > best) { best = v; domLineVowel = k; }
    }

    // End-stop classification by the line's last non-space char.
    const trimmed = text.trimEnd();
    const lastChar = trimmed.slice(-1);
    let endStop: "hard" | "soft" | "open" = "open";
    if (/[.!?…]/.test(lastChar)) endStop = "hard";
    else if (/[,;:—-]/.test(lastChar)) endStop = "soft";

    // Caesura — first interior comma/semicolon/em-dash.
    let caesuraAt: number | null = null;
    const caesuraMatch = text.search(/[,;:—–]/);
    if (caesuraMatch > 0 && caesuraMatch < trimmed.length - 1) {
      // Find which token comes just before this punctuation.
      for (let t = 0; t < tokens.length; t++) {
        if (tokens[t]!.end <= caesuraMatch + 1) caesuraAt = t;
        else break;
      }
    }

    out.push({
      lineNumber: i + 1,
      text,
      tokens,
      dominantVowel: domLineVowel,
      endStop,
      caesuraAt,
    });
  }
  return out;
}

/** Vowel bucket → CSS hue used for the vowel-arc bars. */
export const VOWEL_HUES: Record<string, string> = {
  ah: "#e89a6a", a: "#e6b87a", uh: "#cdb38f", aw: "#b8967a",
  ow: "#9fb27a", i: "#f0c060", e: "#83b89a", er: "#9aa890",
  ay: "#7ab8b8", ih: "#8a9ed1", ee: "#7fa5d6", oh: "#a890c0",
  oy: "#c79ad0", oo: "#7e88bf", o: "#a98ed6", u: "#9a82c5",
  y: "#9ac0d8",
};

/** Build pairs of (token A in line L1, token B in line L2) that share an
 * endingKey — used by the rhyme web overlay. Caps pair count to avoid clutter. */
export interface RhymeWebPair {
  fromLine: number;
  fromToken: number;
  toLine: number;
  toToken: number;
  endingKey: string;
}
export function buildRhymeWebPairs(
  lines: LineSound[],
  maxPairs = 60,
): RhymeWebPair[] {
  const byKey = new Map<string, Array<{ line: number; token: number }>>();
  for (const ls of lines) {
    for (let t = 0; t < ls.tokens.length; t++) {
      const tok = ls.tokens[t]!;
      if (!tok.endingKey || tok.endingKey.length < 2) continue;
      const arr = byKey.get(tok.endingKey) ?? [];
      arr.push({ line: ls.lineNumber, token: t });
      byKey.set(tok.endingKey, arr);
    }
  }
  const pairs: RhymeWebPair[] = [];
  for (const [key, arr] of byKey.entries()) {
    if (arr.length < 2) continue;
    // Pair each consecutive occurrence; skips self-line repeats unless distant.
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i]!;
      const b = arr[i + 1]!;
      if (a.line === b.line && Math.abs(a.token - b.token) < 3) continue;
      pairs.push({ fromLine: a.line, fromToken: a.token, toLine: b.line, toToken: b.token, endingKey: key });
      if (pairs.length >= maxPairs) return pairs;
    }
  }
  return pairs;
}

export const SOUND_CLASS_LABELS: Record<SoundClass, string> = {
  alliteration: "Alliteration",
  assonance: "Assonance",
  consonance: "Consonance",
  sibilance: "Sibilance",
  plosive: "Plosives",
  liquid: "Liquids",
};

export const SOUND_CLASS_HUES: Record<SoundClass, string> = {
  alliteration: "#c98c46",
  assonance:    "#7da6c9",
  consonance:   "#b08fb4",
  sibilance:    "#7fb8b3",
  plosive:      "#d2745d",
  liquid:       "#8fb480",
};
