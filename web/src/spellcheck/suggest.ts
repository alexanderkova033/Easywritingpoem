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

  const e1 = knownInDict(edits1(w), dict);
  if (e1.length) {
    const unique = [...new Set(e1)];
    return phoneticRerank(w, unique).slice(0, max);
  }

  const e2: string[] = [];
  for (const w1 of edits1(w)) {
    for (const w2 of edits1(w1)) {
      if (dict.has(w2)) e2.push(w2);
    }
  }
  const unique = [...new Set(e2)];
  return phoneticRerank(w, unique).slice(0, max);
}
