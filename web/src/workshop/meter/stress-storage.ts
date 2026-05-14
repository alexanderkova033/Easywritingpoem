import { useCallback, useEffect, useState } from "react";

const KEY = "easy-poems:manual-stress";

function isPattern(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && /^[\/x]+$/.test(v);
}

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      const word = typeof k === "string" ? k.toLowerCase().trim() : "";
      if (word && isPattern(v)) out[word] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Manual stress overrides — user-declared "this word reads as this pattern"
 * map keyed by lowercased word. Pattern is a string of '/' (stressed) and 'x'
 * (unstressed) marks, one per syllable. Survives across sessions in localStorage.
 */
export function useManualStressOverrides() {
  const [overrides, setOverrides] = useState<Record<string, string>>(() => readMap());

  const setOverride = useCallback((word: string, pattern: string) => {
    const w = word.toLowerCase().trim();
    if (!w || !isPattern(pattern)) return;
    setOverrides((prev) => {
      if (prev[w] === pattern) return prev;
      const next = { ...prev, [w]: pattern };
      writeMap(next);
      return next;
    });
  }, []);

  const removeOverride = useCallback((word: string) => {
    const w = word.toLowerCase().trim();
    setOverrides((prev) => {
      if (!(w in prev)) return prev;
      const next = { ...prev };
      delete next[w];
      writeMap(next);
      return next;
    });
  }, []);

  const clearOverrides = useCallback(() => {
    setOverrides({});
    writeMap({});
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setOverrides(readMap());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { overrides, setOverride, removeOverride, clearOverrides };
}
