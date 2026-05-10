import { lastWordInLine, normalizeWordToken } from "@/workshop/meter/tokenize";

export interface RhymeCluster {
  /** Shared tail text (rough visual rhyme hint). */
  ending: string;
  lineNumbers: number[];
  /** Editor scheme label (A/B/C…) when grouping was derived from `detectRhymeScheme`. */
  label?: string;
}

export interface StanzaClusterGroup {
  /** 1-based stanza index. */
  stanza: number;
  /** Inclusive line range covered by this stanza (1-based). */
  lineRange: [number, number];
  clusters: RhymeCluster[];
}

export type EndRhymeBreadth = "strict" | "near" | "loose";

/**
 * Collapse common English spelling patterns to a coarse sound-key.
 * Not a real phonetic dictionary — handles silent-e, common digraphs and
 * letter-cluster collisions ("man"/"done", "knee"/"sea", "fight"/"kite").
 */
export function phoneticTail(normalizedWord: string): string {
  let w = normalizedWord.toLowerCase();
  if (w.length < 2) return w;

  // Strip silent trailing e (cake → cak, hate → hat, give → giv)
  if (w.length >= 3 && w.endsWith("e") && !/[aeiou]e$/.test(w)) {
    const prev = w[w.length - 2]!;
    if (!"aeiou".includes(prev)) w = w.slice(0, -1);
  }

  // Common silent / digraph collapses
  w = w
    .replace(/gh(t|$)/g, "$1")     // night → nit, though → tho
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/qu/g, "kw")
    .replace(/dge/g, "j")
    .replace(/tch/g, "ch")
    .replace(/x$/, "ks")
    .replace(/(s|t)ion$/g, "shun")
    .replace(/ough$/g, "uf");

  // Final vowel cluster collapses (very rough): unify common spellings
  // for the same sound. These can over-merge but give "loose" feel.
  w = w
    .replace(/ee$|ea$|ie$|y$/g, "i")
    .replace(/eigh$|ay$|ai|ey$/g, "a")
    .replace(/oa$|ow$|oe$|o_e$/g, "o")
    .replace(/oo$|ew$|ue$|ou$/g, "u")
    .replace(/o(n|m|ne|ve)$/g, "u$1");  // "done"/"come"/"love" → "dun"/"cum"/"luv"

  // Rime: last vowel onwards
  const idx = w.search(/[aeiou][^aeiou]*$/);
  if (idx >= 0) return w.slice(idx);
  return w.slice(-2);
}

const VOWEL_RE = /[aeiouy]/i;

export function vowelTailFromNormalized(normalized: string): string | null {
  if (normalized.length < 2) return null;
  let lastVowel = -1;
  for (let i = normalized.length - 1; i >= 0; i--) {
    if (VOWEL_RE.test(normalized[i]!)) { lastVowel = i; break; }
  }
  if (lastVowel >= 0) {
    const tail = normalized.slice(lastVowel);
    return tail.length >= 2 ? tail : normalized.slice(-2);
  }
  return normalized.slice(-2);
}

export function lightVowelTailClusters(lines: string[]): RhymeCluster[] {
  const byTail = new Map<string, number[]>();
  for (let i = 0; i < lines.length; i++) {
    const lw = lastWordInLine(lines[i]!);
    if (!lw) continue;
    const tail = vowelTailFromNormalized(normalizeWordToken(lw));
    if (!tail) continue;
    const prev = byTail.get(tail) ?? [];
    prev.push(i + 1);
    byTail.set(tail, prev);
  }
  return clustersFromMap(byTail);
}

/**
 * Heuristic syllable splitter — splits on vowel-cluster boundaries.
 * Imperfect but usually agrees with CMU stress-pattern length.
 */
export function syllabify(word: string): string[] {
  const w = word.toLowerCase();
  const sylls: string[] = [];
  let cur = "";
  let inVowel = false;
  let hadVowel = false;
  for (let i = 0; i < w.length; i++) {
    const ch = w[i]!;
    const isV = /[aeiouy]/.test(ch);
    if (isV) {
      if (hadVowel && !inVowel) {
        sylls.push(cur);
        cur = "";
      }
      inVowel = true;
      hadVowel = true;
    } else {
      inVowel = false;
    }
    cur += ch;
  }
  if (cur) sylls.push(cur);
  return sylls.length > 0 ? sylls : [w];
}

/**
 * Stress-aware rime: take the spelling from the primary-stressed syllable
 * onward, then collapse via phoneticTail. Falls back to whole-word phonetic
 * tail when the lexicon doesn't know the word or syllable counts disagree.
 */
export function stressAwareTail(
  norm: string,
  stressLex: Map<string, string> | null,
): string {
  if (norm.length < 2) return norm;
  const pat = stressLex?.get(norm);
  if (!pat) return phoneticTail(norm);
  const sylls = syllabify(norm);
  if (sylls.length !== pat.length) return phoneticTail(norm);
  const stressIdx = pat.indexOf("/");
  if (stressIdx < 0) return phoneticTail(norm);
  const tail = sylls.slice(stressIdx).join("");
  return phoneticTail(tail);
}

function endingKeyForBreadth(
  norm: string,
  breadth: EndRhymeBreadth,
  stressLex: Map<string, string> | null,
): string | null {
  if (norm.length < 2) return null;
  if (breadth === "strict") return norm.slice(-Math.min(4, norm.length));
  if (breadth === "loose") return stressAwareTail(norm, stressLex);
  // near: prefer stress-aware tail when known, else vowel-tail
  if (stressLex?.has(norm)) return stressAwareTail(norm, stressLex);
  return vowelTailFromNormalized(norm) ?? phoneticTail(norm);
}

/**
 * Per-stanza end-rhyme clusters. Stanzas split on blank lines. Within each
 * stanza, line endings sharing a key are grouped (cluster needs ≥ 2 lines).
 */
export function endRhymeClustersByStanza(
  lines: string[],
  breadth: EndRhymeBreadth = "near",
  stressLex: Map<string, string> | null = null,
): StanzaClusterGroup[] {
  const groups: StanzaClusterGroup[] = [];
  let stanzaIdx = 0;
  let stanzaStart = -1;
  let byKey = new Map<string, number[]>();

  const flush = (endLine: number) => {
    if (stanzaStart < 0) return;
    const clusters: RhymeCluster[] = [];
    for (const [ending, lineNumbers] of byKey) {
      if (lineNumbers.length >= 2) {
        clusters.push({ ending, lineNumbers: [...new Set(lineNumbers)].sort((a, b) => a - b) });
      }
    }
    clusters.sort((a, b) => b.lineNumbers.length - a.lineNumbers.length);
    if (clusters.length > 0) {
      groups.push({
        stanza: stanzaIdx + 1,
        lineRange: [stanzaStart + 1, endLine + 1],
        clusters,
      });
    }
    stanzaIdx++;
    stanzaStart = -1;
    byKey = new Map();
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) {
      flush(i - 1);
      continue;
    }
    if (stanzaStart < 0) stanzaStart = i;
    const lw = lastWordInLine(raw);
    if (!lw) continue;
    const norm = normalizeWordToken(lw);
    const key = endingKeyForBreadth(norm, breadth, stressLex);
    if (!key) continue;
    const prev = byKey.get(key) ?? [];
    prev.push(i + 1);
    byKey.set(key, prev);
  }
  flush(lines.length - 1);

  return groups;
}

/**
 * Build per-stanza rhyme clusters from an editor-scheme label array
 * (output of `detectRhymeScheme`). Guarantees the panel and the editor
 * gutter agree about which end-words rhyme.
 */
export function stanzaGroupsFromScheme(
  lines: string[],
  schemeLabels: string[],
): StanzaClusterGroup[] {
  const groups: StanzaClusterGroup[] = [];
  let stanzaIdx = 0;
  let stanzaStart = -1;
  let byLabel = new Map<string, number[]>();

  const flush = (endLine: number) => {
    if (stanzaStart < 0) return;
    const clusters: RhymeCluster[] = [];
    for (const [label, lineNumbers] of byLabel) {
      if (lineNumbers.length >= 2) {
        clusters.push({
          ending: label,
          label,
          lineNumbers: [...new Set(lineNumbers)].sort((a, b) => a - b),
        });
      }
    }
    clusters.sort((a, b) => b.lineNumbers.length - a.lineNumbers.length);
    if (clusters.length > 0) {
      groups.push({
        stanza: stanzaIdx + 1,
        lineRange: [stanzaStart + 1, endLine + 1],
        clusters,
      });
    }
    stanzaIdx++;
    stanzaStart = -1;
    byLabel = new Map();
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (!raw.trim()) {
      flush(i - 1);
      continue;
    }
    if (stanzaStart < 0) stanzaStart = i;
    const label = schemeLabels[i];
    if (!label) continue;
    const prev = byLabel.get(label) ?? [];
    prev.push(i + 1);
    byLabel.set(label, prev);
  }
  flush(lines.length - 1);

  return groups;
}

export function roughRhymeClusters(lines: string[]): RhymeCluster[] {
  const byEnd = new Map<string, number[]>();
  for (let i = 0; i < lines.length; i++) {
    const lw = lastWordInLine(lines[i]!);
    if (!lw) continue;
    const n = normalizeWordToken(lw);
    if (n.length < 2) continue;
    const ending = n.slice(-Math.min(4, n.length));
    const prev = byEnd.get(ending) ?? [];
    prev.push(i + 1);
    byEnd.set(ending, prev);
  }
  return clustersFromMap(byEnd);
}

const VOWEL_SET = new Set("aeiouy".split("").map((c) => c.charCodeAt(0)));

function vowelLetterSequence(normalized: string): string | null {
  let out = "";
  for (const ch of normalized.toLowerCase()) {
    if (ch < "a" || ch > "z") continue;
    if (VOWEL_SET.has(ch.charCodeAt(0))) out += ch;
  }
  return out.length >= 2 ? out : null;
}

function consonantLetters(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase()) {
    if (ch < "a" || ch > "z") continue;
    if (!VOWEL_SET.has(ch.charCodeAt(0))) out += ch;
  }
  return out;
}

function consonantCodaKey(normalized: string): string | null {
  if (normalized.length < 2) return null;
  let lastV = -1;
  for (let j = normalized.length - 1; j >= 0; j--) {
    const c = normalized[j]!.toLowerCase();
    if (c >= "a" && c <= "z" && VOWEL_SET.has(c.charCodeAt(0))) { lastV = j; break; }
  }
  const slice = lastV >= 0 ? normalized.slice(lastV + 1) : normalized.slice(-Math.min(6, normalized.length));
  const key = consonantLetters(slice);
  return key.length >= 2 ? key : null;
}

export function lightAssonanceClusters(lines: string[]): RhymeCluster[] {
  const byKey = new Map<string, number[]>();
  for (let i = 0; i < lines.length; i++) {
    const lw = lastWordInLine(lines[i]!);
    if (!lw) continue;
    const key = vowelLetterSequence(normalizeWordToken(lw));
    if (!key) continue;
    const prev = byKey.get(key) ?? [];
    prev.push(i + 1);
    byKey.set(key, prev);
  }
  return clustersFromMap(byKey);
}

export function lightConsonanceClusters(lines: string[]): RhymeCluster[] {
  const byKey = new Map<string, number[]>();
  for (let i = 0; i < lines.length; i++) {
    const lw = lastWordInLine(lines[i]!);
    if (!lw) continue;
    const key = consonantCodaKey(normalizeWordToken(lw));
    if (!key) continue;
    const prev = byKey.get(key) ?? [];
    prev.push(i + 1);
    byKey.set(key, prev);
  }
  return clustersFromMap(byKey);
}

function clustersFromMap(byKey: Map<string, number[]>): RhymeCluster[] {
  const out: RhymeCluster[] = [];
  for (const [ending, lineNumbers] of byKey) {
    if (lineNumbers.length >= 2) {
      out.push({ ending, lineNumbers: [...new Set(lineNumbers)].sort((a, b) => a - b) });
    }
  }
  out.sort((a, b) => b.lineNumbers.length - a.lineNumbers.length);
  return out;
}
