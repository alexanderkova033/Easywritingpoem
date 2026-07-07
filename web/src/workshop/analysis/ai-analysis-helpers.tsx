import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AnalysisIssue, PoemAnalysis, PoemComparison } from "@/workshop/analysis/ai-analyze";
import { STORAGE_KEY_AI_DRAFT_MODE, STORAGE_KEY_AI_SCORING_ENABLED } from "@/shared/storage-keys";

export const LS_SCORE_HISTORY_PREFIX = "easy-poems:ai-score-history:";
export const LS_LAST_HASH_PREFIX = "easy-poems:ai-last-hash:";
export const LS_CHAT_PREFIX = "easy-poems:ai-chat:";
export const LS_SNAPSHOTS_PREFIX = "easy-poems:ai-snapshots:";
export const MAX_SNAPSHOTS = 3;
export const MAX_SCORE_HISTORY = 15;

/** Wrap occurrences of the issue's problem_words inside rationale text in a
 * lightly-tinted <mark>. Word-boundary matched, case-insensitive. */
export function renderRationaleWithMarks(text: string, problemWords?: string[]): ReactNode {
  if (!problemWords || problemWords.length === 0) return text;
  const escaped = problemWords
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return text;
  const re = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<mark key={key++} className="ai-rationale-mark">{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function hashInput(input: string): string {
  // 53-bit cyrb53 — collision-resistant enough for "did the input change".
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function loadLastHash(poemId?: string): string | null {
  if (!poemId) return null;
  try { return localStorage.getItem(LS_LAST_HASH_PREFIX + poemId); }
  catch { return null; }
}

export function saveLastHash(poemId: string | undefined, hash: string) {
  if (!poemId) return;
  try { localStorage.setItem(LS_LAST_HASH_PREFIX + poemId, hash); } catch { /* ignore */ }
}

export interface AnalysisSnapshot {
  analyzedAt: string;
  overall_score: number;
  summary?: string;
  issuesCount: number;
  /** Full result for restoration. */
  result: PoemAnalysis | PoemComparison;
}

export function loadSnapshots(poemId?: string): AnalysisSnapshot[] {
  if (!poemId) return [];
  try {
    const raw = localStorage.getItem(LS_SNAPSHOTS_PREFIX + poemId);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr as AnalysisSnapshot[];
  } catch { return []; }
}

export function pushSnapshot(poemId: string | undefined, result: PoemAnalysis | PoemComparison) {
  if (!poemId) return;
  const existing = loadSnapshots(poemId);
  const snap: AnalysisSnapshot = {
    analyzedAt: result.meta.analyzedAt,
    overall_score: result.overall_score,
    summary: result.summary,
    issuesCount: result.issues.length,
    result,
  };
  const next = [snap, ...existing.filter((s) => s.analyzedAt !== snap.analyzedAt)].slice(0, MAX_SNAPSHOTS);
  try { localStorage.setItem(LS_SNAPSHOTS_PREFIX + poemId, JSON.stringify(next)); } catch { /* ignore */ }
}

export interface StoredChatMessage { role: "user" | "assistant"; text: string; }

export function loadChat(poemId?: string): StoredChatMessage[] {
  if (!poemId) return [];
  try {
    const raw = localStorage.getItem(LS_CHAT_PREFIX + poemId);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return (arr as Record<string, unknown>[])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
      .map((m) => ({ role: m.role as "user" | "assistant", text: m.text as string }));
  } catch { return []; }
}

export function saveChat(poemId: string | undefined, msgs: StoredChatMessage[]) {
  if (!poemId) return;
  try {
    if (msgs.length === 0) localStorage.removeItem(LS_CHAT_PREFIX + poemId);
    else localStorage.setItem(LS_CHAT_PREFIX + poemId, JSON.stringify(msgs));
  } catch { /* ignore */ }
}

export function loadScoreHistory(poemId?: string): number[] {
  if (!poemId) return [];
  try {
    const raw = localStorage.getItem(LS_SCORE_HISTORY_PREFIX + poemId);
    if (!raw) return [];
    return JSON.parse(raw) as number[];
  } catch { return []; }
}

export function appendScoreHistory(poemId: string | undefined, score: number): number[] {
  const history = loadScoreHistory(poemId);
  const next = [...history, score].slice(-MAX_SCORE_HISTORY);
  if (!poemId) return next;
  try { localStorage.setItem(LS_SCORE_HISTORY_PREFIX + poemId, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function loadScoringEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AI_SCORING_ENABLED);
    if (raw === "0" || raw === "false") return false;
  } catch { /* ignore */ }
  return true;
}

/** Draft mode hides the score and the issues list for a quieter, judgment-free read. */
export function loadDraftMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_AI_DRAFT_MODE) === "1";
  } catch { /* ignore */ }
  return false;
}

/** Smooth red→green color for a score on a 0..scale range (default 0-100).
 *  Pure HSL hue interpolation: 0=red, midpoint=yellow, scale=green. Saturation
 *  and lightness are fixed at values that read cleanly on both light and dark
 *  backgrounds, so no theme-aware branching is needed. */
export function scoreColor(score: number, scale: number = 100): string {
  const clamped = Math.max(0, Math.min(scale, score));
  const hue = (clamped / scale) * 120;
  return `hsl(${hue.toFixed(0)}, 50%, 52%)`;
}

export function scoreLabel(score: number): string {
  if (score >= 88) return "Excellent";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Solid";
  if (score >= 45) return "Taking shape";
  return "Early draft";
}

// Pillar-aligned categories: each issue is tagged with the pillar it most relates to.
// Order matters — narrow patterns (Chord/Echo) match before the broader Spark, which
// matches before the catch-all Craft. Tune carefully when changing.
export const CATEGORY_RULES: { label: string; color: string; keywords: RegExp }[] = [
  // Chord — issues about the opening / first impression / how the poem starts pulling.
  { label: "Chord", color: "var(--ai-cat-chord, #b0a0d8)", keywords: /opening|first line|first lines|first stanza|first impression|first beat|hook|how the poem begins/i },
  // Echo — issues about closure / ending / what stays after the read.
  { label: "Echo",  color: "var(--ai-cat-echo,  #c4a0a0)", keywords: /closure|landing|ending|\bclose\b|final line|last line|last stanza|resolution|residue|stays|after.*read|memorab|resonan|aftertaste|lingerin/i },
  // Spark — distinctiveness OR insight: cliché, stock imagery, lack of surprise, weak observation.
  { label: "Spark", color: "var(--ai-cat-spark, #d4a96a)", keywords: /cliché|cliche|received|stale|stock|familiar|derivative|expected|predictable|trite|abstract emotional|generic|imag|metaphor|simile|vivid|surpris|insight|observ|paradox|inversion|sardonic|fresh|novel/i },
  // Craft — catch-all for technique: rhythm, syntax, sound, word choice, structure, clarity.
  { label: "Craft", color: "var(--ai-cat-craft, #9ab89a)", keywords: /rhythm|meter|beat|syllable|stress|iamb|anapest|trochee|spondee|cadence|pace|flow|line break|enjamb|syntax|sentence|stanza|structur|rhyme|alliter|assonance|consonance|word|diction|vocab|clarity|confus|obscure|ambig|awkward|hard to follow|grammar|punctuation|repeat|repetit|overwrit|purple prose/i },
];

export function deriveCategory(issue: AnalysisIssue): { label: string; color: string } | null {
  const text = `${issue.rationale} ${issue.improvements.join(" ")}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.test(text)) return { label: rule.label, color: rule.color };
  }
  return null;
}

export function severityColor(s?: "high" | "medium" | "low"): string {
  if (s === "high") return "var(--ai-score-low, #d95f5f)";
  if (s === "medium") return "var(--ai-score-mid, #e6a817)";
  return "var(--border)";
}

export function useCopyFlash() {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = useCallback((text: string, idx: number) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopiedIdx(null), 1500);
    });
  }, []);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return { copiedIdx, copy };
}
