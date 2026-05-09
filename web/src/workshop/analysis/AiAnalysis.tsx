import "./AiAnalysis.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { tryLocalStorageSetItem } from "@/shared/platform/browser-storage";
import { STORAGE_KEY_AI_MODEL, STORAGE_KEY_AI_SCORING_ENABLED } from "@/shared/storage-keys";

const LS_KEY_MODEL = STORAGE_KEY_AI_MODEL;
const DEFAULT_MODEL = "gpt-5-mini";
const LEGACY_MODEL_MAP: Record<string, string> = {
  "gpt-4o-mini": "gpt-5-mini",
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
const LS_STYLE_NOTES = "easy-poems:ai-style-notes";
const MAX_SNAPSHOTS = 3;

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

function loadStyleNotes(): string {
  try { return localStorage.getItem(LS_STYLE_NOTES) ?? ""; } catch { return ""; }
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

// ---- utils ---- //
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

function deltaLabel(d: number): string {
  if (d > 0) return `+${d}`;
  if (d < 0) return `${d}`;
  return "—";
}

function deltaClass(d: number): string {
  if (d > 0) return "ai-delta ai-delta-up";
  if (d < 0) return "ai-delta ai-delta-down";
  return "ai-delta ai-delta-flat";
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

// ---- sub-components ---- //
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

function ScoreSparkline({ history }: { history: number[] }) {
  if (history.length < 2) return null;
  const W = 56, H = 18;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const pts = history.map((s, i) => {
    const x = (i / (history.length - 1)) * W;
    const y = H - 2 - ((s - min) / range) * (H - 6);
    return `${x},${y}`;
  }).join(" ");
  const lastScore = history[history.length - 1]!;
  const lastX = W;
  const lastY = H - 2 - ((lastScore - min) / range) * (H - 6);
  return (
    <div className="ai-sparkline-wrap" title={`Last ${history.length} scores: ${history.join(" → ")}${history.length >= 2 ? (history[history.length-1]! > history[0]! ? " ↑" : history[history.length-1]! < history[0]! ? " ↓" : "") : ""}`}>
      <svg className="ai-sparkline" viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <polyline points={pts} fill="none"
          stroke="var(--accent)" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
        <circle cx={lastX} cy={lastY} r="2.2" fill="var(--accent)" />
      </svg>
    </div>
  );
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
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
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
              <span className="ai-problem-words-label">Weak words:</span>
              {issue.problem_words.map((w, i) => (
                <span key={i} className="ai-problem-word">&ldquo;{w}&rdquo;</span>
              ))}
            </div>
          )}
          <p className="ai-issue-rationale">{issue.rationale}</p>
          {issue.improvements.length > 0 && (
            <ul className="ai-issue-improvements">
              {issue.improvements.map((imp, i) => (
                <li key={i} className="ai-improvement-row">
                  <span className="ai-improvement-text">{imp}</span>
                  <button
                    type="button"
                    className={`ai-copy-btn${copiedIdx === i ? " is-copied" : ""}`}
                    title="Copy suggestion"
                    onClick={() => copy(imp, i)}
                    aria-label="Copy suggestion to clipboard"
                  >
                    {copiedIdx === i ? "✓" : "⎘"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {issue.rewrite && (
            <div className="ai-issue-rewrite">
              <span className="ai-rewrite-label">Suggested rewrite</span>
              {previewRewrite && originalLineText !== null ? (
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
                <>
                  <blockquote className="ai-rewrite-text">{issue.rewrite}</blockquote>
                  <div className="ai-rewrite-actions">
                    <button
                      type="button"
                      className={`ai-copy-btn${copiedIdx === 99 ? " is-copied" : ""}`}
                      title="Copy rewrite"
                      onClick={() => copy(issue.rewrite!, 99)}
                      aria-label="Copy rewrite to clipboard"
                    >
                      {copiedIdx === 99 ? "✓" : "⎘"}
                    </button>
                    {onApplyLine && (
                      <button
                        type="button"
                        className="small-btn ai-apply-rewrite-btn"
                        title="Preview the rewrite before applying"
                        onClick={() => setPreviewRewrite(true)}
                      >
                        Preview & apply
                      </button>
                    )}
                  </div>
                </>
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

type SeverityFilter = "all" | "high" | "medium" | "low";

function AnalysisResults({
  result, previous, onJump, onHighlight, onClearHighlight, scoreHistory, onApplyLine, poemLines, poemTitle, model,
  poemId, onVisibleIssuesChange, onClarifyReply, openIssueLineSignal, scoringEnabled,
}: {
  result: PoemAnalysis | PoemComparison;
  previous?: PoemAnalysis | null;
  onJump?: (line: number) => void;
  onHighlight?: (start: number, end: number) => void;
  onClearHighlight?: () => void;
  scoreHistory?: number[];
  onApplyLine?: (lineStart: number, lineEnd: number, text: string) => void;
  poemLines?: string[];
  poemTitle?: string;
  model?: string;
  poemId?: string;
  onVisibleIssuesChange?: (issues: AnalysisIssue[]) => void;
  onClarifyReply?: (answer: string) => void;
  openIssueLineSignal?: { line: number; nonce: number } | null;
  scoringEnabled?: boolean;
}) {
  const isCompare = "comparison" in result;
  const overallDelta = previous ? result.overall_score - previous.overall_score : null;

  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => loadIdSet(LS_RESOLVED_PREFIX, poemId));
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(() => loadIdSet(LS_IGNORED_PREFIX, poemId));
  const [showIgnored, setShowIgnored] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "issues">("overview");

  // Persist resolved/ignored across reloads — drop entries that no longer
  // match an issue in the current analysis to avoid stale junk accumulating.
  useEffect(() => { saveIdSet(LS_RESOLVED_PREFIX, poemId, resolvedIds); }, [poemId, resolvedIds]);
  useEffect(() => { saveIdSet(LS_IGNORED_PREFIX, poemId, ignoredIds); }, [poemId, ignoredIds]);

  const visibleIssues = useMemo(
    () => result.issues.filter((i) => !ignoredIds.has(i.id)),
    [result.issues, ignoredIds],
  );

  // Notify parent so editor highlights/gutter dots can drop ignored issues.
  useEffect(() => {
    onVisibleIssuesChange?.(visibleIssues);
  }, [visibleIssues, onVisibleIssuesChange]);

  // Editor → panel: when a gutter dot is clicked or the cursor parks on a
  // flagged line, switch to the Issues tab, open the matching issue, and
  // scroll it into view.
  useEffect(() => {
    if (!openIssueLineSignal) return;
    const { line } = openIssueLineSignal;
    const match = visibleIssues.find((iss) => line >= iss.line_start && line <= iss.line_end);
    if (!match) return;
    setActiveTab("issues");
    setOpenIds((prev) => {
      if (prev.has(match.id)) return prev;
      const s = new Set(prev);
      s.add(match.id);
      return s;
    });
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-issue-id="${match.id}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [openIssueLineSignal, visibleIssues]);

  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [clarifyDismissed, setClarifyDismissed] = useState(false);
  const totalIssues = visibleIssues.length;
  const resolvedCount = [...resolvedIds].filter((id) => !ignoredIds.has(id)).length;
  const allDone = totalIssues > 0 && resolvedCount === totalIssues;

  const sevCounts: Record<SeverityFilter, number> = {
    all: totalIssues,
    high: visibleIssues.filter((i) => i.severity === "high").length,
    medium: visibleIssues.filter((i) => i.severity === "medium").length,
    low: visibleIssues.filter((i) => !i.severity || i.severity === "low").length,
  };

  // Collect categories that have at least one visible issue
  const categoryMap = new Map<string, { color: string; count: number }>();
  for (const iss of visibleIssues) {
    const cat = deriveCategory(iss);
    if (cat) {
      const existing = categoryMap.get(cat.label);
      categoryMap.set(cat.label, { color: cat.color, count: (existing?.count ?? 0) + 1 });
    }
  }

  const bySeverity = severityFilter === "all"
    ? visibleIssues
    : visibleIssues.filter((i) =>
        severityFilter === "low"
          ? (!i.severity || i.severity === "low")
          : i.severity === severityFilter
      );

  const filteredIssues = categoryFilter == null
    ? bySeverity
    : bySeverity.filter((i) => {
        const cat = deriveCategory(i);
        return cat?.label === categoryFilter;
      });

  // Unresolved first, resolved last
  const sortedIssues = [
    ...filteredIssues.filter((i) => !resolvedIds.has(i.id)),
    ...filteredIssues.filter((i) => resolvedIds.has(i.id)),
  ];

  const toggleAll = () => {
    const next = !allExpanded;
    setAllExpanded(next);
    if (next) {
      setOpenIds(new Set(filteredIssues.map((i) => i.id)));
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

  return (
    <div className="ai-results">
      {/* Warm human-voice opener */}
      {result.warm_reaction && (
        <p className="ai-warm-reaction">{result.warm_reaction}</p>
      )}

      {/* Tab bar splits Overview from Issues so neither pane becomes a wall. */}
      <div className="ai-tabs" role="tablist" aria-label="Analysis sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "overview"}
          className={`ai-tab${activeTab === "overview" ? " is-active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "issues"}
          className={`ai-tab${activeTab === "issues" ? " is-active" : ""}`}
          onClick={() => setActiveTab("issues")}
        >
          Issues <span className="ai-tab-count">{totalIssues}</span>
        </button>
      </div>

      {activeTab === "overview" && (<>

      {/* Score row — only when scoring is enabled */}
      {scoringEnabled && (
        <div className="ai-overall">
          <div className="ai-score-wrap">
            <ScoreRing score={result.overall_score} />
            <span className="ai-score-number" style={{ color: scoreColor(result.overall_score) }}>
              {result.overall_score}
              <span className="ai-score-outof">/100</span>
            </span>
          </div>
          <div className="ai-overall-label">
            <div className="ai-overall-verdict-row">
              <span className="ai-overall-verdict" style={{ color: scoreColor(result.overall_score) }}>
                {scoreLabel(result.overall_score)}
              </span>
              <ScoreSparkline history={scoreHistory ?? []} />
            </div>
            {overallDelta !== null && (
              <span className={deltaClass(overallDelta) + " ai-overall-delta"}>
                {deltaLabel(overallDelta)} from last
              </span>
            )}
          </div>
        </div>
      )}

      {/* Overall summary */}
      {result.summary && (
        <p className="ai-poem-summary">{result.summary}</p>
      )}

      {/* Strengths + Weaknesses cards */}
      {((result.strengths?.length ?? 0) > 0 || (result.weaknesses?.length ?? 0) > 0) && (
        <div className="ai-sw-grid">
          {(result.strengths?.length ?? 0) > 0 && (
            <div className="ai-sw-card ai-sw-strengths">
              <span className="ai-sw-label"><span className="ai-sw-mark" aria-hidden>+</span> Strengths</span>
              <ul className="ai-sw-list">
                {result.strengths!.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {(result.weaknesses?.length ?? 0) > 0 && (
            <div className="ai-sw-card ai-sw-weaknesses">
              <span className="ai-sw-label"><span className="ai-sw-mark" aria-hidden>−</span> Work on</span>
              <ul className="ai-sw-list">
                {result.weaknesses!.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Strongest line callout */}
      {result.strongest_line && (
        <div className="ai-strongest-line">
          <span className="ai-strongest-line-icon" aria-hidden>★</span>
          <div className="ai-strongest-line-body">
            <div className="ai-strongest-line-head">
              <span className="ai-strongest-line-label">Strongest line</span>
              {onJump ? (
                <button
                  type="button"
                  className="ai-strongest-line-jump linkish"
                  onClick={() => onJump(result.strongest_line!.line)}
                  title={`Jump to line ${result.strongest_line.line}`}
                >
                  Line {result.strongest_line.line}
                </button>
              ) : (
                <span className="ai-strongest-line-jump">Line {result.strongest_line.line}</span>
              )}
            </div>
            {result.strongest_line.excerpt && (
              <blockquote className="ai-strongest-line-excerpt">&ldquo;{result.strongest_line.excerpt}&rdquo;</blockquote>
            )}
            {result.strongest_line.why && (
              <p className="ai-strongest-line-why muted small">{result.strongest_line.why}</p>
            )}
          </div>
        </div>
      )}

      {/* Whole-poem improvement direction */}
      {result.overall_direction && (
        <div className="ai-overall-direction">
          <span className="ai-overall-direction-label">Direction for next revision</span>
          <p className="ai-overall-direction-text">{result.overall_direction}</p>
        </div>
      )}

      {/* Clarifying question from the model */}
      {result.clarifying_question && !clarifyDismissed && (
        <div className="ai-clarifying-question">
          <span className="ai-clarifying-icon" aria-hidden>?</span>
          <div className="ai-clarifying-body">
            <p className="ai-clarifying-text">{result.clarifying_question}</p>
            {onClarifyReply ? (
              <div className="ai-clarifying-reply-row">
                <input
                  type="text"
                  className="ai-clarifying-input"
                  value={clarifyAnswer}
                  onChange={(e) => setClarifyAnswer(e.target.value)}
                  placeholder="Your answer (re-runs analysis)…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && clarifyAnswer.trim()) {
                      onClarifyReply(clarifyAnswer.trim());
                      setClarifyAnswer("");
                      setClarifyDismissed(true);
                    }
                  }}
                />
                <button
                  type="button"
                  className="small-btn small-btn-primary"
                  disabled={!clarifyAnswer.trim()}
                  onClick={() => {
                    onClarifyReply(clarifyAnswer.trim());
                    setClarifyAnswer("");
                    setClarifyDismissed(true);
                  }}
                >
                  Send
                </button>
                <button
                  type="button"
                  className="small-btn"
                  onClick={() => setClarifyDismissed(true)}
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Comparison panel */}
      {isCompare && <ComparisonPanel cmp={(result as PoemComparison).comparison} />}

      </>)}

      {activeTab === "issues" && (<>

      {/* Issues section */}
      {result.issues.length > 0 ? (
        <div className="ai-issues-section">

          {/* What to do next — only when high-severity issues remain */}
          {resolvedCount < totalIssues && sevCounts.high > 0 && (
            <div className="ai-next-steps">
              Fix the <strong>{sevCounts.high} high-priority</strong> issue{sevCounts.high > 1 ? "s" : ""} first — then re-analyse to track improvement.
            </div>
          )}

          {/* Header row: title + progress + expand-all */}
          <div className="ai-issues-toolbar">
            <div className="ai-issues-toolbar-left">
              <h4 className="ai-issues-heading">
                Line-level feedback
                <span className="ai-issues-count">{totalIssues}</span>
              </h4>
              {resolvedCount > 0 && (
                <span className="ai-resolved-badge">
                  {resolvedCount}/{totalIssues} addressed
                </span>
              )}
            </div>
            <button
              type="button"
              className="ai-expand-all-btn"
              onClick={toggleAll}
              title={allExpanded ? "Collapse all" : "Expand all"}
            >
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
          </div>

          {/* Progress bar */}
          {totalIssues > 0 && (
            <div className="ai-progress-track" title={`${resolvedCount} of ${totalIssues} issues addressed`}>
              <div
                className="ai-progress-fill"
                style={{ width: `${(resolvedCount / totalIssues) * 100}%` }}
              />
            </div>
          )}

          {/* Severity filter tabs */}
          {(sevCounts.high > 0 || sevCounts.medium > 0) && (
            <div className="ai-sev-filter" role="group" aria-label="Filter by severity">
              {(["all", "high", "medium", "low"] as SeverityFilter[]).map((sev) => {
                if (sev !== "all" && sevCounts[sev] === 0) return null;
                return (
                  <button
                    key={sev}
                    type="button"
                    className={`ai-sev-tab${severityFilter === sev ? " is-active" : ""} ai-sev-tab-${sev}`}
                    onClick={() => setSeverityFilter(sev)}
                  >
                    {sev === "all" ? "All" : sev.charAt(0).toUpperCase() + sev.slice(1)}
                    <span className="ai-sev-tab-count">{sevCounts[sev]}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Category filter chips */}
          {categoryMap.size >= 2 && (
            <div className="ai-cat-filter" role="group" aria-label="Filter by category">
              <button
                type="button"
                className={`ai-cat-chip${categoryFilter == null ? " is-active" : ""}`}
                onClick={() => setCategoryFilter(null)}
              >
                All types
              </button>
              {[...categoryMap.entries()].map(([label, { color, count }]) => (
                <button
                  key={label}
                  type="button"
                  className={`ai-cat-chip${categoryFilter === label ? " is-active" : ""}`}
                  style={{ "--cat-color": color } as React.CSSProperties}
                  onClick={() => setCategoryFilter(categoryFilter === label ? null : label)}
                >
                  {label}
                  <span className="ai-cat-chip-count">{count}</span>
                </button>
              ))}
            </div>
          )}

          {/* All-done celebration */}
          {allDone ? (
            <div className="ai-all-done">
              <span className="ai-all-done-icon" aria-hidden>✦</span>
              <div>
                <strong>All issues addressed!</strong>
                <p className="muted small">Great work. Run another analysis to check the revised poem.</p>
              </div>
              <button
                type="button"
                className="small-btn ai-all-done-undo"
                onClick={() => setResolvedIds(new Set())}
              >
                Reset
              </button>
            </div>
          ) : (
            <div className="ai-issues-list">
              {sortedIssues.map((iss) => (
                <IssueCard
                  key={iss.id}
                  issue={iss}
                  index={result.issues.indexOf(iss)}
                  isOpen={openIds.has(iss.id)}
                  onOpenChange={(open) => handleOpenChange(iss.id, open)}
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
              ))}
            </div>
          )}

          {/* Ignored issues footer */}
          {ignoredIds.size > 0 && (
            <div className="ai-ignored-footer">
              <button
                type="button"
                className="ai-show-ignored-btn"
                onClick={() => setShowIgnored((v) => !v)}
              >
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
                      <button
                        type="button"
                        className="ai-unignore-btn"
                        onClick={() => setIgnoredIds((prev) => { const s = new Set(prev); s.delete(iss.id); return s; })}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="ai-no-issues-wrap">
          <span className="ai-no-issues-check" aria-hidden>✓</span>
          <p className="ai-no-issues muted small">No specific line-level issues — the poem reads well.</p>
        </div>
      )}

      </>)}

      <p className="ai-meta muted small">
        {new Date(result.meta.analyzedAt).toLocaleString(undefined, {
          dateStyle: "medium", timeStyle: "short",
        })}
      </p>
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
  /** Called once with a fn so external UI (e.g. editor gutter click) can open the issue covering a given line. */
  onOpenIssueAtLineRef?: (fn: (line: number) => void) => void;
}

export function AiAnalysis({ title, lines, mainIdea, poemId, localAnalysis, goals, onJumpToLine, onHighlightLines, onClearHighlight, onAnalysisDone, onVisibleIssuesChange, onApplyLine, onAnalyzeRef, onLoadingChange, onOpenIssueAtLineRef }: AiAnalysisProps) {
  const [model, setModel] = useState(loadStoredModel);
  const [harshness, setHarshness] = useState<HarshnessLevel>("editor");
  const [mode, setMode] = useState<"fresh" | "compare">("fresh");
  const [scoringEnabled, setScoringEnabled] = useState<boolean>(loadScoringEnabled);
  const [styleNotes, setStyleNotes] = useState<string>(loadStyleNotes);
  const [sessionNonce, setSessionNonce] = useState(0);
  const [openIssueLineSignal, setOpenIssueLineSignal] = useState<{ line: number; nonce: number } | null>(null);
  const [snapshots, setSnapshots] = useState<AnalysisSnapshot[]>(() => loadSnapshots(poemId));
  const [retryAfterSec, setRetryAfterSec] = useState<number>(0);
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
  const clarifyContextRef = useRef<string>("");
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
      setSnapshots(loadSnapshots(poemId));
    }
  }, [poemId]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  useEffect(() => {
    onLoadingChange?.(status === "loading");
  }, [status, onLoadingChange]);

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

  const updateStyleNotes = useCallback((val: string) => {
    setStyleNotes(val);
    tryLocalStorageSetItem(LS_STYLE_NOTES, val);
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
  const wordCount = lines.join(" ").split(/\s+/).filter(Boolean).length;
  const effectiveMode = mode === "compare" && canCompare ? "compare" : "fresh";

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

    const writingFocusParts: string[] = [];
    if (mainIdea?.trim()) writingFocusParts.push(`Main idea: ${mainIdea.trim()}`);
    if (styleNotes.trim()) writingFocusParts.push(`Style / influences: ${styleNotes.trim().slice(0, 240)}`);
    if (clarifyContextRef.current) writingFocusParts.push(`Answer to clarifying question: ${clarifyContextRef.current}`);
    const writingFocus = writingFocusParts.length > 0 ? writingFocusParts.join("\n") : undefined;
    clarifyContextRef.current = "";

    // Skip the API call when input + settings haven't changed since the last
    // analysis — no point burning tokens on identical input.
    const inputHash = hashInput([
      lines.join("\n"),
      title,
      harshness,
      styleNotes,
      mainIdea ?? "",
      mode === "compare" && canCompare ? "compare" : "fresh",
    ].join("|"));
    if (mode !== "compare" && result && loadLastHash(poemId) === inputHash) {
      setStatus("done");
      return;
    }

    try {
      let res: PoemAnalysis | PoemComparison;
      if (mode === "compare" && canCompare) {
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
      setSnapshots(loadSnapshots(poemId));
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
  }, [canCompare, hasPoem, harshness, lines, mainIdea, mode, model, savedLines, savedResult, title, scoreHistory, poemId, localAnalysis, goals, onAnalysisDone, styleNotes, result]);


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
    setSnapshots([]);
    setSessionNonce((n) => n + 1);
    onVisibleIssuesChange?.([]);
  }, [poemId, onVisibleIssuesChange]);

  const restoreSnapshot = useCallback((snap: AnalysisSnapshot) => {
    setResult(snap.result);
    setSavedResult(snap.result);
    setStatus("done");
    setErrorMsg("");
    saveLastAnalysis(poemId, snap.result);
    onAnalysisDone?.(snap.result.issues, snap.result.overall_score);
  }, [poemId, onAnalysisDone]);

  const requestOpenIssueAtLine = useCallback((line: number) => {
    setOpenIssueLineSignal({ line, nonce: Date.now() });
  }, []);

  useEffect(() => {
    onOpenIssueAtLineRef?.(requestOpenIssueAtLine);
  }, [onOpenIssueAtLineRef, requestOpenIssueAtLine]);

  const handleClarifyReply = useCallback((answer: string) => {
    if (!answer.trim() || !hasPoem) return;
    clarifyContextRef.current = answer.trim();
    void handleAnalyze();
  }, [handleAnalyze, hasPoem]);

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
              <div className="ai-mode-toggle" role="group" aria-label="Analysis mode">
                <button type="button"
                  className={`ai-mode-btn ${effectiveMode === "fresh" ? "is-active" : ""}`}
                  onClick={() => setMode("fresh")}>
                  Re-score
                </button>
                <button type="button"
                  className={`ai-mode-btn ${effectiveMode === "compare" ? "is-active" : ""}`}
                  onClick={() => setMode("compare")}
                  disabled={!canCompare}
                  title={canCompare
                    ? "Compare to your previous analysis"
                    : "Run a Re-score first to unlock comparison"}>
                  Compare
                </button>
              </div>

              <button
                type="button"
                className={`small-btn ai-scoring-toggle${scoringEnabled ? " is-active" : ""}`}
                onClick={toggleScoring}
                title={scoringEnabled
                  ? "Hide the numeric score and trend"
                  : "Show the numeric score and trend"}
                aria-pressed={scoringEnabled}
              >
                {scoringEnabled ? "Score on" : "Score off"}
              </button>

              <label className="ai-model-label">
                <select className="ai-model-select" value={model}
                  onChange={(e) => saveModel(e.target.value)}>
                  <option value="gpt-5-mini">Fast</option>
                  <option value="gpt-5">Thinking</option>
                </select>
              </label>

              <label className="ai-model-label ai-harshness-label" title="Who should read your poem? Changes how critical the feedback is.">
                <select className="ai-model-select" value={harshness}
                  onChange={(e) => setHarshness(e.target.value as HarshnessLevel)}>
                  <option value="baby">Child reader</option>
                  <option value="casual">Casual reader</option>
                  <option value="student">Student</option>
                  <option value="editor">Editor</option>
                  <option value="critic">Literary critic</option>
                </select>
              </label>
            </div>

            <div className="ai-analyze-actions">
              <button type="button"
                className="small-btn small-btn-primary ai-analyze-btn"
                onClick={() => void handleAnalyze()}
                disabled={!hasPoem || status === "loading"}
                title={!hasPoem ? "Write some lines first" : undefined}>
                {status === "loading"
                  ? "Analyzing…"
                  : effectiveMode === "compare"
                    ? "Compare versions"
                    : "Analyze poem"}
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

          {/* Style / influences input — global, persists across poems */}
          <div className="ai-style-input-row">
            <label className="ai-style-input-label" htmlFor="ai-style-input">
Style / influences
            </label>
            <input
              id="ai-style-input"
              type="text"
              className="ai-style-input"
              value={styleNotes}
              onChange={(e) => updateStyleNotes(e.target.value)}
              placeholder="e.g. Mary Oliver, plainspoken modernism…"
              maxLength={240}
            />
          </div>

          {/* Snapshot strip — last 3 runs */}
          {snapshots.length > 0 && (
            <div className="ai-snapshots-row" role="group" aria-label="Recent analyses">
              <span className="ai-snapshots-label muted small">History:</span>
              {snapshots.map((snap, i) => (
                <button
                  key={snap.analyzedAt}
                  type="button"
                  className={`ai-snapshot-chip${result?.meta?.analyzedAt === snap.analyzedAt ? " is-active" : ""}`}
                  onClick={() => restoreSnapshot(snap)}
                  title={`${new Date(snap.analyzedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · ${snap.issuesCount} issue${snap.issuesCount !== 1 ? "s" : ""}`}
                >
                  {i === 0 ? "Latest" : `−${i}`} {scoringEnabled ? `· ${snap.overall_score}` : ""}
                </button>
              ))}
            </div>
          )}

          {retryAfterSec > 0 && (
            <div className="ai-retry-banner muted small" role="status" aria-live="polite">
              Rate limit hit — wait <strong>{retryAfterSec}s</strong> before retrying.
            </div>
          )}

          {/* Word count hint */}
          {hasPoem && status !== "loading" && (
            <p className="ai-word-hint muted small">
              {wordCount} word{wordCount !== 1 ? "s" : ""}
              {mainIdea?.trim() ? <> · <span className="ai-form-badge">{mainIdea.trim().slice(0, 32)}{mainIdea.trim().length > 32 ? "…" : ""}</span></> : null}
              {" · "}{effectiveMode === "compare" && canCompare
                ? "will compare to your saved baseline"
                : "analysis with local context"}
            </p>
          )}

          {effectiveMode === "compare" && canCompare && (
            <p className="ai-compare-hint muted small">
              Baseline saved from previous run — the model will score the current
              version and show what changed.
            </p>
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
                After the first run, <strong>Compare</strong> shows what
                changed.
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
                    ? "Comparing versions…"
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
                onHighlight={onHighlightLines}
                onClearHighlight={onClearHighlight}
                scoreHistory={scoreHistory}
                onApplyLine={onApplyLine}
                poemLines={lines}
                poemTitle={title}
                model={model}
                poemId={poemId}
                onVisibleIssuesChange={onVisibleIssuesChange}
                onClarifyReply={handleClarifyReply}
                openIssueLineSignal={openIssueLineSignal}
                scoringEnabled={scoringEnabled}
              />
              <button type="button"
                className="small-btn ai-rerun-btn"
                onClick={() => void handleAnalyze()}>
                Analyze again
              </button>
              <AiChat title={title} lines={lines} result={result} model={model} poemId={poemId} />
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

const QUICK_REPLY_CHIPS = [
  "Why is the weakest line weak?",
  "Suggest stronger verbs",
  "Make it more concrete",
  "What's the central image?",
];

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
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
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

  return (
    <div className="ai-chat">
      <div className="ai-chat-header">
        <span className="ai-chat-title">Ask about your poem</span>
        <span className="ai-chat-hint">Chat with the AI about the feedback or your craft</span>
      </div>

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

      {messages.length === 0 && (
        <div className="ai-chat-quickreplies" role="group" aria-label="Quick replies">
          {QUICK_REPLY_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              className="ai-chat-quickreply"
              onClick={() => void sendMessage(chip)}
              disabled={chatStatus === "loading"}
            >
              {chip}
            </button>
          ))}
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
          className="small-btn small-btn-primary ai-chat-send"
          onClick={() => void handleSend()}
          disabled={!input.trim() || chatStatus === "loading"}
        >
          {chatStatus === "loading" ? "…" : "Send"}
        </button>
      </div>
      <p className="ai-chat-enter-hint muted small">Enter to send · Shift+Enter for new line</p>
    </div>
  );
}
