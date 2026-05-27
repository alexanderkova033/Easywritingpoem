import { useCallback, useEffect, useState } from "react";

const STARRED_KEY = "easy-poems:starred-words:v1";
const LEGACY_FAV_KEY = "easy-poems:favourite-words:v1";
const LOOKUP_KEY = "easy-poems:looked-up-words:v1";
const LOOKUP_MAX = 50;

export interface StarredWord {
  word: string;
  /** ISO timestamp added. */
  addedAt: string;
  /** Optional snapshot of the definition for quick re-display. */
  pos?: string;
  defs?: string[];
  syns?: string[];
  ants?: string[];
  /** User free-text note. */
  note?: string;
}

export interface LookedUpWord {
  word: string;
  lookedUpAt: string;
  pos?: string;
  /** First definition only — kept short. */
  firstDef?: string;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as unknown;
    return v as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

function normalize(word: string): string {
  return word.trim().toLowerCase().replace(/[^a-z'-]/g, "");
}

export function loadStarredWords(): StarredWord[] {
  // Migration: read new key; fall back to legacy favourites key and copy across.
  let arr = readJson<unknown>(STARRED_KEY, null as unknown);
  if (arr == null) {
    const legacy = readJson<unknown>(LEGACY_FAV_KEY, null as unknown);
    if (Array.isArray(legacy) && legacy.length > 0) {
      writeJson(STARRED_KEY, legacy);
      try { localStorage.removeItem(LEGACY_FAV_KEY); } catch { /* ignore */ }
      arr = legacy;
    } else {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((v): v is StarredWord =>
      !!v && typeof v === "object" && typeof (v as StarredWord).word === "string",
    )
    .map((v) => ({ ...v, word: normalize(v.word) }))
    .filter((v) => v.word.length > 0);
}

export function loadLookedUpWords(): LookedUpWord[] {
  const arr = readJson<unknown>(LOOKUP_KEY, []);
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((v): v is LookedUpWord =>
      !!v && typeof v === "object" && typeof (v as LookedUpWord).word === "string",
    )
    .map((v) => ({ ...v, word: normalize(v.word) }))
    .filter((v) => v.word.length > 0);
}

export function useStarredWords() {
  const [starred, setStarred] = useState<StarredWord[]>(() => loadStarredWords());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STARRED_KEY || e.key === LEGACY_FAV_KEY) setStarred(loadStarredWords());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isStarred = useCallback(
    (word: string) => {
      const w = normalize(word);
      return starred.some((s) => s.word === w);
    },
    [starred],
  );

  const addStarred = useCallback((entry: Omit<StarredWord, "addedAt"> & { addedAt?: string }) => {
    const w = normalize(entry.word);
    if (!w) return;
    setStarred((prev) => {
      const without = prev.filter((s) => s.word !== w);
      const next: StarredWord[] = [
        { ...entry, word: w, addedAt: entry.addedAt ?? new Date().toISOString() },
        ...without,
      ];
      writeJson(STARRED_KEY, next);
      return next;
    });
  }, []);

  const removeStarred = useCallback((word: string) => {
    const w = normalize(word);
    setStarred((prev) => {
      const next = prev.filter((s) => s.word !== w);
      writeJson(STARRED_KEY, next);
      return next;
    });
  }, []);

  const toggleStarred = useCallback(
    (entry: Omit<StarredWord, "addedAt">) => {
      const w = normalize(entry.word);
      if (!w) return;
      setStarred((prev) => {
        const has = prev.some((s) => s.word === w);
        const next = has
          ? prev.filter((s) => s.word !== w)
          : [{ ...entry, word: w, addedAt: new Date().toISOString() }, ...prev];
        writeJson(STARRED_KEY, next);
        return next;
      });
    },
    [],
  );

  const updateNote = useCallback((word: string, note: string) => {
    const w = normalize(word);
    setStarred((prev) => {
      const next = prev.map((s) => (s.word === w ? { ...s, note: note.trim() || undefined } : s));
      writeJson(STARRED_KEY, next);
      return next;
    });
  }, []);

  return { starred, isStarred, addStarred, removeStarred, toggleStarred, updateNote };
}

export function useLookedUpWords() {
  const [lookedUp, setLookedUp] = useState<LookedUpWord[]>(() => loadLookedUpWords());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOOKUP_KEY) setLookedUp(loadLookedUpWords());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const recordLookup = useCallback((entry: Omit<LookedUpWord, "lookedUpAt">) => {
    const w = normalize(entry.word);
    if (!w) return;
    setLookedUp((prev) => {
      const without = prev.filter((l) => l.word !== w);
      const next = [
        { ...entry, word: w, lookedUpAt: new Date().toISOString() },
        ...without,
      ].slice(0, LOOKUP_MAX);
      writeJson(LOOKUP_KEY, next);
      return next;
    });
  }, []);

  const clearLookups = useCallback(() => {
    setLookedUp([]);
    writeJson(LOOKUP_KEY, []);
  }, []);

  const removeLookup = useCallback((word: string) => {
    const w = normalize(word);
    setLookedUp((prev) => {
      const next = prev.filter((l) => l.word !== w);
      writeJson(LOOKUP_KEY, next);
      return next;
    });
  }, []);

  return { lookedUp, recordLookup, clearLookups, removeLookup };
}
