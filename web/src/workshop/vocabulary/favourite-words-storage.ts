import { useCallback, useEffect, useState } from "react";

const FAV_KEY = "easy-poems:favourite-words:v1";
const LOOKUP_KEY = "easy-poems:looked-up-words:v1";
const LOOKUP_MAX = 50;

export interface FavouriteWord {
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

export function loadFavouriteWords(): FavouriteWord[] {
  const arr = readJson<unknown>(FAV_KEY, []);
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((v): v is FavouriteWord =>
      !!v && typeof v === "object" && typeof (v as FavouriteWord).word === "string",
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

export function useFavouriteWords() {
  const [favourites, setFavourites] = useState<FavouriteWord[]>(() => loadFavouriteWords());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === FAV_KEY) setFavourites(loadFavouriteWords());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isFavourite = useCallback(
    (word: string) => {
      const w = normalize(word);
      return favourites.some((f) => f.word === w);
    },
    [favourites],
  );

  const addFavourite = useCallback((entry: Omit<FavouriteWord, "addedAt"> & { addedAt?: string }) => {
    const w = normalize(entry.word);
    if (!w) return;
    setFavourites((prev) => {
      const without = prev.filter((f) => f.word !== w);
      const next: FavouriteWord[] = [
        { ...entry, word: w, addedAt: entry.addedAt ?? new Date().toISOString() },
        ...without,
      ];
      writeJson(FAV_KEY, next);
      return next;
    });
  }, []);

  const removeFavourite = useCallback((word: string) => {
    const w = normalize(word);
    setFavourites((prev) => {
      const next = prev.filter((f) => f.word !== w);
      writeJson(FAV_KEY, next);
      return next;
    });
  }, []);

  const toggleFavourite = useCallback(
    (entry: Omit<FavouriteWord, "addedAt">) => {
      const w = normalize(entry.word);
      if (!w) return;
      setFavourites((prev) => {
        const has = prev.some((f) => f.word === w);
        const next = has
          ? prev.filter((f) => f.word !== w)
          : [{ ...entry, word: w, addedAt: new Date().toISOString() }, ...prev];
        writeJson(FAV_KEY, next);
        return next;
      });
    },
    [],
  );

  const updateNote = useCallback((word: string, note: string) => {
    const w = normalize(word);
    setFavourites((prev) => {
      const next = prev.map((f) => (f.word === w ? { ...f, note: note.trim() || undefined } : f));
      writeJson(FAV_KEY, next);
      return next;
    });
  }, []);

  return { favourites, isFavourite, addFavourite, removeFavourite, toggleFavourite, updateNote };
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
