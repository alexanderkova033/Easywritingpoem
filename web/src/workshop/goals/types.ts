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
