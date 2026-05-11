/** Optional numeric targets; unset = no constraint. */
export interface WorkshopGoals {
  // Exact-value targets (mutually exclusive with their range counterparts below;
  // when both set, exact takes precedence).
  targetLines?: number;
  targetStanzas?: number;
  targetWords?: number;

  // Range targets — use either side or both. Half-open ranges allowed
  // (e.g. minLines only = "at least", maxLines only = "at most").
  minLines?: number;
  maxLines?: number;
  minStanzas?: number;
  maxStanzas?: number;
  minWords?: number;
  maxWords?: number;

  /** Flag lines whose estimated syllables exceed this. */
  maxSyllablesPerLine?: number;

  /**
   * Target end-rhyme scheme as a letter string (e.g. "ABAB", "AABBA").
   * Compared structurally against detected scheme using first-appearance
   * letter relabelling, so the user's letter choice doesn't matter.
   */
  targetRhymeScheme?: string;

  /** Keys of goals that are soft/aspirational (no issues-panel warnings). Default: all goals are required. */
  softGoals?: string[];
  /** Key of the active form preset, if any. */
  preset?: string;
  // Legacy fields kept for load compatibility only
  targetLinesPerStanza?: number;
  syllablePattern?: number[];
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
    description: "5 lines · 1 stanza · AABBA",
    goals: {
      targetLines: 5,
      targetStanzas: 1,
      targetRhymeScheme: "AABBA",
    },
  },
  {
    key: "sonnet",
    label: "Sonnet",
    description: "14 lines · 4 stanzas · ABABCDCDEFEFGG · max 10 syllables/line",
    goals: {
      targetLines: 14,
      targetStanzas: 4,
      maxSyllablesPerLine: 10,
      targetRhymeScheme: "ABABCDCDEFEFGG",
    },
  },
  {
    key: "villanelle",
    label: "Villanelle",
    description: "19 lines · 6 stanzas",
    goals: { targetLines: 19, targetStanzas: 6 },
  },
];

/**
 * Keys representing a real, numeric or string goal value (excludes meta like
 * `preset` and `softGoals`). Used to detect "any goal set" without false
 * positives from empty meta values.
 */
export const NUMERIC_GOAL_KEYS = [
  "targetLines",
  "targetStanzas",
  "targetWords",
  "minLines",
  "maxLines",
  "minStanzas",
  "maxStanzas",
  "minWords",
  "maxWords",
  "maxSyllablesPerLine",
] as const satisfies readonly (keyof WorkshopGoals)[];

export const ALL_GOAL_KEYS = [
  ...NUMERIC_GOAL_KEYS,
  "targetRhymeScheme",
] as const satisfies readonly (keyof WorkshopGoals)[];

export function hasAnyGoalSet(goals: WorkshopGoals): boolean {
  return ALL_GOAL_KEYS.some((k) => goals[k] != null && goals[k] !== "");
}

/**
 * Canonicalise an end-rhyme scheme string: strip whitespace and non-letters,
 * uppercase, then relabel letters in first-appearance order so structurally
 * equivalent schemes compare equal. e.g. "abab" → "ABAB", "BABA" → "ABAB".
 */
export function canonicaliseRhymeScheme(input: string): string {
  const letters = input.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (!letters) return "";
  const map = new Map<string, string>();
  const base = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let next = 0;
  let out = "";
  for (const ch of letters) {
    let mapped = map.get(ch);
    if (!mapped) {
      mapped = base[next++] ?? ch;
      map.set(ch, mapped);
    }
    out += mapped;
  }
  return out;
}
