import {
  tryLocalStorageRemoveItem,
  tryLocalStorageSetItem,
} from "@/shared/platform/browser-storage";
import { STORAGE_KEY_GOALS } from "@/shared/storage-keys";

const STORAGE_KEY = STORAGE_KEY_GOALS;

/** Optional numeric targets; unset = no constraint. */
export interface WorkshopGoals {
  targetLines?: number;
  targetStanzas?: number;
  targetLinesPerStanza?: number;
  /** Flag lines whose estimated syllables exceed this. */
  maxSyllablesPerLine?: number;
  // Legacy fields kept for load compatibility only
  minLines?: number;
  maxLines?: number;
  minWords?: number;
  maxWords?: number;
  minStanzas?: number;
  maxStanzas?: number;
}

function readOptionalPositiveInt(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.floor(n);
}

export function loadWorkshopGoals(): WorkshopGoals {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return {};
    const o = v as Record<string, unknown>;
    return {
      targetLines: readOptionalPositiveInt(o.targetLines),
      targetStanzas: readOptionalPositiveInt(o.targetStanzas),
      targetLinesPerStanza: readOptionalPositiveInt(o.targetLinesPerStanza),
      maxSyllablesPerLine: readOptionalPositiveInt(o.maxSyllablesPerLine),
    };
  } catch {
    return {};
  }
}

export function saveWorkshopGoals(goals: WorkshopGoals): boolean {
  const payload: Record<string, number> = {};
  if (goals.targetLines != null) payload.targetLines = goals.targetLines;
  if (goals.targetStanzas != null) payload.targetStanzas = goals.targetStanzas;
  if (goals.targetLinesPerStanza != null) payload.targetLinesPerStanza = goals.targetLinesPerStanza;
  if (goals.maxSyllablesPerLine != null) payload.maxSyllablesPerLine = goals.maxSyllablesPerLine;
  if (Object.keys(payload).length === 0) {
    return tryLocalStorageRemoveItem(STORAGE_KEY);
  }
  return tryLocalStorageSetItem(STORAGE_KEY, JSON.stringify(payload));
}
