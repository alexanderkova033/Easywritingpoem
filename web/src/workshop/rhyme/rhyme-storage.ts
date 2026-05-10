import { useCallback, useEffect, useState } from "react";

const PIN_KEY = "easy-poems:rhyme-pins";
const RECENT_KEY = "easy-poems:rhyme-recent";
const RECENT_MAX = 6;
const IGNORE_KEY = "easy-poems:rhyme-ignored";
const MANUAL_LINK_KEY = "easy-poems:rhyme-manual-links";

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function usePinnedRhymes() {
  const [pinned, setPinned] = useState<string[]>(() => readList(PIN_KEY));

  const togglePin = useCallback((word: string) => {
    setPinned((prev) => {
      const has = prev.includes(word);
      const next = has ? prev.filter((w) => w !== word) : [...prev, word];
      writeList(PIN_KEY, next);
      return next;
    });
  }, []);

  const isPinned = useCallback((word: string) => pinned.includes(word), [pinned]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PIN_KEY) setPinned(readList(PIN_KEY));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { pinned, togglePin, isPinned };
}

/**
 * User-flagged "not actually a rhyme" word groups.
 * Identifier is the alphabetised set of end-words in the cluster, joined with `+`.
 * Survives line moves; resets only if user changes the words involved.
 */
export function makeIgnoreKey(words: string[]): string {
  return [...new Set(words.map((w) => w.toLowerCase().trim()).filter(Boolean))]
    .sort()
    .join("+");
}

export function useIgnoredRhymes() {
  const [ignored, setIgnored] = useState<string[]>(() => readList(IGNORE_KEY));

  const ignoreCluster = useCallback((words: string[]) => {
    const key = makeIgnoreKey(words);
    if (!key) return;
    setIgnored((prev) => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      writeList(IGNORE_KEY, next);
      return next;
    });
  }, []);

  const clearIgnored = useCallback(() => {
    setIgnored([]);
    writeList(IGNORE_KEY, []);
  }, []);

  const isIgnored = useCallback((words: string[]) => {
    const key = makeIgnoreKey(words);
    return ignored.includes(key);
  }, [ignored]);

  return { ignored, ignoreCluster, isIgnored, clearIgnored };
}

/**
 * Manual rhyme links — user-declared "these two end-words rhyme" pairs.
 * Stored as alphabetised "wordA+wordB" strings so they survive line reorderings.
 * Pairs combine transitively (A+B, B+C ⇒ {A,B,C} share the same scheme label).
 */
export function makeLinkKey(a: string, b: string): string {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y || x === y) return "";
  return [x, y].sort().join("+");
}

export function parseLinkKey(key: string): [string, string] | null {
  const parts = key.split("+");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return [parts[0]!, parts[1]!];
}

export function useManualRhymeLinks() {
  const [links, setLinks] = useState<string[]>(() => readList(MANUAL_LINK_KEY));

  const addLink = useCallback((wordA: string, wordB: string) => {
    const key = makeLinkKey(wordA, wordB);
    if (!key) return;
    setLinks((prev) => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      writeList(MANUAL_LINK_KEY, next);
      return next;
    });
  }, []);

  const removeLink = useCallback((key: string) => {
    setLinks((prev) => {
      const next = prev.filter((k) => k !== key);
      writeList(MANUAL_LINK_KEY, next);
      return next;
    });
  }, []);

  const clearLinks = useCallback(() => {
    setLinks([]);
    writeList(MANUAL_LINK_KEY, []);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === MANUAL_LINK_KEY) setLinks(readList(MANUAL_LINK_KEY));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { links, addLink, removeLink, clearLinks };
}

export function useRecentLookups() {
  const [recent, setRecent] = useState<string[]>(() => readList(RECENT_KEY));

  const pushRecent = useCallback((word: string) => {
    const w = word.trim().toLowerCase();
    if (!w) return;
    setRecent((prev) => {
      const next = [w, ...prev.filter((x) => x !== w)].slice(0, RECENT_MAX);
      writeList(RECENT_KEY, next);
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecent([]);
    writeList(RECENT_KEY, []);
  }, []);

  return { recent, pushRecent, clearRecent };
}
