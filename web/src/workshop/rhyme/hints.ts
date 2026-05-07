import { lastWordInLine, normalizeWordToken } from "@/workshop/meter/tokenize";

export interface RhymeCluster {
  /** Shared tail text (rough visual rhyme hint). */
  ending: string;
  lineNumbers: number[];
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
