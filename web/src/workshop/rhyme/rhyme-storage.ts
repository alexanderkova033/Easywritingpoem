import { useCallback, useEffect, useState } from "react";

const PIN_KEY = "easy-poems:rhyme-pins";
const RECENT_KEY = "easy-poems:rhyme-recent";
const RECENT_MAX = 6;

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
