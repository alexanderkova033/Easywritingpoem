import {
  tryLocalStorageRemoveItem,
  tryLocalStorageSetItem,
} from "@/shared/platform/browser-storage";
import {
  STORAGE_KEY_GOALS,
  STORAGE_KEY_GOALS_V2,
} from "@/shared/storage-keys";
import {
  NUMERIC_GOAL_KEYS,
  canonicaliseRhymeScheme,
  type WorkshopGoals,
} from "./types";

function readOptionalPositiveInt(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.floor(n);
}

function readOptionalStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((s): s is string => typeof s === "string");
  return out.length > 0 ? out : undefined;
}

function parseGoals(v: unknown): WorkshopGoals {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const out: WorkshopGoals = {};
  for (const k of NUMERIC_GOAL_KEYS) {
    const n = readOptionalPositiveInt(o[k]);
    if (n != null) (out as Record<string, unknown>)[k] = n;
  }
  if (typeof o.targetRhymeScheme === "string") {
    const canon = canonicaliseRhymeScheme(o.targetRhymeScheme);
    if (canon) out.targetRhymeScheme = canon;
  }
  if (o.targetRhymeSchemePerStanza === true) {
    out.targetRhymeSchemePerStanza = true;
  }
  if (typeof o.preset === "string") out.preset = o.preset;
  const soft = readOptionalStringArray(o.softGoals);
  if (soft) out.softGoals = soft;
  const tlps = readOptionalPositiveInt(o.targetLinesPerStanza);
  if (tlps != null) out.targetLinesPerStanza = tlps;
  return out;
}

function serialiseGoals(goals: WorkshopGoals): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {};
  for (const k of NUMERIC_GOAL_KEYS) {
    const v = goals[k];
    if (typeof v === "number") payload[k] = v;
  }
  if (goals.targetRhymeScheme) payload.targetRhymeScheme = goals.targetRhymeScheme;
  if (goals.targetRhymeSchemePerStanza) payload.targetRhymeSchemePerStanza = true;
  if (goals.softGoals && goals.softGoals.length > 0) payload.softGoals = goals.softGoals;
  if (goals.preset != null) payload.preset = goals.preset;
  if (goals.targetLinesPerStanza != null) payload.targetLinesPerStanza = goals.targetLinesPerStanza;
  if (Object.keys(payload).length === 0) return null;
  return payload;
}

function readMap(): Record<string, WorkshopGoals> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GOALS_V2);
    if (!raw) return {};
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    const out: Record<string, WorkshopGoals> = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      const goals = parseGoals(v);
      if (Object.keys(goals).length > 0) out[k] = goals;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, WorkshopGoals>): boolean {
  if (Object.keys(map).length === 0) {
    return tryLocalStorageRemoveItem(STORAGE_KEY_GOALS_V2);
  }
  return tryLocalStorageSetItem(STORAGE_KEY_GOALS_V2, JSON.stringify(map));
}

/**
 * Migrate the pre per-poem global goals key onto a specific poem if no v2 entry
 * exists yet for that poem. Runs lazily inside loadWorkshopGoals.
 */
function migrateLegacyIfNeeded(poemId: string, map: Record<string, WorkshopGoals>): void {
  try {
    const legacyRaw = localStorage.getItem(STORAGE_KEY_GOALS);
    if (!legacyRaw) return;
    void tryLocalStorageRemoveItem(STORAGE_KEY_GOALS);
    if (map[poemId]) return;
    const legacy = parseGoals(JSON.parse(legacyRaw) as unknown);
    if (Object.keys(legacy).length === 0) return;
    map[poemId] = legacy;
    void writeMap(map);
  } catch {
    /* ignore */
  }
}

export function loadWorkshopGoals(poemId: string): WorkshopGoals {
  const map = readMap();
  migrateLegacyIfNeeded(poemId, map);
  return map[poemId] ?? {};
}

export function saveWorkshopGoals(poemId: string, goals: WorkshopGoals): boolean {
  const map = readMap();
  const payload = serialiseGoals(goals);
  if (!payload) {
    if (!(poemId in map)) return true;
    delete map[poemId];
  } else {
    map[poemId] = payload as WorkshopGoals;
  }
  return writeMap(map);
}

export function removeWorkshopGoalsForPoem(poemId: string): void {
  const map = readMap();
  if (!(poemId in map)) return;
  delete map[poemId];
  void writeMap(map);
}
