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
  /** Key of the active form preset, if any. */
  preset?: string;
  // Legacy fields kept for load compatibility only
  minLines?: number;
  maxLines?: number;
  minWords?: number;
  maxWords?: number;
  minStanzas?: number;
  maxStanzas?: number;
}

export interface FormPreset {
  key: string;
  label: string;
  description: string;
  goals: Omit<WorkshopGoals, "preset">;
}

export const FORM_PRESETS: FormPreset[] = [
  {
    key: "haiku",
    label: "Haiku",
    description: "3 lines · 5-7-5 syllables",
    goals: { targetLines: 3, targetStanzas: 1, maxSyllablesPerLine: 7 },
  },
  {
    key: "limerick",
    label: "Limerick",
    description: "5 lines · 1 stanza · AABBA",
    goals: { targetLines: 5, targetStanzas: 1 },
  },
  {
    key: "sonnet",
    label: "Sonnet",
    description: "14 lines · 4 stanzas · iambic pentameter",
    goals: { targetLines: 14, targetStanzas: 4, targetLinesPerStanza: 4, maxSyllablesPerLine: 10 },
  },
  {
    key: "villanelle",
    label: "Villanelle",
    description: "19 lines · 6 stanzas · two refrains",
    goals: { targetLines: 19, targetStanzas: 6, targetLinesPerStanza: 3 },
  },
  {
    key: "tercets",
    label: "Tercets",
    description: "3 lines per stanza",
    goals: { targetLinesPerStanza: 3 },
  },
  {
    key: "quatrains",
    label: "Quatrains",
    description: "4 lines per stanza",
    goals: { targetLinesPerStanza: 4 },
  },
];

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
      preset: typeof o.preset === "string" ? o.preset : undefined,
    };
  } catch {
    return {};
  }
}

export function saveWorkshopGoals(goals: WorkshopGoals): boolean {
  const payload: Record<string, number | string> = {};
  if (goals.targetLines != null) payload.targetLines = goals.targetLines;
  if (goals.targetStanzas != null) payload.targetStanzas = goals.targetStanzas;
  if (goals.targetLinesPerStanza != null) payload.targetLinesPerStanza = goals.targetLinesPerStanza;
  if (goals.maxSyllablesPerLine != null) payload.maxSyllablesPerLine = goals.maxSyllablesPerLine;
  if (goals.preset != null) payload.preset = goals.preset;
  if (Object.keys(payload).length === 0) {
    return tryLocalStorageRemoveItem(STORAGE_KEY);
  }
  return tryLocalStorageSetItem(STORAGE_KEY, JSON.stringify(payload));
}
