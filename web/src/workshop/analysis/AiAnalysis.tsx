import "./AiAnalysis.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  analyzePoem,
  comparePoem,
  type AnalysisIssue,
  type ComparisonChanges,
  type HarshnessLevel,
  type LocalAnalysisContext,
  type PoemAnalysis,
  type PoemComparison,
} from "@/workshop/analysis/ai-analyze";
import type { WorkshopGoals } from "@/workshop/library/workshop-goals";
import { computeVoiceFingerprint } from "@/workshop/analysis/voice-fingerprint";
import { tryLocalStorageSetItem } from "@/shared/platform/browser-storage";
import { STORAGE_KEY_AI_MODEL, STORAGE_KEY_AI_SCORING_ENABLED } from "@/shared/storage-keys";
import { parseAiErrorAndNotify } from "@/workshop/ai-cost/aiBudgetBus";

const LS_KEY_MODEL = STORAGE_KEY_AI_MODEL;
const DEFAULT_MODEL = "gpt-5-nano";
const LEGACY_MODEL_MAP: Record<string, string> = {
  "gpt-4o-mini": "gpt-5-nano",
  "gpt-4o": "gpt-5",
};

// ---- last analysis per poem ---- //
const LS_LAST_ANALYSIS_PREFIX = "easy-poems:ai-last:";
const LS_RESOLVED_PREFIX = "easy-poems:ai-resolved:";
const LS_IGNORED_PREFIX = "easy-poems:ai-ignored:";
const LS_SCORE_HISTORY_PREFIX = "easy-poems:ai-score-history:";
const LS_LAST_HASH_PREFIX = "easy-poems:ai-last-hash:";
const LS_CHAT_PREFIX = "easy-poems:ai-chat:";
const LS_SNAPSHOTS_PREFIX = "easy-poems:ai-snapshots:";
const MAX_SNAPSHOTS = 3;

/** Wrap occurrences of the issue's problem_words inside rationale text in a
 * lightly-tinted <mark>. Word-boundary matched, case-insensitive. */
function renderRationaleWithMarks(text: string, problemWords?: string[]): ReactNode {
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

function hashInput(input: string): string {
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

function loadLastHash(poemId?: string): string | null {
  if (!poemId) return null;
  try { return localStorage.getItem(LS_LAST_HASH_PREFIX + poemId); }
  catch { return null; }
}

function saveLastHash(poemId: string | undefined, hash: string) {
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

function loadSnapshots(poemId?: string): AnalysisSnapshot[] {
  if (!poemId) return [];
  try {
    const raw = localStorage.getItem(LS_SNAPSHOTS_PREFIX + poemId);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr as AnalysisSnapshot[];
  } catch { return []; }
}

function pushSnapshot(poemId: string | undefined, result: PoemAnalysis | PoemComparison) {
  if (!poemId) return;
  const existing = loadSnapshots(poemId);
  const snap: AnalysisSnapshot = {
    analyzedAt: result.meta.analyzedAt,
    overall_score: result.overall_score,
    summary: result.summary,
    issuesCount: result.issues.length,
    result,
  };
  // Avoid duplicate snapshots when nothing changed (same analyzedAt rare but possible).
  const next = [snap, ...existing.filter((s) => s.analyzedAt !== snap.analyzedAt)].slice(0, MAX_SNAPSHOTS);
  try { localStorage.setItem(LS_SNAPSHOTS_PREFIX + poemId, JSON.stringify(next)); } catch { /* ignore */ }
}

interface StoredChatMessage { role: "user" | "assistant"; text: string; }

function loadChat(poemId?: string): StoredChatMessage[] {
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

function saveChat(poemId: string | undefined, msgs: StoredChatMessage[]) {
  if (!poemId) return;
  try {
    if (msgs.length === 0) localStorage.removeItem(LS_CHAT_PREFIX + poemId);
    else localStorage.setItem(LS_CHAT_PREFIX + poemId, JSON.stringify(msgs));
  } catch { /* ignore */ }
}

export function loadLastAnalysis(poemId?: string): PoemAnalysis | null {
  if (!poemId) return null;
  try {
    const raw = localStorage.getItem(LS_LAST_ANALYSIS_PREFIX + poemId);
    if (!raw) return null;
    return JSON.parse(raw) as PoemAnalysis;
  } catch { return null; }
}

function saveLastAnalysis(poemId: string | undefined, analysis: PoemAnalysis) {
  if (!poemId) return;
  try { localStorage.setItem(LS_LAST_ANALYSIS_PREFIX + poemId, JSON.stringify(analysis)); }
  catch { /* storage full */ }
}

function loadIdSet(prefix: string, poemId?: string): Set<string> {
  if (!poemId) return new Set();
  try {
    const raw = localStorage.getItem(prefix + poemId);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((x) => String(x)));
  } catch { return new Set(); }
}

function saveIdSet(prefix: string, poemId: string | undefined, set: Set<string>) {
  if (!poemId) return;
  try {
    if (set.size === 0) localStorage.removeItem(prefix + poemId);
    else localStorage.setItem(prefix + poemId, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

export function loadIgnoredIssueIds(poemId?: string): Set<string> {
  return loadIdSet(LS_IGNORED_PREFIX, poemId);
}

// ---- score history (per poem) ---- //
const MAX_SCORE_HISTORY = 15;

function loadScoreHistory(poemId?: string): number[] {
  if (!poemId) return [];
  try {
    const raw = localStorage.getItem(LS_SCORE_HISTORY_PREFIX + poemId);
    if (!raw) return [];
    return JSON.parse(raw) as number[];
  } catch { return []; }
}

function appendScoreHistory(poemId: string | undefined, score: number): number[] {
  const history = loadScoreHistory(poemId);
  const next = [...history, score].slice(-MAX_SCORE_HISTORY);
  if (!poemId) return next;
  try { localStorage.setItem(LS_SCORE_HISTORY_PREFIX + poemId, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

function loadScoringEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AI_SCORING_ENABLED);
    if (raw === "0" || raw === "false") return false;
  } catch { /* ignore */ }
  return true;
}

function loadStoredModel(): string {
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

// ---- score helpers ---- //
function scoreColor(score: number): string {
  if (score >= 80) return "var(--ai-score-high, #5fba7d)";
  if (score >= 55) return "var(--ai-score-mid, #e6a817)";
  return "var(--ai-score-low, #d95f5f)";
}

function scoreLabel(score: number): string {
  if (score >= 88) return "Excellent";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Solid";
  if (score >= 45) return "Developing";
  return "Needs work";
}

function ScoreSparkline({ history }: { history: number[] }) {
  if (history.length < 2) return null;
  const w = 120;
  const h = 28;
  const pad = 2;
  const xs = history.length;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = Math.max(1, max - min);
  const dx = (w - pad * 2) / (xs - 1);
  const points = history.map((v, i) => {
    const x = pad + i * dx;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${path} L${points[points.length - 1]![0].toFixed(1)},${h - pad} L${pad},${h - pad} Z`;
  const last = history[history.length - 1]!;
  const prev = history[history.length - 2]!;
  const delta = last - prev;
  const trendColor = delta > 0
    ? "var(--ai-score-high, #5fba7d)"
    : delta < 0
      ? "var(--ai-score-low, #d95f5f)"
      : "var(--muted)";
  return (
    <div className="ai-score-spark" title={`Score history: ${history.join(" → ")}`}>
      <svg className="ai-score-spark-svg" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <path d={area} fill={trendColor} fillOpacity="0.18" />
        <path d={path} fill="none" stroke={trendColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === points.length - 1 ? 2.4 : 1.4} fill={trendColor} />
        ))}
      </svg>
      <span className="ai-score-spark-delta" style={{ color: trendColor }}>
        {delta > 0 ? `↑ ${delta}` : delta < 0 ? `↓ ${Math.abs(delta)}` : "·"}
      </span>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const color = scoreColor(score);
  const offset = circ - (score / 100) * circ;
  return (
    <svg className="ai-score-ring" viewBox="0 0 76 76" aria-hidden>
      <circle cx="38" cy="38" r={r} fill="none"
        stroke="color-mix(in srgb, currentColor 10%, transparent)" strokeWidth="6" />
      <circle cx="38" cy="38" r={r} fill="none"
        stroke={color} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 38 38)"
        className="ai-score-arc"
      />
    </svg>
  );
}

// ---- issue category derivation ---- //
const CATEGORY_RULES: { label: string; color: string; keywords: RegExp }[] = [
  { label: "Imagery",     color: "var(--ai-cat-imagery,  #9ab89a)", keywords: /imag|visual|senso|concrete|abstract|metaphor|simile|picture|vivid/i },
  { label: "Rhythm",      color: "var(--ai-cat-rhythm,   #8fc48f)", keywords: /rhythm|meter|beat|syllable|stress|iamb|anapest|trochee|spondee|cadence|pace|flow/i },
  { label: "Sound",       color: "var(--ai-cat-sound,    #b0a0d8)", keywords: /rhyme|sound|alliter|assonance|consonance|musical|echo|repeat|repetit/i },
  { label: "Word choice", color: "var(--ai-cat-word,    #d4a96a)", keywords: /word|diction|vocab|cliché|cliche|trite|vague|overwrit|purple prose|adjective|adverb/i },
  { label: "Structure",   color: "var(--ai-cat-struct,   #9fc4b4)", keywords: /structur|stanza|line break|enjamb|syntax|sentence|paragraph|openin|ending|volta|turn/i },
  { label: "Clarity",     color: "var(--ai-cat-clarity,  #c4a0a0)", keywords: /clear|clarity|confus|obscure|ambig|vague|awkward|hard to follow|understand/i },
];

function deriveCategory(issue: AnalysisIssue): { label: string; color: string } | null {
  const text = `${issue.rationale} ${issue.improvements.join(" ")}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.test(text)) return { label: rule.label, color: rule.color };
  }
  return null;
}

function severityColor(s?: "high" | "medium" | "low"): string {
  if (s === "high") return "var(--ai-score-low, #d95f5f)";
  if (s === "medium") return "var(--ai-score-mid, #e6a817)";
  return "var(--border)";
}

// ---- copy-to-clipboard hook ---- //
function useCopyFlash() {
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

// ---- per-issue mini chat ---- //
interface IssueChatMessage { role: "user" | "assistant"; text: string; }

function IssueThread({
  issue, poemTitle, poemLines, model,
}: {
  issue: AnalysisIssue;
  poemTitle: string;
  poemLines: string[];
  model: string;
}) {
  const [messages, setMessages] = useState<IssueChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rangeLabel = issue.line_start === issue.line_end
    ? `line ${issue.line_start}` : `lines ${issue.line_start}–${issue.line_end}`;
  const issueContext = [
    `Feedback about ${rangeLabel}: ${issue.rationale}`,
    issue.excerpt ? `Excerpt: "${issue.excerpt}"` : "",
    issue.problem_words?.length ? `Weak words: ${issue.problem_words.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const priorHistory = messages.map((m) => ({ role: m.role, content: m.text }));
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: poemTitle,
          lines: poemLines,
          message: text,
          analysisContext: issueContext,
          history: priorHistory,
          model,
        }),
      });
      if (!res.ok) {
        const { message } = await parseAiErrorAndNotify(res, "chat");
        throw new Error(message);
      }
      const d = (await res.json()) as { reply?: string };
      setMessages((prev) => [...prev, { role: "assistant", text: d.reply ?? "No response." }]);
      setTimeout(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
      }, 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, poemTitle, poemLines, issueContext, model]);

  return (
    <div className="ai-issue-thread">
      {messages.length > 0 && (
        <div className="ai-issue-thread-msgs" ref={listRef}>
          {messages.map((msg, i) => (
            <div key={i} className={`ai-chat-msg ai-chat-msg-${msg.role}`}>
              <span className="ai-chat-msg-role">{msg.role === "user" ? "You" : "AI"}</span>
              <span className="ai-chat-msg-text">{msg.text}</span>
            </div>
          ))}
          {loading && (
            <div className="ai-chat-msg ai-chat-msg-assistant ai-chat-msg-loading">
              <span className="ai-chat-msg-role">AI</span>
              <span className="ai-chat-dot" /><span className="ai-chat-dot" /><span className="ai-chat-dot" />
            </div>
          )}
        </div>
      )}
      {error && <p className="ai-chat-error">{error}</p>}
      <div className="ai-chat-input-row">
        <textarea
          ref={inputRef}
          className="ai-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about this issue…`}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
          }}
        />
        <button
          type="button"
          className="small-btn small-btn-primary ai-chat-send"
          onClick={() => void handleSend()}
          disabled={!input.trim() || loading}
        >
          {loading ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

function IssueCard({
  issue, index, isOpen, onOpenChange, isResolved, onResolve, onIgnore,
  onJump, onHighlight, onClearHighlight, onApplyLine, poemLines, poemTitle, model,
}: {
  issue: AnalysisIssue;
  index: number;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isResolved: boolean;
  onResolve: (resolved: boolean) => void;
  onIgnore: () => void;
  onJump?: (line: number) => void;
  onHighlight?: (start: number, end: number, severity?: string) => void;
  onClearHighlight?: () => void;
  onApplyLine?: (lineStart: number, lineEnd: number, text: string) => void;
  poemLines?: string[];
  poemTitle?: string;
  model?: string;
}) {
  const rangeLabel = issue.line_start === issue.line_end
    ? `Line ${issue.line_start}`
    : `Lines ${issue.line_start}–${issue.line_end}`;
  const cat = deriveCategory(issue);
  const sevColor = severityColor(issue.severity);
  const { copiedIdx, copy } = useCopyFlash();
  const [showThread, setShowThread] = useState(false);
  const [previewRewrite, setPreviewRewrite] = useState(false);
  const [showRewrite, setShowRewrite] = useState(false);

  const originalLineText = poemLines
    ? poemLines.slice(issue.line_start - 1, issue.line_end).join("\n")
    : null;

  const triggerHighlight = () => {
    if (!isResolved) onHighlight?.(issue.line_start, issue.line_end, issue.severity);
  };

  return (
    <div
      className={`ai-issue ai-issue-sev-${issue.severity ?? "low"}${isResolved ? " is-resolved" : ""}${issue.confidence === "low" ? " ai-issue-conf-low" : ""}`}
      data-issue-id={issue.id}
      style={{ borderLeftColor: isResolved ? "var(--border)" : sevColor }}
      onMouseEnter={triggerHighlight}
      onMouseLeave={() => onClearHighlight?.()}
    >
      {/* Header row — clicking toggles open */}
      <div
        className="ai-issue-head"
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={() => {
          const next = !isOpen;
          onOpenChange(next);
          if (next) triggerHighlight();
          else onClearHighlight?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            const next = !isOpen;
            onOpenChange(next);
            if (next) triggerHighlight();
            else onClearHighlight?.();
          }
        }}
      >
        <span className="ai-issue-num" style={{ background: isResolved ? "var(--muted)" : sevColor }}>
          {isResolved ? "✓" : index + 1}
        </span>
        <span className="ai-issue-head-inner">
          {!isResolved && (
            <span
              className={`ai-issue-sev-dot ai-issue-sev-dot-${issue.severity ?? "low"}`}
              aria-hidden
            />
          )}
          {!isResolved && issue.confidence === "low" && (
            <span className="ai-issue-conf-pill" title="Low confidence — taste call you may reasonably reject">
              taste
            </span>
          )}
          {onJump && !isResolved ? (
            <button type="button" className="ai-issue-line linkish"
              onClick={(e) => { e.stopPropagation(); onJump(issue.line_start); triggerHighlight(); }}
              title={`Jump to line ${issue.line_start}`}>
              {rangeLabel}
            </button>
          ) : <span className="ai-issue-line">{rangeLabel}</span>}
          {cat && !isResolved && (
            <span className="ai-issue-cat" style={{ borderColor: cat.color, color: cat.color }}>
              {cat.label}
            </span>
          )}
          {!isResolved && (issue.headline
            ? <span className="ai-issue-headline">{issue.headline}</span>
            : issue.excerpt
              ? <span className="ai-issue-excerpt">&ldquo;{issue.excerpt}&rdquo;</span>
              : null)}
          {isResolved && <span className="ai-issue-resolved-label">Addressed</span>}
        </span>
        <div className="ai-issue-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`ai-resolve-btn${isResolved ? " is-resolved" : ""}`}
            title={isResolved ? "Undo — mark as not resolved" : "Mark as resolved"}
            onClick={() => { onResolve(!isResolved); if (!isResolved) onClearHighlight?.(); }}
            aria-label={isResolved ? "Undo resolved" : "Mark resolved"}
          >
            {isResolved ? "↩" : "✓"}
          </button>
          <button
            type="button"
            className="ai-ignore-btn"
            title="Ignore this issue"
            onClick={() => { onIgnore(); onClearHighlight?.(); }}
            aria-label="Ignore issue"
          >
            ✕
          </button>
          <span className="ai-issue-chevron" aria-hidden style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
        </div>
      </div>

      {/* Expandable body */}
      {isOpen && (
        <div className="ai-issue-body">
          {issue.problem_words && issue.problem_words.length > 0 && (
            <div className="ai-problem-words">
              {issue.problem_words.map((w, i) => (
                <span key={i} className="ai-problem-word">&ldquo;{w}&rdquo;</span>
              ))}
            </div>
          )}
          {issue.rationale && (
            <p className="ai-issue-rationale">
              {renderRationaleWithMarks(issue.rationale, issue.problem_words)}
            </p>
          )}
          {issue.rewrite && (
            <div className={`ai-issue-rewrite ai-issue-rewrite-compact${showRewrite ? " is-expanded" : ""}`}>
              {!showRewrite && !previewRewrite ? (
                <button
                  type="button"
                  className="ai-rewrite-pill"
                  onClick={() => setShowRewrite(true)}
                  title="Show the model's suggested rewrite"
                >
                  <span className="ai-rewrite-pill-icon" aria-hidden>✏</span>
                  <span className="ai-rewrite-pill-label">Suggested rewrite</span>
                  <span className="ai-rewrite-pill-chev" aria-hidden>›</span>
                </button>
              ) : previewRewrite && originalLineText !== null ? (
                <div className="ai-rewrite-preview">
                  <div className="ai-rewrite-preview-side">
                    <span className="ai-rewrite-preview-label">Before</span>
                    <pre className="ai-rewrite-preview-text ai-rewrite-preview-old">{originalLineText}</pre>
                  </div>
                  <div className="ai-rewrite-preview-side">
                    <span className="ai-rewrite-preview-label">After</span>
                    <pre className="ai-rewrite-preview-text ai-rewrite-preview-new">{issue.rewrite}</pre>
                  </div>
                  <div className="ai-rewrite-preview-actions">
                    <button
                      type="button"
                      className="small-btn small-btn-primary ai-apply-rewrite-btn"
                      onClick={() => {
                        onApplyLine?.(issue.line_start, issue.line_end, issue.rewrite!);
                        onResolve(true);
                        setPreviewRewrite(false);
                        setShowRewrite(false);
                      }}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      className="small-btn ai-apply-rewrite-btn"
                      onClick={() => setPreviewRewrite(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="ai-rewrite-expanded">
                  <span className="ai-rewrite-label">
                    <span className="ai-rewrite-pill-icon" aria-hidden>✏</span> Suggested rewrite
                    <button
                      type="button"
                      className="ai-rewrite-collapse-btn"
                      onClick={() => setShowRewrite(false)}
                      aria-label="Hide rewrite"
                    >
                      ✕
                    </button>
                  </span>
                  <blockquote className="ai-rewrite-text">{issue.rewrite}</blockquote>
                  <div className="ai-rewrite-actions">
                    {onApplyLine && (
                      <button
                        type="button"
                        className="small-btn small-btn-primary ai-apply-rewrite-btn"
                        title="Apply the rewrite to the line"
                        onClick={() => setPreviewRewrite(true)}
                      >
                        Preview & apply
                      </button>
                    )}
                    <button
                      type="button"
                      className={`ai-copy-btn${copiedIdx === 99 ? " is-copied" : ""}`}
                      title="Copy rewrite"
                      onClick={() => copy(issue.rewrite!, 99)}
                      aria-label="Copy rewrite to clipboard"
                    >
                      {copiedIdx === 99 ? "✓" : "⎘"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Per-issue thread toggle */}
          {poemLines && poemTitle !== undefined && model && (
            <div className="ai-issue-thread-toggle-row">
              <button
                type="button"
                className="ai-issue-thread-toggle-btn"
                onClick={() => setShowThread((v) => !v)}
              >
                {showThread ? "Close chat" : "Ask about this"}
                <span className="ai-issue-chevron" aria-hidden style={{ transform: showThread ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
              </button>
            </div>
          )}

          {showThread && poemLines && poemTitle !== undefined && model && (
            <IssueThread
              issue={issue}
              poemTitle={poemTitle}
              poemLines={poemLines}
              model={model}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CompareCelebration({
  cmp, scoreDelta, dismissed, onDismiss,
}: {
  cmp: ComparisonChanges;
  scoreDelta: number;
  dismissed: boolean;
  onDismiss: () => void;
}) {
  if (dismissed) return null;
  const isWin = scoreDelta > 0 || cmp.improvements.length > cmp.regressions.length;
  const isLoss = scoreDelta < 0 && cmp.regressions.length > cmp.improvements.length;
  const tone = isWin ? "win" : isLoss ? "loss" : "neutral";
  return (
    <div className={`ai-cmp-toast ai-cmp-toast-${tone}`} role="status">
      <span className="ai-cmp-toast-icon" aria-hidden>{isWin ? "▲" : isLoss ? "▼" : "·"}</span>
      <div className="ai-cmp-toast-body">
        <div className="ai-cmp-toast-head">
          {scoreDelta !== 0 && (
            <span className="ai-cmp-toast-delta">
              {scoreDelta > 0 ? `+${scoreDelta}` : scoreDelta} score
            </span>
          )}
          <span className="ai-cmp-toast-summary">
            {isWin ? "Revision lifted the poem." : isLoss ? "Some craft moves regressed." : "Mixed revision."}
          </span>
        </div>
        {cmp.improvements.length > 0 && (
          <ul className="ai-cmp-toast-list ai-cmp-toast-improvements">
            {cmp.improvements.slice(0, 3).map((s, i) => <li key={i}>✓ {s}</li>)}
          </ul>
        )}
        {cmp.regressions.length > 0 && (
          <ul className="ai-cmp-toast-list ai-cmp-toast-regressions">
            {cmp.regressions.slice(0, 2).map((s, i) => <li key={i}>↓ {s}</li>)}
          </ul>
        )}
      </div>
      <button type="button" className="ai-cmp-toast-close" onClick={onDismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}

function ComparisonPanel({ cmp }: { cmp: ComparisonChanges }) {
  return (
    <div className="ai-comparison">
      {cmp.summary && <p className="ai-compare-summary">{cmp.summary}</p>}
      {cmp.improvements.length > 0 && (
        <div className="ai-compare-group ai-compare-improved">
          <span className="ai-compare-group-label">Improved</span>
          <ul>{cmp.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
      {cmp.regressions.length > 0 && (
        <div className="ai-compare-group ai-compare-regressed">
          <span className="ai-compare-group-label">Watch out</span>
          <ul>{cmp.regressions.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
      {cmp.unchanged.length > 0 && (
        <div className="ai-compare-group ai-compare-unchanged">
          <span className="ai-compare-group-label">Still strong</span>
          <ul>{cmp.unchanged.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

type AnalysisTab = "overview" | "issues" | "chat";

function AnalysisResults({
  result, onJump, onPeek, onHighlight, onClearHighlight, onApplyLine, poemLines, poemTitle, model,
  poemId, onVisibleIssuesChange, openIssueLineSignal, scoringEnabled,
  activeTab, onTabChange, externalTabSignal, scoreHistory, localAnalysis,
}: {
  result: PoemAnalysis | PoemComparison;
  previous?: PoemAnalysis | null;
  onJump?: (line: number) => void;
  /** Soft scroll-into-view without focus/cursor change. */
  onPeek?: (line: number) => void;
  onHighlight?: (start: number, end: number, severity?: string) => void;
  onClearHighlight?: () => void;
  scoreHistory?: number[];
  onApplyLine?: (lineStart: number, lineEnd: number, text: string) => void;
  poemLines?: string[];
  poemTitle?: string;
  model?: string;
  poemId?: string;
  onVisibleIssuesChange?: (issues: AnalysisIssue[]) => void;
  openIssueLineSignal?: { line: number; nonce: number; scroll?: boolean } | null;
  scoringEnabled?: boolean;
  activeTab?: AnalysisTab;
  onTabChange?: (t: AnalysisTab) => void;
  externalTabSignal?: { tab: AnalysisTab; nonce: number } | null;
  localAnalysis?: LocalAnalysisContext;
}) {
  const isCompare = "comparison" in result;

  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => loadIdSet(LS_RESOLVED_PREFIX, poemId));
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(() => loadIdSet(LS_IGNORED_PREFIX, poemId));
  const [showIgnored, setShowIgnored] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [internalTab, setInternalTab] = useState<AnalysisTab>("overview");
  const [overallExpanded, setOverallExpanded] = useState(false);
  const [personalExpanded, setPersonalExpanded] = useState(false);
  // Voice fingerprint — recomputed when this analysis result changes (cheap,
  // local-only). Skipped if writer has fewer than 3 substantive poems.
  const voiceFingerprint = useMemo(
    () => computeVoiceFingerprint(),
    [result.meta.analyzedAt],
  );
  const [cmpToastDismissed, setCmpToastDismissed] = useState(false);
  const lastResultIdRef = useRef<string | null>(null);
  // Reset dismissal whenever a new compare result arrives.
  useEffect(() => {
    const id = result.meta.analyzedAt;
    if (lastResultIdRef.current !== id) {
      lastResultIdRef.current = id;
      setCmpToastDismissed(false);
    }
  }, [result.meta.analyzedAt]);
  const tab = activeTab ?? internalTab;
  const setTab = (t: AnalysisTab) => {
    if (onTabChange) onTabChange(t); else setInternalTab(t);
  };
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeSeverity, setActiveSeverity] = useState<"high" | "medium" | "low" | null>(null);

  // External request to switch tabs (e.g. from editor popover).
  useEffect(() => {
    if (!externalTabSignal) return;
    setTab(externalTabSignal.tab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTabSignal?.nonce]);

  // Persist resolved/ignored across reloads — drop entries that no longer
  // match an issue in the current analysis to avoid stale junk accumulating.
  useEffect(() => { saveIdSet(LS_RESOLVED_PREFIX, poemId, resolvedIds); }, [poemId, resolvedIds]);
  useEffect(() => { saveIdSet(LS_IGNORED_PREFIX, poemId, ignoredIds); }, [poemId, ignoredIds]);

  const visibleIssues = useMemo(() => {
    const strongestLineNo = result.strongest_line?.line;
    return result.issues.filter((i) => {
      if (ignoredIds.has(i.id)) return false;
      // Don't critique a line that the same analysis flagged as strongest.
      if (strongestLineNo != null && i.line_start === strongestLineNo && i.line_end === strongestLineNo) return false;
      return true;
    });
  }, [result.issues, result.strongest_line, ignoredIds]);

  // Notify parent so editor highlights/gutter dots can drop ignored issues.
  useEffect(() => {
    onVisibleIssuesChange?.(visibleIssues);
  }, [visibleIssues, onVisibleIssuesChange]);

  // Editor → panel: when a gutter dot is clicked or the cursor parks on a
  // flagged line, open the matching issue. Only scroll/switch tab when the
  // signal explicitly asks for it (gutter dot click). Cursor-park opens the
  // card silently so the user doesn't get yanked down while editing.
  useEffect(() => {
    if (!openIssueLineSignal) return;
    const { line, scroll } = openIssueLineSignal;
    const match = visibleIssues.find((iss) => line >= iss.line_start && line <= iss.line_end);
    if (!match) return;
    setOpenIds((prev) => {
      if (prev.has(match.id)) return prev;
      const s = new Set(prev);
      s.add(match.id);
      return s;
    });
    if (scroll !== false) {
      setTab("issues");
      setActiveCategory(null);
      setActiveSeverity(null);
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-issue-id="${match.id}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIssueLineSignal, visibleIssues]);

  const totalIssues = visibleIssues.length;
  const resolvedCount = [...resolvedIds].filter((id) => !ignoredIds.has(id)).length;
  const allDone = totalIssues > 0 && resolvedCount === totalIssues;

  // Unresolved first, resolved last
  const sortedIssues = useMemo(() => [
    ...visibleIssues.filter((i) => !resolvedIds.has(i.id)),
    ...visibleIssues.filter((i) => resolvedIds.has(i.id)),
  ], [visibleIssues, resolvedIds]);

  const toggleAll = () => {
    const next = !allExpanded;
    setAllExpanded(next);
    if (next) {
      setOpenIds(new Set(visibleIssues.map((i) => i.id)));
    } else {
      setOpenIds(new Set());
    }
  };

  const handleOpenChange = (id: string, open: boolean) => {
    setOpenIds((prev) => {
      const s = new Set(prev);
      if (open) s.add(id); else s.delete(id);
      return s;
    });
  };

  const handleResolve = (id: string, resolved: boolean) => {
    setResolvedIds((prev) => {
      const s = new Set(prev);
      if (resolved) s.add(id); else s.delete(id);
      return s;
    });
    if (resolved) {
      setOpenIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const handleIgnore = (id: string) => {
    setIgnoredIds((prev) => { const s = new Set(prev); s.add(id); return s; });
    setOpenIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    setResolvedIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
  };

  // Derive category for each issue once.
  const issueCategories = useMemo(() => {
    const map = new Map<string, { label: string; color: string } | null>();
    for (const iss of result.issues) map.set(iss.id, deriveCategory(iss));
    return map;
  }, [result.issues]);

  // Build category list with counts (visible issues only).
  const categoriesWithCount = useMemo(() => {
    const counts = new Map<string, { label: string; color: string; count: number }>();
    for (const iss of visibleIssues) {
      const c = issueCategories.get(iss.id);
      if (!c) continue;
      const cur = counts.get(c.label);
      if (cur) cur.count++;
      else counts.set(c.label, { label: c.label, color: c.color, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [visibleIssues, issueCategories]);

  // Apply filter chips before grouping.
  const filteredIssues = useMemo(() => {
    return sortedIssues.filter((iss) => {
      if (activeCategory) {
        const c = issueCategories.get(iss.id);
        if (!c || c.label !== activeCategory) return false;
      }
      if (activeSeverity && iss.severity !== activeSeverity) return false;
      return true;
    });
  }, [sortedIssues, activeCategory, activeSeverity, issueCategories]);

  // Group by severity for the issues tab.
  const grouped = useMemo(() => {
    const sev: Record<"high" | "medium" | "low", AnalysisIssue[]> = { high: [], medium: [], low: [] };
    for (const iss of filteredIssues) {
      const s = (iss.severity ?? "low") as "high" | "medium" | "low";
      sev[s].push(iss);
    }
    return sev;
  }, [filteredIssues]);

  const progressPct = totalIssues > 0 ? Math.round((resolvedCount / totalIssues) * 100) : 0;
  const issuesBadge = visibleIssues.length;

  const renderIssueCard = (iss: AnalysisIssue) => (
    <IssueCard
      key={iss.id}
      issue={iss}
      index={result.issues.indexOf(iss)}
      isOpen={openIds.has(iss.id)}
      onOpenChange={(open) => {
        handleOpenChange(iss.id, open);
      }}
      isResolved={resolvedIds.has(iss.id)}
      onResolve={(resolved) => handleResolve(iss.id, resolved)}
      onIgnore={() => handleIgnore(iss.id)}
      onJump={onJump}
      onHighlight={onHighlight}
      onClearHighlight={onClearHighlight}
      onApplyLine={onApplyLine}
      poemLines={poemLines}
      poemTitle={poemTitle}
      model={model}
    />
  );

  return (
    <div className="ai-results">
      {/* Tabs */}
      <div className="ai-tabs" role="tablist" aria-label="Analysis sections">
        <button type="button" role="tab" aria-selected={tab === "overview"}
          className={`ai-tab${tab === "overview" ? " is-active" : ""}`}
          onClick={() => setTab("overview")}>
          Overview
        </button>
        <button type="button" role="tab" aria-selected={tab === "issues"}
          className={`ai-tab${tab === "issues" ? " is-active" : ""}`}
          onClick={() => setTab("issues")}>
          Issues
          {issuesBadge > 0 && (
            <span className="ai-tab-badge">{issuesBadge}</span>
          )}
        </button>
        {poemLines && poemTitle !== undefined && model && (
          <button type="button" role="tab" aria-selected={tab === "chat"}
            className={`ai-tab${tab === "chat" ? " is-active" : ""}`}
            onClick={() => setTab("chat")}>
            Chat
          </button>
        )}
        {totalIssues > 0 && (
          <div className="ai-tabs-progress" aria-label={`${resolvedCount} of ${totalIssues} issues addressed`}>
            <div className="ai-tabs-progress-bar" style={{ width: `${progressPct}%` }} />
            <span className="ai-tabs-progress-label">{resolvedCount}/{totalIssues}</span>
          </div>
        )}
      </div>

      {/* Overview tab */}
      {tab === "overview" && (
        <div className="ai-tab-panel ai-tab-overview">
          {isCompare && scoreHistory && scoreHistory.length >= 2 && (
            <CompareCelebration
              cmp={(result as PoemComparison).comparison}
              scoreDelta={result.overall_score - (scoreHistory[scoreHistory.length - 2] ?? result.overall_score)}
              dismissed={cmpToastDismissed}
              onDismiss={() => setCmpToastDismissed(true)}
            />
          )}

          {/* 1. Hero — score + verdict + sparkline + warm reaction */}
          <div className="ai-hero">
            {scoringEnabled && (
              <div className="ai-hero-score">
                <div className="ai-score-wrap">
                  <ScoreRing score={result.overall_score} />
                  <span className="ai-score-number" style={{ color: scoreColor(result.overall_score) }}>
                    {result.overall_score}
                    <span className="ai-score-outof">/100</span>
                  </span>
                </div>
                <div className="ai-hero-meta">
                  <span className="ai-overall-verdict" style={{ color: scoreColor(result.overall_score) }}>
                    {scoreLabel(result.overall_score)}
                  </span>
                  {scoreHistory && scoreHistory.length >= 2 && (
                    <ScoreSparkline history={scoreHistory} />
                  )}
                </div>
              </div>
            )}
            {result.warm_reaction && (
              <p className="ai-warm-reaction">&ldquo;{result.warm_reaction}&rdquo;</p>
            )}
            {voiceFingerprint && (
              <p
                className="ai-voice-fingerprint muted small"
                title={`Pattern detected across ${voiceFingerprint.poemCount} of your poems`}
              >
                Your voice often: {voiceFingerprint.tags.join(" · ")}
              </p>
            )}
          </div>

          {/* 2. Strengths + weaknesses */}
          {((result.strengths?.length ?? 0) > 0 || (result.weaknesses?.length ?? 0) > 0) && (
            <div className="ai-sw-pair">
              {(result.strengths?.length ?? 0) > 0 && (
                <div className="ai-card ai-card-strengths">
                  <span className="ai-card-label"><span className="ai-card-icon" aria-hidden>+</span> Strengths</span>
                  <ul className="ai-sw-list">
                    {result.strengths!.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {(result.weaknesses?.length ?? 0) > 0 && (
                <div className="ai-card ai-card-weaknesses">
                  <span className="ai-card-label"><span className="ai-card-icon" aria-hidden>−</span> Work on</span>
                  <ul className="ai-sw-list">
                    {result.weaknesses!.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* 3. Strongest line — compact horizontal pill row */}
          {result.strongest_line && (
            <div className="ai-strongest-pill">
              <span className="ai-strongest-pill-icon" aria-hidden>★</span>
              <span className="ai-strongest-pill-label">Strongest line</span>
              {(onJump || onPeek) ? (
                <button type="button" className="ai-strongest-pill-jump linkish"
                  onClick={() => (onPeek ?? onJump)?.(result.strongest_line!.line)}
                  title={`Show line ${result.strongest_line.line} in the editor`}>
                  Line {result.strongest_line.line}
                </button>
              ) : (
                <span className="ai-strongest-pill-jump">Line {result.strongest_line.line}</span>
              )}
              {result.strongest_line.why && (
                <span className="ai-strongest-pill-why muted small">— {result.strongest_line.why}</span>
              )}
            </div>
          )}

          {/* 4. Form coach (only when a form is detected) */}
          {localAnalysis && localAnalysis.form !== "free" && poemLines && (
            <FormCoach
              form={localAnalysis.form}
              syllablesPerLine={localAnalysis.syllablesPerLine}
              lines={poemLines}
              onPeek={onPeek ?? onJump}
            />
          )}

          {/* 5. Mentor feedback — Personal first (more emotional), Overall second */}
          {(result.personal_feedback || result.overall_feedback) && (
            <div className="ai-feedback-blocks">
              {result.personal_feedback && (
                <div className={`ai-feedback-card ai-feedback-personal${personalExpanded ? " is-expanded" : ""}`}>
                  <span className="ai-feedback-label">For you</span>
                  <p className={`ai-feedback-text${personalExpanded ? "" : " is-clamped"}`}>
                    {result.personal_feedback}
                  </p>
                  {result.personal_feedback.length > 90 && (
                    <button type="button" className="ai-feedback-toggle"
                      onClick={() => setPersonalExpanded((v) => !v)}>
                      {personalExpanded ? "Show less" : "Read more"}
                    </button>
                  )}
                </div>
              )}
              {result.overall_feedback && (
                <div className={`ai-feedback-card ai-feedback-overall${overallExpanded ? " is-expanded" : ""}`}>
                  <span className="ai-feedback-label">Overall</span>
                  <p className={`ai-feedback-text${overallExpanded ? "" : " is-clamped"}`}>
                    {result.overall_feedback}
                  </p>
                  {result.overall_feedback.length > 90 && (
                    <button type="button" className="ai-feedback-toggle"
                      onClick={() => setOverallExpanded((v) => !v)}>
                      {overallExpanded ? "Show less" : "Read more"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 6. Comparison detail (still useful when toast is dismissed) */}
          {isCompare && <ComparisonPanel cmp={(result as PoemComparison).comparison} />}

          {/* 7. CTA — jump to issues */}
          {visibleIssues.length > 0 && (
            <button type="button" className="small-btn ai-jump-to-issues-btn"
              onClick={() => setTab("issues")}>
              See {visibleIssues.length} issue{visibleIssues.length !== 1 ? "s" : ""} →
            </button>
          )}
        </div>
      )}

      {/* Issues tab */}
      {tab === "issues" && (
        <div className="ai-tab-panel ai-tab-issues">
          {result.issues.length === 0 ? (
            <div className="ai-no-issues-wrap">
              <span className="ai-no-issues-check" aria-hidden>✓</span>
              <p className="ai-no-issues muted small">No specific line-level issues — the poem reads well.</p>
            </div>
          ) : (
            <>
              {/* Filter chips: severity + category */}
              <div className="ai-filter-row">
                <div className="ai-filter-chips" role="group" aria-label="Filter by severity">
                  <button type="button" className={`ai-chip${activeSeverity === null ? " is-active" : ""}`}
                    onClick={() => setActiveSeverity(null)}>All</button>
                  {(["high", "medium", "low"] as const)
                    .filter((s) => visibleIssues.some((i) => (i.severity ?? "low") === s))
                    .map((s) => (
                      <button key={s} type="button"
                        className={`ai-chip ai-chip-sev-${s}${activeSeverity === s ? " is-active" : ""}`}
                        onClick={() => setActiveSeverity(activeSeverity === s ? null : s)}>
                        <span className={`ai-issue-sev-dot ai-issue-sev-dot-${s}`} aria-hidden />
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                </div>
                {categoriesWithCount.length > 1 && (
                  <div className="ai-filter-chips" role="group" aria-label="Filter by category">
                    {categoriesWithCount.map((c) => (
                      <button key={c.label} type="button"
                        className={`ai-chip ai-chip-cat${activeCategory === c.label ? " is-active" : ""}`}
                        style={{ borderColor: c.color, color: activeCategory === c.label ? "#fff" : c.color, background: activeCategory === c.label ? c.color : "transparent" }}
                        onClick={() => setActiveCategory(activeCategory === c.label ? null : c.label)}>
                        {c.label} <span className="ai-chip-count">{c.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="ai-issues-toolbar">
                {totalIssues > 0 && (
                  <div className="ai-progress-bar-wrap" title={`${resolvedCount} of ${totalIssues} addressed`}>
                    <div className="ai-progress-bar">
                      <div className="ai-progress-bar-fill" style={{ width: `${progressPct}%` }} />
                    </div>
                    <span className="ai-progress-bar-label">{resolvedCount}/{totalIssues} addressed</span>
                  </div>
                )}
                {filteredIssues.length > 1 && (
                  <button type="button" className="ai-expand-all-btn"
                    onClick={toggleAll}
                    title={allExpanded ? "Collapse all" : "Expand all"}>
                    {allExpanded ? "Collapse all" : "Expand all"}
                  </button>
                )}
              </div>

              {allDone ? (
                <div className="ai-all-done">
                  <span className="ai-all-done-icon" aria-hidden>✦</span>
                  <div>
                    <strong>All issues addressed!</strong>
                    <p className="muted small">Run another analysis to check the revised poem.</p>
                  </div>
                  <button type="button" className="small-btn ai-all-done-undo"
                    onClick={() => setResolvedIds(new Set())}>
                    Reset
                  </button>
                </div>
              ) : filteredIssues.length === 0 ? (
                <p className="muted small ai-no-match">No issues match the active filters.</p>
              ) : (
                <div className="ai-issues-grouped">
                  {(["high", "medium", "low"] as const).map((sev) =>
                    grouped[sev].length > 0 ? (
                      <div key={sev} className={`ai-sev-group ai-sev-group-${sev}`}>
                        <h4 className="ai-sev-group-head">
                          <span className={`ai-issue-sev-dot ai-issue-sev-dot-${sev}`} aria-hidden />
                          {sev.charAt(0).toUpperCase() + sev.slice(1)}
                          <span className="ai-sev-group-count">{grouped[sev].length}</span>
                        </h4>
                        <div className="ai-issues-list">
                          {grouped[sev].map(renderIssueCard)}
                        </div>
                      </div>
                    ) : null,
                  )}
                </div>
              )}

              {ignoredIds.size > 0 && (
                <div className="ai-ignored-footer">
                  <button type="button" className="ai-show-ignored-btn"
                    onClick={() => setShowIgnored((v) => !v)}>
                    {showIgnored ? "Hide" : "Show"} {ignoredIds.size} ignored issue{ignoredIds.size !== 1 ? "s" : ""}
                  </button>
                  {showIgnored && (
                    <div className="ai-ignored-list">
                      {result.issues.filter((i) => ignoredIds.has(i.id)).map((iss) => (
                        <div key={iss.id} className="ai-ignored-row">
                          <span className="ai-ignored-label">
                            {iss.line_start === iss.line_end
                              ? `Line ${iss.line_start}`
                              : `Lines ${iss.line_start}–${iss.line_end}`}
                            {iss.excerpt ? ` — "${iss.excerpt}"` : ""}
                          </span>
                          <button type="button" className="ai-unignore-btn"
                            onClick={() => setIgnoredIds((prev) => { const s = new Set(prev); s.delete(iss.id); return s; })}>
                            Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Chat tab */}
      {tab === "chat" && poemLines && poemTitle !== undefined && model && (
        <div className="ai-tab-panel ai-tab-chat">
          <AiChat title={poemTitle} lines={poemLines} result={result} model={model} poemId={poemId} />
        </div>
      )}
    </div>
  );
}

// ---- main component ---- //
export interface AiAnalysisProps {
  title: string;
  lines: string[];
  mainIdea?: string;
  poemId?: string;
  localAnalysis?: LocalAnalysisContext;
  goals?: WorkshopGoals;
  onJumpToLine?: (line: number) => void;
  /** Scroll editor to a line without moving the cursor or stealing focus. */
  onPeekLine?: (line: number) => void;
  onHighlightLines?: (start: number, end: number, severity?: string) => void;
  onClearHighlight?: () => void;
  onAnalysisDone?: (issues: AnalysisIssue[], score: number) => void;
  /** Fires whenever the user-visible issue set changes (e.g. ignore/restore). */
  onVisibleIssuesChange?: (issues: AnalysisIssue[]) => void;
  onApplyLine?: (lineStart: number, lineEnd: number, text: string) => void;
  /** Called once with a trigger fn so external UI (e.g. mobile FAB) can start analysis */
  onAnalyzeRef?: (fn: () => void) => void;
  /** Called whenever the loading state changes — lets parent show a loading indicator */
  onLoadingChange?: (loading: boolean) => void;
  /** Called once with a fn so external UI (e.g. editor gutter click) can open the issue covering a given line. Pass scroll=false to open silently. */
  onOpenIssueAtLineRef?: (fn: (line: number, scroll?: boolean) => void) => void;
  /** Fires when the displayed result changes — lets the editor render a status strip + line ribbons. */
  onResultChange?: (result: PoemAnalysis | PoemComparison | null) => void;
  /** Receives a setter so external UI (e.g. editor popover) can switch tabs. */
  onSwitchTabRef?: (fn: (tab: "overview" | "issues" | "chat") => void) => void;
}

interface FormCoachLine { lineNumber: number; syllables: number; target: number; ok: boolean; }

function FormCoach({ form, syllablesPerLine, lines, onPeek }: {
  form: string;
  syllablesPerLine: number[];
  lines: string[];
  onPeek?: (line: number) => void;
}) {
  const targets = useMemo<number[] | null>(() => {
    if (form === "haiku") return [5, 7, 5];
    if (form === "sonnet") return Array(14).fill(10);
    return null;
  }, [form]);
  if (!targets) return null;

  const checks: FormCoachLine[] = [];
  let lineIdx = 0;
  for (let i = 0; i < lines.length && lineIdx < targets.length; i++) {
    if (!lines[i]?.trim()) continue;
    const syl = syllablesPerLine[i] ?? 0;
    const target = targets[lineIdx]!;
    checks.push({ lineNumber: i + 1, syllables: syl, target, ok: syl === target });
    lineIdx++;
  }

  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;

  const formLabel = form.charAt(0).toUpperCase() + form.slice(1);

  return (
    <div className="ai-form-coach">
      <div className="ai-form-coach-head">
        <span className="ai-form-coach-icon" aria-hidden>◐</span>
        <span className="ai-form-coach-title">{formLabel} coach</span>
        <span className="ai-form-coach-progress">
          {passed}/{total} lines on target
        </span>
      </div>
      <div className="ai-form-coach-rows">
        {checks.map((c) => (
          <button
            key={c.lineNumber}
            type="button"
            className={`ai-form-row${c.ok ? " is-ok" : " is-off"}`}
            onClick={() => onPeek?.(c.lineNumber)}
            title={`Line ${c.lineNumber}: ${c.syllables} syllables (target ${c.target})`}
          >
            <span className="ai-form-row-num">L{c.lineNumber}</span>
            <span className="ai-form-row-mark" aria-hidden>{c.ok ? "✓" : "✗"}</span>
            <span className="ai-form-row-syl">{c.syllables}</span>
            <span className="ai-form-row-target muted">/{c.target}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AiAnalysis({ title, lines, mainIdea, poemId, localAnalysis, goals, onJumpToLine, onPeekLine, onHighlightLines, onClearHighlight, onAnalysisDone, onVisibleIssuesChange, onApplyLine, onAnalyzeRef, onLoadingChange, onOpenIssueAtLineRef, onResultChange, onSwitchTabRef }: AiAnalysisProps) {
  const [model, setModel] = useState(loadStoredModel);
  const [harshness, setHarshness] = useState<HarshnessLevel>("editor");
  const [scoringEnabled, setScoringEnabled] = useState<boolean>(loadScoringEnabled);
  const [sessionNonce, setSessionNonce] = useState(0);
  const [openIssueLineSignal, setOpenIssueLineSignal] = useState<{ line: number; nonce: number; scroll?: boolean } | null>(null);
  const [retryAfterSec, setRetryAfterSec] = useState<number>(0);
  const [externalTabSignal, setExternalTabSignal] = useState<{ tab: AnalysisTab; nonce: number } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    () => loadLastAnalysis(poemId) ? "done" : "idle",
  );
  const [result, setResult] = useState<PoemAnalysis | PoemComparison | null>(
    () => loadLastAnalysis(poemId),
  );
  const [savedResult, setSavedResult] = useState<PoemAnalysis | null>(
    () => loadLastAnalysis(poemId),
  );
  const [savedLines, setSavedLines] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [isUnconfigured, setIsUnconfigured] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const [scoreHistory, setScoreHistory] = useState<number[]>(() => loadScoreHistory(poemId));
  const abortRef = useRef<AbortController | null>(null);
  const prevPoemId = useRef(poemId);

  useEffect(() => {
    if (poemId !== prevPoemId.current) {
      prevPoemId.current = poemId;
      abortRef.current?.abort();
      const next = loadLastAnalysis(poemId);
      setResult(next);
      setSavedResult(next);
      setSavedLines([]);
      setStatus(next ? "done" : "idle");
      setErrorMsg("");
      setIsUnconfigured(false);
      setScoreHistory(loadScoreHistory(poemId));
    }
  }, [poemId]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  useEffect(() => {
    onLoadingChange?.(status === "loading");
  }, [status, onLoadingChange]);

  useEffect(() => {
    onResultChange?.(result);
  }, [result, onResultChange]);

  const saveModel = useCallback((val: string) => {
    setModel(val);
    tryLocalStorageSetItem(LS_KEY_MODEL, val);
  }, []);

  const toggleScoring = useCallback(() => {
    setScoringEnabled((prev) => {
      const next = !prev;
      tryLocalStorageSetItem(STORAGE_KEY_AI_SCORING_ENABLED, next ? "1" : "0");
      return next;
    });
  }, []);

  // Retry-after countdown ticker.
  useEffect(() => {
    if (retryAfterSec <= 0) return;
    const id = setInterval(() => {
      setRetryAfterSec((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [retryAfterSec]);

  const canCompare = savedResult !== null && savedLines.length > 0;
  const hasPoem = lines.some((l) => l.trim().length > 0);
  // Auto-decide: first run = fresh analyze, every subsequent run = compare.
  // No user-facing toggle — surfaced as a single "Refine" action.
  const effectiveMode: "fresh" | "compare" = canCompare ? "compare" : "fresh";

  const handleAnalyze = useCallback(async () => {
    if (!hasPoem) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus("loading");
    setErrorMsg("");
    setIsUnconfigured(false);

    const goalsPlain = goals
      ? Object.fromEntries(Object.entries(goals).filter(([, v]) => v != null)) as Record<string, number>
      : undefined;

    const writingFocus = mainIdea?.trim() ? `Main idea: ${mainIdea.trim()}` : undefined;

    // Skip the API call when input + settings haven't changed since the last
    // fresh analysis — no point burning tokens. Compare always re-runs because
    // the diff itself is part of what the model evaluates.
    const inputHash = hashInput([
      lines.join("\n"),
      title,
      harshness,
      mainIdea ?? "",
      canCompare ? "compare" : "fresh",
    ].join("|"));
    if (!canCompare && result && loadLastHash(poemId) === inputHash) {
      setStatus("done");
      return;
    }

    try {
      let res: PoemAnalysis | PoemComparison;
      if (canCompare) {
        res = await comparePoem(
          {
            title, lines, previousLines: savedLines,
            previousScores: { overall_score: savedResult!.overall_score },
            localAnalysis, goals: goalsPlain, writingFocus,
            scoreHistory: scoreHistory.slice(-3),
          },
          model, ctrl.signal,
        );
      } else {
        res = await analyzePoem({ title, lines, localAnalysis, goals: goalsPlain, harshness, writingFocus }, model, ctrl.signal);
      }
      setResult(res);
      setSavedResult(res);
      setSavedLines(lines);
      saveLastAnalysis(poemId, res);
      saveLastHash(poemId, inputHash);
      pushSnapshot(poemId, res);
      onAnalysisDone?.(res.issues, res.overall_score);
      setScoreHistory(appendScoreHistory(poemId, res.overall_score));
      setStatus("done");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const e = err as Error & { retryAfterSec?: number };
      const msg = e.message ?? "Unknown error";
      if (typeof e.retryAfterSec === "number" && e.retryAfterSec > 0) {
        setRetryAfterSec(e.retryAfterSec);
      }
      if (msg.toLowerCase().includes("not configured") || msg.toLowerCase().includes("api key")) {
        setIsUnconfigured(true);
        setStatus("idle");
      } else {
        setErrorMsg(msg);
        setStatus("error");
      }
    }
  }, [canCompare, hasPoem, harshness, lines, mainIdea, model, savedLines, savedResult, title, scoreHistory, poemId, localAnalysis, goals, onAnalysisDone, result]);


  useEffect(() => {
    onAnalyzeRef?.(() => { if (hasPoem) void handleAnalyze(); });
  }, [handleAnalyze, hasPoem, onAnalyzeRef]);

  const handleNewSession = useCallback(() => {
    abortRef.current?.abort();
    if (poemId) {
      try {
        localStorage.removeItem(LS_LAST_ANALYSIS_PREFIX + poemId);
        localStorage.removeItem(LS_RESOLVED_PREFIX + poemId);
        localStorage.removeItem(LS_IGNORED_PREFIX + poemId);
        localStorage.removeItem(LS_SCORE_HISTORY_PREFIX + poemId);
        localStorage.removeItem(LS_LAST_HASH_PREFIX + poemId);
        localStorage.removeItem(LS_CHAT_PREFIX + poemId);
        localStorage.removeItem(LS_SNAPSHOTS_PREFIX + poemId);
      } catch { /* ignore */ }
    }
    setResult(null);
    setSavedResult(null);
    setSavedLines([]);
    setStatus("idle");
    setErrorMsg("");
    setScoreHistory([]);
    setSessionNonce((n) => n + 1);
    onVisibleIssuesChange?.([]);
  }, [poemId, onVisibleIssuesChange]);


  const requestOpenIssueAtLine = useCallback((line: number, scroll = true) => {
    setOpenIssueLineSignal({ line, nonce: Date.now(), scroll });
  }, []);

  useEffect(() => {
    onOpenIssueAtLineRef?.(requestOpenIssueAtLine);
  }, [onOpenIssueAtLineRef, requestOpenIssueAtLine]);

  const requestSwitchTab = useCallback((tab: AnalysisTab) => {
    setExternalTabSignal({ tab, nonce: Date.now() });
    setIsOpen(true);
  }, []);

  useEffect(() => {
    onSwitchTabRef?.(requestSwitchTab);
  }, [onSwitchTabRef, requestSwitchTab]);

  return (
    <section className="ai-analysis-section" aria-label="AI poem analysis" data-tour-id="ai-analysis">
      {/* Collapsible header */}
      <button
        type="button"
        className="ai-analysis-toggle"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
      >
        <span className="ai-analysis-toggle-left">
          <span className="ai-analysis-toggle-icon" aria-hidden>✦</span>
          <span className="ai-analysis-toggle-title">AI Analysis</span>
        </span>
        <span className="ai-analysis-toggle-chevron" aria-hidden>
          {isOpen ? "▴" : "▾"}
        </span>
      </button>

      {isOpen && (
        <div className="ai-analysis-body">
          {/* Controls row */}
          <div className="ai-controls-row">
            <div className="ai-controls-left">
              <button
                type="button"
                className={`ai-score-toggle${scoringEnabled ? " is-on" : " is-off"}`}
                onClick={toggleScoring}
                title={scoringEnabled
                  ? "Hide the numeric score and trend"
                  : "Show the numeric score and trend"}
                aria-pressed={scoringEnabled}
                aria-label={scoringEnabled ? "Score visible — click to hide" : "Score hidden — click to show"}
              >
                <span className="ai-score-toggle-track">
                  <span className="ai-score-toggle-thumb">
                    {scoringEnabled ? "100" : "—"}
                  </span>
                </span>
                <span className="ai-score-toggle-label">Score</span>
              </button>

              <label className="ai-model-label">
                <select className="ai-model-select" value={model}
                  onChange={(e) => saveModel(e.target.value)}>
                  <option value="gpt-5-nano">Fast</option>
                  <option value="gpt-5-mini">Normal</option>
                  <option value="gpt-5">Thinking</option>
                </select>
              </label>

              <div className="ai-harshness-toggle" role="group" aria-label="Feedback tone">
                {([
                  { id: "casual" as const, label: "Gentle", icon: "♡" },
                  { id: "editor" as const, label: "Honest", icon: "✦" },
                  { id: "critic" as const, label: "Critic", icon: "⚡" },
                ]).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`ai-harshness-btn${harshness === opt.id ? " is-active" : ""} ai-harshness-${opt.id}`}
                    onClick={() => setHarshness(opt.id)}
                    title={
                      opt.id === "casual" ? "Warm, encouraging — only major issues"
                        : opt.id === "editor" ? "Direct, specific, craft-focused"
                          : "Uncompromising literary critique"
                    }
                  >
                    <span aria-hidden>{opt.icon}</span> {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="ai-analyze-actions">
              <button type="button"
                className="small-btn small-btn-primary ai-analyze-btn"
                onClick={() => void handleAnalyze()}
                disabled={!hasPoem || status === "loading"}
                title={!hasPoem ? "Write some lines first" : undefined}>
                {status === "loading"
                  ? (effectiveMode === "compare" ? "Refining…" : "Reading…")
                  : effectiveMode === "compare"
                    ? "✦ Refine"
                    : "✦ Read poem"}
              </button>
              {(result || scoreHistory.length > 0) && (
                <button type="button"
                  className="small-btn ai-new-session-btn"
                  onClick={handleNewSession}
                  disabled={status === "loading"}
                  title="Start a fresh session — clears chat, ignored issues, and score history for this poem">
                  New session
                </button>
              )}
            </div>
          </div>

          {retryAfterSec > 0 && (
            <div className="ai-retry-banner muted small" role="status" aria-live="polite">
              Rate limit hit — wait <strong>{retryAfterSec}s</strong> before retrying.
            </div>
          )}

          {isUnconfigured && (
            <div className="ai-unconfigured" role="status">
              <p className="ai-unconfigured-title">Server not configured</p>
              <p className="ai-unconfigured-text">
                AI analysis requires the companion server running with an OpenAI API
                key. See the <code>server/</code> directory in the repository —
                set <code>OPENAI_API_KEY</code> and start the proxy, then reload.
              </p>
            </div>
          )}

          {!isUnconfigured && status === "idle" && !result && (
            <div className="ai-idle-hint">
              <p className="muted small">
                Reads your poem and returns a warm reaction, strengths,
                weaknesses, the strongest line, and line-level suggestions.
                Each subsequent <strong>Refine</strong> compares with your
                last draft and tracks what improved.
              </p>
            </div>
          )}

          {status === "loading" && (
            <>
              <div className="ai-loading" role="status" aria-live="polite">
                <span className="ai-loading-pulse" aria-hidden />
                <span className="ai-loading-dot" aria-hidden />
                <span className="ai-loading-dot" aria-hidden />
                <span className="ai-loading-dot" aria-hidden />
                <span className="ai-loading-label">
                  {effectiveMode === "compare"
                    ? "Refining the read…"
                    : "Reading the poem…"}
                </span>
              </div>
              {result && (
                <div className="ai-ghost-results" aria-hidden>
                  <AnalysisResults
                    result={result}
                    previous={null}
                    scoreHistory={scoreHistory}
                  />
                </div>
              )}
            </>
          )}

          {status === "error" && (
            <div className="ai-error" role="alert">
              <p className="ai-error-text">{errorMsg}</p>
              <button type="button" className="small-btn"
                onClick={() => { setStatus("idle"); setErrorMsg(""); }}>
                Dismiss
              </button>
            </div>
          )}

          {status === "done" && result && (
            <>
              <AnalysisResults
                key={`results-${sessionNonce}`}
                result={result}
                previous={effectiveMode === "compare" ? savedResult : null}
                onJump={onJumpToLine}
                onPeek={onPeekLine}
                onHighlight={onHighlightLines}
                onClearHighlight={onClearHighlight}
                scoreHistory={scoreHistory}
                onApplyLine={onApplyLine}
                poemLines={lines}
                poemTitle={title}
                model={model}
                poemId={poemId}
                onVisibleIssuesChange={onVisibleIssuesChange}
                openIssueLineSignal={openIssueLineSignal}
                scoringEnabled={scoringEnabled}
                externalTabSignal={externalTabSignal}
                localAnalysis={localAnalysis}
              />
              <button type="button"
                className="small-btn ai-rerun-btn"
                onClick={() => void handleAnalyze()}>
                {effectiveMode === "compare" ? "Refine again" : "Read again"}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ---- AI chat component ---- //
interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

function AiChat({
  title,
  lines,
  result,
  model,
  poemId,
}: {
  title: string;
  lines: string[];
  result: PoemAnalysis | PoemComparison;
  model: string;
  poemId?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChat(poemId));
  const [input, setInput] = useState("");
  const [chatStatus, setChatStatus] = useState<"idle" | "loading" | "error">("idle");
  const [chatError, setChatError] = useState("");

  // Persist chat per poem.
  useEffect(() => { saveChat(poemId, messages); }, [poemId, messages]);
  // When poemId changes, reload that poem's saved messages.
  const lastPoemRef = useRef(poemId);
  useEffect(() => {
    if (lastPoemRef.current !== poemId) {
      lastPoemRef.current = poemId;
      setMessages(loadChat(poemId));
    }
  }, [poemId]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const analysisContext = (() => {
    const parts: string[] = [`Overall score: ${result.overall_score}/100`];
    if (result.summary) parts.push(`Summary: ${result.summary}`);
    if (result.issues.length > 0) {
      parts.push(`Issues (${result.issues.length}): ${result.issues.slice(0, 3).map((i) => i.rationale.slice(0, 60)).join("; ")}`);
    }
    return parts.join("\n");
  })();

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || chatStatus === "loading") return;
    const priorHistory = messages.map((m) => ({ role: m.role, content: m.text }));
    setMessages((prev) => [...prev, { role: "user", text }]);
    setChatStatus("loading");
    setChatError("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, lines, message: text, analysisContext, history: priorHistory, model }),
      });
      if (!res.ok) {
        const { message } = await parseAiErrorAndNotify(res, "chat");
        throw new Error(message);
      }
      const data = (await res.json()) as { reply?: string };
      const reply = data.reply ?? "No response.";
      setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
      setChatStatus("idle");
      setTimeout(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
      }, 50);
    } catch (err) {
      setChatError((err as Error).message);
      setChatStatus("error");
    }
  }, [chatStatus, messages, title, lines, analysisContext, model]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || chatStatus === "loading") return;
    setInput("");
    void sendMessage(text);
  }, [input, chatStatus, sendMessage]);

  const SUGGESTED_PROMPTS = [
    "What's the strongest image here?",
    "How can I sharpen the ending?",
    "Where is the rhythm uneven?",
    "Suggest a different title.",
  ];

  return (
    <div className="ai-chat">
      <div className="ai-chat-header">
        <span className="ai-chat-title">
          <span className="ai-chat-title-icon" aria-hidden>✦</span>
          Ask about your poem
        </span>
        <span className="ai-chat-hint">The AI knows your poem and the feedback above.</span>
      </div>

      {messages.length === 0 && chatStatus !== "loading" && (
        <div className="ai-chat-empty">
          <div className="ai-chat-empty-bubble" aria-hidden>✦</div>
          <p className="ai-chat-empty-greeting">
            Ask anything about your poem — voice, craft, a stuck line.
          </p>
          <div className="ai-chat-suggestions">
            <span className="ai-chat-suggestions-label">Try asking</span>
            <div className="ai-chat-suggestions-chips">
              {SUGGESTED_PROMPTS.map((p, i) => (
                <button key={i} type="button" className="ai-chat-suggestion-chip"
                  onClick={() => void sendMessage(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {messages.length > 0 && (
        <div className="ai-chat-messages" ref={listRef}>
          {messages.map((msg, i) => (
            <div key={i} className={`ai-chat-msg ai-chat-msg-${msg.role}`}>
              <span className="ai-chat-msg-role">{msg.role === "user" ? "You" : "AI"}</span>
              <span className="ai-chat-msg-text">{msg.text}</span>
            </div>
          ))}
          {chatStatus === "loading" && (
            <div className="ai-chat-msg ai-chat-msg-assistant ai-chat-msg-loading">
              <span className="ai-chat-msg-role">AI</span>
              <span className="ai-chat-dot" /><span className="ai-chat-dot" /><span className="ai-chat-dot" />
            </div>
          )}
        </div>
      )}

      {chatStatus === "error" && (
        <p className="ai-chat-error" role="alert">{chatError}</p>
      )}

      <div className="ai-chat-input-row">
        <textarea
          ref={inputRef}
          className="ai-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about your poem or the feedback…"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          onFocus={() => {
            // After the keyboard opens and the viewport shrinks, scroll the
            // input into view so it isn't hidden under the keyboard.
            setTimeout(() => {
              inputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }, 350);
          }}
        />
        <button
          type="button"
          className="ai-chat-send-btn"
          onClick={() => void handleSend()}
          disabled={!input.trim() || chatStatus === "loading"}
          aria-label="Send message"
          title="Send (Enter)"
        >
          {chatStatus === "loading" ? (
            <span className="ai-chat-send-spin" aria-hidden>
              <span className="ai-chat-dot" /><span className="ai-chat-dot" /><span className="ai-chat-dot" />
            </span>
          ) : (
            <svg className="ai-chat-send-icon" viewBox="0 0 20 20" aria-hidden width="18" height="18">
              <path d="M2 10 L18 3 L11 18 L9 12 Z" fill="currentColor" />
            </svg>
          )}
        </button>
      </div>
      <p className="ai-chat-enter-hint muted small">
        <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line
      </p>
    </div>
  );
}
