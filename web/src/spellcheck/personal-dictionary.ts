import {
  trySessionStorageSetItem,
  tryLocalStorageSetItem,
} from "@/shared/platform/browser-storage";
import {
  STORAGE_KEY_SPELL_DICT,
  STORAGE_KEY_SPELL_IGNORE_SESSION,
} from "@/shared/storage-keys";

const KEY_DICT = STORAGE_KEY_SPELL_DICT;
const KEY_IGNORE = STORAGE_KEY_SPELL_IGNORE_SESSION;

function readJsonSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return new Set();
    return new Set(v.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function writeJsonSet(key: string, s: Set<string>): boolean {
  return tryLocalStorageSetItem(key, JSON.stringify([...s]));
}

export function loadPersonalDictionary(): Set<string> {
  return readJsonSet(KEY_DICT);
}

export function addToPersonalDictionary(word: string): boolean {
  const w = word.toLowerCase().trim();
  if (!w) return true;
  const s = loadPersonalDictionary();
  s.add(w);
  return writeJsonSet(KEY_DICT, s);
}

export function removeFromPersonalDictionary(word: string): boolean {
  const w = word.toLowerCase().trim();
  if (!w) return true;
  const s = loadPersonalDictionary();
  if (!s.delete(w)) return true;
  return writeJsonSet(KEY_DICT, s);
}

export function listPersonalDictionaryWords(): string[] {
  return [...loadPersonalDictionary()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

export function loadSessionIgnores(): Set<string> {
  try {
    const raw = sessionStorage.getItem(KEY_IGNORE);
    if (!raw) return new Set();
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return new Set();
    return new Set(v.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function ignoreWordForSession(word: string): boolean {
  const w = word.toLowerCase().trim();
  if (!w) return true;
  const s = loadSessionIgnores();
  s.add(w);
  return trySessionStorageSetItem(KEY_IGNORE, JSON.stringify([...s]));
}

/** Add many words to session-ignore in a single storage write. */
export function ignoreWordsForSession(words: Iterable<string>): boolean {
  const s = loadSessionIgnores();
  let changed = false;
  for (const word of words) {
    const w = word.toLowerCase().trim();
    if (!w || s.has(w)) continue;
    s.add(w);
    changed = true;
  }
  if (!changed) return true;
  return trySessionStorageSetItem(KEY_IGNORE, JSON.stringify([...s]));
}

/** Add many words to the personal dictionary in a single storage write. */
export function addWordsToPersonalDictionary(words: Iterable<string>): boolean {
  const s = loadPersonalDictionary();
  let changed = false;
  for (const word of words) {
    const w = word.toLowerCase().trim();
    if (!w || s.has(w)) continue;
    s.add(w);
    changed = true;
  }
  if (!changed) return true;
  return writeJsonSet(KEY_DICT, s);
}

export type MergePersonalDictionaryResult =
  | { ok: true; added: number; total: number }
  | { ok: false; error: string };

/** Merge words from export JSON (`JSON.stringify(string[])`). Skips non-strings. */
export function mergePersonalDictionaryFromJson(
  raw: string,
): MergePersonalDictionaryResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Expected a JSON array of words (same shape as export)." };
  }
  const s = loadPersonalDictionary();
  let added = 0;
  for (const x of parsed) {
    if (typeof x !== "string") continue;
    const w = x.toLowerCase().trim();
    if (!w) continue;
    if (!s.has(w)) added++;
    s.add(w);
  }
  if (!writeJsonSet(KEY_DICT, s)) {
    return {
      ok: false,
      error: "Could not save merged dictionary (storage blocked or full).",
    };
  }
  return { ok: true, added, total: s.size };
}
