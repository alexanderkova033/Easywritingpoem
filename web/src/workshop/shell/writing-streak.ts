/**
 * Lightweight writing-streak tracker — fully local. No analytics, no server.
 * Counts consecutive days the user has touched the editor with non-empty
 * content. Updates at most once per day. Used as a subtle landing-page badge.
 */

const LS_KEY = "easy-poems:streak:v1";

interface StreakState {
  /** ISO yyyy-mm-dd of the last day a write was recorded. */
  lastDay: string;
  /** Consecutive-day count ending on lastDay. */
  count: number;
  /** All-time best. */
  best: number;
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map((n) => parseInt(n, 10));
  const [yb, mb, db] = b.split("-").map((n) => parseInt(n, 10));
  const ta = Date.UTC(ya!, (ma ?? 1) - 1, da ?? 1);
  const tb = Date.UTC(yb!, (mb ?? 1) - 1, db ?? 1);
  return Math.round((tb - ta) / 86_400_000);
}

function readState(): StreakState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StreakState>;
    if (typeof v.lastDay !== "string" || typeof v.count !== "number") return null;
    return {
      lastDay: v.lastDay,
      count: Math.max(0, Math.floor(v.count)),
      best: Math.max(0, Math.floor(v.best ?? v.count)),
    };
  } catch { return null; }
}

function writeState(s: StreakState): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/** Record a write today. Idempotent within a calendar day. */
export function recordWriteToday(): StreakState {
  const today = todayKey();
  const prev = readState();
  if (!prev) {
    const s: StreakState = { lastDay: today, count: 1, best: 1 };
    writeState(s);
    return s;
  }
  if (prev.lastDay === today) return prev;
  const gap = daysBetween(prev.lastDay, today);
  const count = gap === 1 ? prev.count + 1 : 1;
  const best = Math.max(prev.best, count);
  const next: StreakState = { lastDay: today, count, best };
  writeState(next);
  return next;
}

/** Read current streak — returns 0 if last write was >1 day ago. */
export function getCurrentStreak(): { count: number; best: number } {
  const s = readState();
  if (!s) return { count: 0, best: 0 };
  const today = todayKey();
  const gap = daysBetween(s.lastDay, today);
  if (gap > 1) return { count: 0, best: s.best };
  return { count: s.count, best: s.best };
}

/* ---- Daily prompt — deterministic, rotates by date ---- */

const PROMPTS: string[] = [
  "Write about a smell you didn't know you remembered.",
  "Begin a poem with a single colour.",
  "Describe a window you've spent time looking out of.",
  "Write a small praise of a tool or object you use daily.",
  "Open with weather. End somewhere private.",
  "Use the word \"nearly\" three times.",
  "A sound you only hear when alone.",
  "Address a poem to someone you'll never speak to again.",
  "Write the moment before something changes.",
  "Begin: \"Today I forgave…\"",
  "A small lie, told kindly.",
  "What does Sunday taste like?",
  "Three things on the kitchen table, and what they mean.",
  "Write a poem that ends with a question.",
  "A weather report from inside your chest.",
  "Re-imagine an ordinary route as if walked for the last time.",
  "What the dog knows that you don't.",
  "Begin with the sentence you almost sent.",
  "A landscape made of things you've owned.",
  "Open with light. Close with weight.",
];

/**
 * Today's prompt — same all day for the same user (deterministic by yyyy-mm-dd
 * hash). Rotates daily.
 */
export function getDailyPrompt(): string {
  const today = todayKey();
  let h = 0;
  for (let i = 0; i < today.length; i++) h = (h * 31 + today.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % PROMPTS.length;
  return PROMPTS[idx]!;
}
