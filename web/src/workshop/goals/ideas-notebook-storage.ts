import {
  tryLocalStorageRemoveItem,
  tryLocalStorageSetItem,
} from "@/shared/platform/browser-storage";
import { STORAGE_KEY_IDEAS_NOTEBOOK } from "@/shared/storage-keys";

export type IdeaMood = "neutral" | "warm" | "cool" | "tender" | "dark";

export const IDEA_MOOD_OPTIONS: { mood: IdeaMood; label: string }[] = [
  { mood: "neutral", label: "Neutral" },
  { mood: "warm", label: "Warm" },
  { mood: "cool", label: "Cool" },
  { mood: "tender", label: "Tender" },
  { mood: "dark", label: "Dark" },
];

export interface IdeaEntry {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  mood?: IdeaMood;
}

const MAX_TEXT_LEN = 500;

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `idea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadIdeas(): IdeaEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_IDEAS_NOTEBOOK);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .map((item): IdeaEntry | null => {
        if (!item || typeof item !== "object") return null;
        const o = item as Record<string, unknown>;
        const id = typeof o.id === "string" ? o.id : null;
        const text = typeof o.text === "string" ? o.text : null;
        if (!id || !text) return null;
        const done = o.done === true;
        const createdAt =
          typeof o.createdAt === "number" && Number.isFinite(o.createdAt)
            ? o.createdAt
            : Date.now();
        const moodRaw = typeof o.mood === "string" ? (o.mood as string) : "";
        const mood: IdeaMood | undefined =
          moodRaw === "warm" ||
          moodRaw === "cool" ||
          moodRaw === "tender" ||
          moodRaw === "dark" ||
          moodRaw === "neutral"
            ? (moodRaw as IdeaMood)
            : undefined;
        return { id, text: text.slice(0, MAX_TEXT_LEN), done, createdAt, mood };
      })
      .filter((x): x is IdeaEntry => x !== null);
  } catch {
    return [];
  }
}

export function saveIdeas(list: IdeaEntry[]): boolean {
  if (list.length === 0) {
    return tryLocalStorageRemoveItem(STORAGE_KEY_IDEAS_NOTEBOOK);
  }
  return tryLocalStorageSetItem(
    STORAGE_KEY_IDEAS_NOTEBOOK,
    JSON.stringify(list),
  );
}

export function createIdea(text: string, mood?: IdeaMood): IdeaEntry {
  return {
    id: makeId(),
    text: text.slice(0, MAX_TEXT_LEN),
    done: false,
    createdAt: Date.now(),
    mood,
  };
}

export const IDEA_TEXT_MAX = MAX_TEXT_LEN;
