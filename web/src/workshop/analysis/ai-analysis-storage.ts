import type { PoemAnalysis } from "@/workshop/analysis/ai-analyze";

export const LS_LAST_ANALYSIS_PREFIX = "easy-poems:ai-last:";
export const LS_RESOLVED_PREFIX = "easy-poems:ai-resolved:";
export const LS_IGNORED_PREFIX = "easy-poems:ai-ignored:";

export function loadLastAnalysis(poemId?: string): PoemAnalysis | null {
  if (!poemId) return null;
  try {
    const raw = localStorage.getItem(LS_LAST_ANALYSIS_PREFIX + poemId);
    if (!raw) return null;
    return JSON.parse(raw) as PoemAnalysis;
  } catch { return null; }
}

export function saveLastAnalysis(poemId: string | undefined, analysis: PoemAnalysis) {
  if (!poemId) return;
  try { localStorage.setItem(LS_LAST_ANALYSIS_PREFIX + poemId, JSON.stringify(analysis)); }
  catch { /* storage full */ }
}

export function loadIdSet(prefix: string, poemId?: string): Set<string> {
  if (!poemId) return new Set();
  try {
    const raw = localStorage.getItem(prefix + poemId);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((x) => String(x)));
  } catch { return new Set(); }
}

export function saveIdSet(prefix: string, poemId: string | undefined, set: Set<string>) {
  if (!poemId) return;
  try {
    if (set.size === 0) localStorage.removeItem(prefix + poemId);
    else localStorage.setItem(prefix + poemId, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

export function loadIgnoredIssueIds(poemId?: string): Set<string> {
  return loadIdSet(LS_IGNORED_PREFIX, poemId);
}
