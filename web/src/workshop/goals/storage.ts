import {
  tryLocalStorageRemoveItem,
  tryLocalStorageSetItem,
} from "@/shared/platform/browser-storage";
import { STORAGE_KEY_GOALS } from "@/shared/storage-keys";
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

export function loadWorkshopGoals(): WorkshopGoals {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GOALS);
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
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
    if (typeof o.preset === "string") out.preset = o.preset;
    const soft = readOptionalStringArray(o.softGoals);
    if (soft) out.softGoals = soft;
    // legacy
    const tlps = readOptionalPositiveInt(o.targetLinesPerStanza);
    if (tlps != null) out.targetLinesPerStanza = tlps;
    return out;
  } catch {
    return {};
  }
}

export function saveWorkshopGoals(goals: WorkshopGoals): boolean {
  const payload: Record<string, number | string | string[]> = {};
  for (const k of NUMERIC_GOAL_KEYS) {
    const v = goals[k];
    if (typeof v === "number") payload[k] = v;
  }
  if (goals.targetRhymeScheme) payload.targetRhymeScheme = goals.targetRhymeScheme;
  if (goals.softGoals && goals.softGoals.length > 0) payload.softGoals = goals.softGoals;
  if (goals.preset != null) payload.preset = goals.preset;
  if (goals.targetLinesPerStanza != null) payload.targetLinesPerStanza = goals.targetLinesPerStanza;
  if (Object.keys(payload).length === 0) {
    return tryLocalStorageRemoveItem(STORAGE_KEY_GOALS);
  }
  return tryLocalStorageSetItem(STORAGE_KEY_GOALS, JSON.stringify(payload));
}
