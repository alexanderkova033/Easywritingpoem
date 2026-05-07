/** Optional numeric targets; unset = no constraint. */
export interface WorkshopGoals {
  targetLines?: number;
  targetStanzas?: number;
  targetWords?: number;
  /** Flag lines whose estimated syllables exceed this. */
  maxSyllablesPerLine?: number;
  /** Keys of goals that are soft/aspirational (no issues-panel warnings). Default: all goals are required. */
  softGoals?: string[];
  /** Key of the active form preset, if any. */
  preset?: string;
  // Legacy fields kept for load compatibility only
  targetLinesPerStanza?: number;
  syllablePattern?: number[];
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
  goals: Omit<WorkshopGoals, "preset" | "softGoals">;
}

export const FORM_PRESETS: FormPreset[] = [
  {
    key: "haiku",
    label: "Haiku",
    description: "3 lines · 1 stanza",
    goals: { targetLines: 3, targetStanzas: 1 },
  },
  {
    key: "limerick",
    label: "Limerick",
    description: "5 lines · 1 stanza",
    goals: { targetLines: 5, targetStanzas: 1 },
  },
  {
    key: "sonnet",
    label: "Sonnet",
    description: "14 lines · 4 stanzas · max 10 syllables per line",
    goals: { targetLines: 14, targetStanzas: 4, maxSyllablesPerLine: 10 },
  },
  {
    key: "villanelle",
    label: "Villanelle",
    description: "19 lines · 6 stanzas",
    goals: { targetLines: 19, targetStanzas: 6 },
  },
];
