import { metaphone, phoneticSimilarity } from "./phonetic";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

function edits1(word: string): Set<string> {
  const results = new Set<string>();
  const n = word.length;
  for (let i = 0; i <= n; i++) {
    results.add(word.slice(0, i) + word.slice(i + 1));
    if (i < n - 1) {
      results.add(
        word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2),
      );
    }
    for (let c = 0; c < ALPHABET.length; c++) {
      const ch = ALPHABET[c]!;
      results.add(word.slice(0, i) + ch + word.slice(i + 1));
      results.add(word.slice(0, i) + ch + word.slice(i));
    }
  }
  return results;
}

function knownInDict(words: Iterable<string>, dict: Set<string>): string[] {
  const out: string[] = [];
  for (const w of words) {
    if (dict.has(w)) out.push(w);
  }
  return out;
}

/**
 * Re-rank candidates so words that sound like `target` come first.
 * Stable within tiers so the underlying edit-distance ranking is preserved.
 */
function phoneticRerank(target: string, candidates: string[]): string[] {
  if (candidates.length <= 1) return candidates;
  const targetCode = metaphone(target);
  if (!targetCode) return candidates;
  const scored = candidates.map((w, idx) => ({
    w,
    idx,
    score: phoneticSimilarity(targetCode, metaphone(w)),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.idx - b.idx;
  });
  return scored.map((s) => s.w);
}

// The edits2 fallback below generates on the order of (54 * word.length)^2
// candidate strings — cheap once, but the caller re-scans every misspelled
// word in the document on every debounce tick while typing continues
// elsewhere. Without caching, an unresolved (2-edits-away) word redoes that
// full search every ~300ms for as long as it stays flagged, which is what
// produced the "lags massively after a typo" reports. Cache per dict
// instance (a WeakMap so it's dropped if the dict is ever replaced) keyed
// on the word, and slice to `max` per call site.
const suggestionCache = new WeakMap<Set<string>, Map<string, string[]>>();

/** Up to `max` dictionary words one or two edits away (Norvig-style), re-ranked phonetically. */
export function suggestCorrections(
  word: string,
  dict: Set<string>,
  max = 6,
): string[] {
  const w = word.toLowerCase();
  if (!w) return [];
  if (dict.has(w) || dict.has(w.replace(/'/g, ""))) return [];
  if (w.length > 28) return [];

  let cache = suggestionCache.get(dict);
  if (!cache) {
    cache = new Map();
    suggestionCache.set(dict, cache);
  }
  const cached = cache.get(w);
  if (cached) return cached.slice(0, max);

  const e1 = knownInDict(edits1(w), dict);
  let ranked: string[];
  if (e1.length) {
    ranked = phoneticRerank(w, [...new Set(e1)]);
  } else {
    const e2: string[] = [];
    for (const w1 of edits1(w)) {
      for (const w2 of edits1(w1)) {
        if (dict.has(w2)) e2.push(w2);
      }
    }
    ranked = phoneticRerank(w, [...new Set(e2)]);
  }
  cache.set(w, ranked);
  return ranked.slice(0, max);
}
