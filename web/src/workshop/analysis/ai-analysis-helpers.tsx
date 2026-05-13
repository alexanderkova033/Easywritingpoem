import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AnalysisIssue, PoemAnalysis, PoemComparison } from "@/workshop/analysis/ai-analyze";
import { STORAGE_KEY_AI_MODEL, STORAGE_KEY_AI_SCORING_ENABLED } from "@/shared/storage-keys";

export const LS_KEY_MODEL = STORAGE_KEY_AI_MODEL;
export const DEFAULT_MODEL = "gpt-5-nano";
export const LEGACY_MODEL_MAP: Record<string, string> = {
  "gpt-4o-mini": "gpt-5-nano",
  "gpt-4o": "gpt-5",
};

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

export function loadStoredModel(): string {
  try {
    const raw = localStorage.getItem(LS_KEY_MODEL);
    if (!raw) return DEFAULT_MODEL;
    const migrated = LEGACY_MODEL_MAP[raw];
    if (migrated) {
      try { localStorage.setItem(LS_KEY_MODEL, migrated); } catch { /* ignore */ }
      return migrated;
    }
    return raw;
  } catch { return DEFAULT_MODEL; }
}

export function scoreColor(score: number): string {
  if (score >= 80) return "var(--ai-score-high, #5fba7d)";
  if (score >= 55) return "var(--ai-score-mid, #e6a817)";
  return "var(--ai-score-low, #d95f5f)";
}

export function scoreLabel(score: number): string {
  if (score >= 88) return "Excellent";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Solid";
  if (score >= 45) return "Developing";
  return "Needs work";
}

export const CATEGORY_RULES: { label: string; color: string; keywords: RegExp }[] = [
  { label: "Imagery",     color: "var(--ai-cat-imagery,  #9ab89a)", keywords: /imag|visual|senso|concrete|abstract|metaphor|simile|picture|vivid/i },
  { label: "Rhythm",      color: "var(--ai-cat-rhythm,   #8fc48f)", keywords: /rhythm|meter|beat|syllable|stress|iamb|anapest|trochee|spondee|cadence|pace|flow/i },
  { label: "Sound",       color: "var(--ai-cat-sound,    #b0a0d8)", keywords: /rhyme|sound|alliter|assonance|consonance|musical|echo|repeat|repetit/i },
  { label: "Word choice", color: "var(--ai-cat-word,    #d4a96a)", keywords: /word|diction|vocab|cliché|cliche|trite|vague|overwrit|purple prose|adjective|adverb/i },
  { label: "Structure",   color: "var(--ai-cat-struct,   #9fc4b4)", keywords: /structur|stanza|line break|enjamb|syntax|sentence|paragraph|openin|ending|volta|turn/i },
  { label: "Clarity",     color: "var(--ai-cat-clarity,  #c4a0a0)", keywords: /clear|clarity|confus|obscure|ambig|vague|awkward|hard to follow|understand/i },
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
