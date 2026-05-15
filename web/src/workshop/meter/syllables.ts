// Memoization caches — countSyllablesInLine is called once per visible line on
// every keystroke (PoemBodyEditor's syllableCountPlugin rebuild). On a 50-line
// poem fast typing was burning ~50× word-tokenisation + heuristics per char.
// Pure functions, safe to cache by input string. Bounded so unbounded poem
// editing can't leak memory.
const WORD_CACHE_LIMIT = 4000;
const LINE_CACHE_LIMIT = 2000;
const wordCache = new Map<string, number>();
const lineCache = new Map<string, number>();

function cachePut<K, V>(map: Map<K, V>, key: K, value: V, limit: number): V {
  if (map.size >= limit) {
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
  map.set(key, value);
  return value;
}

function computeSyllablesInWord(raw: string): number {
  const w = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;

  let count = 0;
  let prevVowel = false;
  for (let i = 0; i < w.length; i++) {
    const v = "aeiouy".includes(w[i]!);
    if (v && !prevVowel) count++;
    prevVowel = v;
  }

  if (w.endsWith("e") && count > 1) count--;
  if (w.endsWith("le") && w.length > 2 && !"aeiouy".includes(w[w.length - 3]!)) {
    if (count === 0) count = 1;
    else count++;
  }

  return Math.max(1, count);
}

/** Approximate English syllable count (heuristic; not linguistically exact). */
export function countSyllablesInWord(raw: string): number {
  const cached = wordCache.get(raw);
  if (cached !== undefined) return cached;
  return cachePut(wordCache, raw, computeSyllablesInWord(raw), WORD_CACHE_LIMIT);
}

export function countSyllablesInLine(line: string): number {
  const cached = lineCache.get(line);
  if (cached !== undefined) return cached;
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return cachePut(lineCache, line, 0, LINE_CACHE_LIMIT);
  let sum = 0;
  for (const p of parts) {
    sum += countSyllablesInWord(p);
  }
  return cachePut(lineCache, line, sum, LINE_CACHE_LIMIT);
}
