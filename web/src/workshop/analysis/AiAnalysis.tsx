import "./AiAnalysis.css";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzePoem,
  comparePoem,
  type AnalysisDimensions,
  type AnalysisIssue,
  type ComparisonChanges,
  type HarshnessLevel,
  type LocalAnalysisContext,
  type PoemAnalysis,
  type PoemComparison,
} from "@/workshop/analysis/ai-analyze";
import type { WorkshopGoals } from "@/workshop/library/workshop-goals";
import { tryLocalStorageSetItem } from "@/shared/platform/browser-storage";
import { STORAGE_KEY_AI_MODEL } from "@/shared/storage-keys";

const LS_KEY_MODEL = STORAGE_KEY_AI_MODEL;
const DEFAULT_MODEL = "gpt-4o-mini";
const LS_KEY_WRITING_FOCUS = "easy-poems:writing-focus";
const LS_KEY_MAIN_IDEA = "easy-poems:main-idea";

// ---- last analysis per poem ---- //
const LS_LAST_ANALYSIS_PREFIX = "easy-poems:ai-last:";

function loadLastAnalysis(poemId?: string): PoemAnalysis | null {
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

// ---- score history ---- //
const LS_SCORE_HISTORY = "easy-poems:ai-score-history";
const MAX_SCORE_HISTORY = 15;

function loadScoreHistory(): number[] {
  try {
    const raw = localStorage.getItem(LS_SCORE_HISTORY);
    if (!raw) return [];
    return JSON.parse(raw) as number[];
  } catch { return []; }
}

function appendScoreHistory(score: number): number[] {
  const history = loadScoreHistory();
  const next = [...history, score].slice(-MAX_SCORE_HISTORY);
  try { localStorage.setItem(LS_SCORE_HISTORY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

function loadStoredModel(): string {
  try { return localStorage.getItem(LS_KEY_MODEL) ?? DEFAULT_MODEL; }
  catch { return DEFAULT_MODEL; }
}

function loadWritingFocus(): string {
  try { return localStorage.getItem(LS_KEY_WRITING_FOCUS) ?? ""; }
  catch { return ""; }
}

function saveWritingFocus(v: string) {
  try {
    if (v.trim()) localStorage.setItem(LS_KEY_WRITING_FOCUS, v);
    else localStorage.removeItem(LS_KEY_WRITING_FOCUS);
  } catch { /* ignore */ }
}

function loadMainIdea(): string {
  try { return localStorage.getItem(LS_KEY_MAIN_IDEA) ?? ""; }
  catch { return ""; }
}

function saveMainIdea(v: string) {
  try {
    if (v.trim()) localStorage.setItem(LS_KEY_MAIN_IDEA, v);
    else localStorage.removeItem(LS_KEY_MAIN_IDEA);
  } catch { /* ignore */ }
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

// ---- dimension descriptions ---- //
const DIM_META: Record<keyof AnalysisDimensions, { label: string; desc: string }> = {
  imagery:     { label: "Imagery",     desc: "Vividness and specificity of sensory language" },
  musicality:  { label: "Musicality",  desc: "Rhythm, sound patterns, and how it reads aloud" },
  originality: { label: "Originality", desc: "Freshness of language, images, and perspective" },
  clarity:     { label: "Clarity",     desc: "Coherence and ease of following the poem's meaning" },
};

// ---- issue category derivation ---- //
const CATEGORY_RULES: { label: string; color: string; keywords: RegExp }[] = [
  { label: "Imagery",    color: "var(--ai-cat-imagery,  #9ab89a)", keywords: /imag|visual|senso|concrete|abstract|metaphor|simile|picture|vivid/i },
  { label: "Rhythm",     color: "var(--ai-cat-rhythm,   #8fc48f)", keywords: /rhythm|meter|beat|syllable|stress|iamb|anapest|trochee|spondee|cadence|pace|flow/i },
  { label: "Sound",      color: "var(--ai-cat-sound,    #b0a0d8)", keywords: /rhyme|sound|alliter|assonance|consonance|musical|echo|repeat|repetit/i },
  { label: "Word choice", color: "var(--ai-cat-word,    #d4a96a)", keywords: /word|diction|vocab|cliché|cliche|trite|vague|overwrit|purple prose|adjective|adverb/i },
  { label: "Structure",  color: "var(--ai-cat-struct,   #9fc4b4)", keywords: /structur|stanza|line break|enjamb|syntax|sentence|paragraph|openin|ending|volta|turn/i },
  { label: "Clarity",    color: "var(--ai-cat-clarity,  #c4a0a0)", keywords: /clear|clarity|confus|obscure|ambig|vague|awkward|hard to follow|understand/i },
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

function DimensionBar({
  label, desc, value, delta,
}: { label: string; desc: string; value: number; delta?: number }) {
  return (
    <div className="ai-dim-row" title={desc}>
      <span className="ai-dim-label">{label}</span>
      <div className="ai-dim-track">
        <div className="ai-dim-fill" style={{ width: `${value}%`, background: scoreColor(value) }} />
      </div>
      <span className="ai-dim-val" style={{ color: scoreColor(value) }}>{value}</span>
      {delta !== undefined ? (
        <span className={deltaClass(delta)} title={`Changed by ${deltaLabel(delta)}`}>
          {deltaLabel(delta)}
        </span>
      ) : null}
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
  }, [input, loading, poemTitle, poemLines, issueContext, model]);

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
      className={`ai-issue ai-issue-sev-${issue.severity ?? "low"}${isResolved ? " is-resolved" : ""}`}
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
          {!isResolved && issue.excerpt
            ? <span className="ai-issue-excerpt">&ldquo;{issue.excerpt}&rdquo;</span>
            : null}
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
}) {
  const isCompare = "comparison" in result;
  const deltas = previous
    ? {
        overall: result.overall_score - previous.overall_score,
        imagery: result.dimensions.imagery - previous.dimensions.imagery,
        musicality: result.dimensions.musicality - previous.dimensions.musicality,
        originality: result.dimensions.originality - previous.dimensions.originality,
        clarity: result.dimensions.clarity - previous.dimensions.clarity,
      }
    : null;

  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set());
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(() => new Set());
  const [showIgnored, setShowIgnored] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [dimsExpanded, setDimsExpanded] = useState(false);

  const visibleIssues = result.issues.filter((i) => !ignoredIds.has(i.id));
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
      {/* Score row — always visible */}
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
          {deltas && (
            <span className={deltaClass(deltas.overall) + " ai-overall-delta"}>
              {deltaLabel(deltas.overall)} from last
            </span>
          )}
          <span className="ai-overall-prose muted small">
            {buildProseSummary(result.dimensions)}
          </span>
        </div>
      </div>

      {/* Dimension breakdown — collapsible */}
      <div className="ai-dims-section">
        <button
          type="button"
          className="ai-dims-toggle"
          onClick={() => setDimsExpanded((p) => !p)}
          aria-expanded={dimsExpanded}
        >
          <span>Breakdown</span>
          <span className="ai-dims-chevron" aria-hidden>{dimsExpanded ? "▾" : "▸"}</span>
        </button>
        {dimsExpanded && (
          <div className="ai-dimensions">
            {(Object.keys(DIM_META) as (keyof AnalysisDimensions)[]).map((k) => (
              <DimensionBar
                key={k}
                label={DIM_META[k].label}
                desc={DIM_META[k].desc}
                value={result.dimensions[k]}
                delta={deltas ? deltas[k] : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Overall summary */}
      {result.summary && (
        <p className="ai-poem-summary">{result.summary}</p>
      )}

      {/* Whole-poem improvement direction */}
      {result.overall_direction && (
        <div className="ai-overall-direction">
          <span className="ai-overall-direction-label">Direction for next revision</span>
          <p className="ai-overall-direction-text">{result.overall_direction}</p>
        </div>
      )}

      {/* Comparison panel */}
      {isCompare && <ComparisonPanel cmp={(result as PoemComparison).comparison} />}

      {/* Issues section */}
      {result.issues.length > 0 ? (
        <div className="ai-issues-section">

          {/* What to do next */}
          {resolvedCount < totalIssues && (
            <div className="ai-next-steps">
              {sevCounts.high > 0
                ? <>Fix the <strong>{sevCounts.high} high-priority</strong> issue{sevCounts.high > 1 ? "s" : ""} first — then re-analyse to track improvement.</>
                : <>Pick an issue below, edit that line, and re-analyse to see your score move.</>}
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

      <p className="ai-meta muted small">
        {result.meta.model} ·{" "}
        {new Date(result.meta.analyzedAt).toLocaleString(undefined, {
          dateStyle: "medium", timeStyle: "short",
        })}
      </p>
    </div>
  );
}

// ---- prose summary from dimensions ---- //
function buildProseSummary(dims: AnalysisDimensions): string {
  const entries = Object.entries(dims) as [keyof AnalysisDimensions, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries[0]!;
  const bottom = entries[entries.length - 1]!;
  const label = DIM_META[top[0]].label.toLowerCase();
  const weakLabel = DIM_META[bottom[0]].label.toLowerCase();
  if (top[1] >= 75 && bottom[1] < 55) {
    return `Strongest in ${label}; most room to grow in ${weakLabel}.`;
  }
  if (top[1] >= 75) {
    return `${DIM_META[top[0]].label} is a clear strength here.`;
  }
  if (bottom[1] < 45) {
    return `Focus next revision on ${weakLabel}.`;
  }
  return `Balanced across all four dimensions.`;
}

// ---- main component ---- //
export interface AiAnalysisProps {
  title: string;
  lines: string[];
  poemId?: string;
  localAnalysis?: LocalAnalysisContext;
  goals?: WorkshopGoals;
  onJumpToLine?: (line: number) => void;
  onHighlightLines?: (start: number, end: number, severity?: string) => void;
  onClearHighlight?: () => void;
  onAnalysisDone?: (issues: AnalysisIssue[], score: number) => void;
  onApplyLine?: (lineStart: number, lineEnd: number, text: string) => void;
  /** Called once with a trigger fn so external UI (e.g. mobile FAB) can start analysis */
  onAnalyzeRef?: (fn: () => void) => void;
  /** Called whenever the loading state changes — lets parent show a loading indicator */
  onLoadingChange?: (loading: boolean) => void;
}

export function AiAnalysis({ title, lines, poemId, localAnalysis, goals, onJumpToLine, onHighlightLines, onClearHighlight, onAnalysisDone, onApplyLine, onAnalyzeRef, onLoadingChange }: AiAnalysisProps) {
  const [model, setModel] = useState(loadStoredModel);
  const [harshness, setHarshness] = useState<HarshnessLevel>("editor");
  const [mode, setMode] = useState<"fresh" | "compare">("fresh");
  const [writingFocus, setWritingFocus] = useState(loadWritingFocus);
  const [focusOpen, setFocusOpen] = useState(() => loadWritingFocus().length > 0);
  const [mainIdea, setMainIdea] = useState(loadMainIdea);
  const [ideaOpen, setIdeaOpen] = useState(() => loadMainIdea().length > 0);
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
  const [scoreHistory, setScoreHistory] = useState<number[]>(() => loadScoreHistory());
  const abortRef = useRef<AbortController | null>(null);
  const prevPoemId = useRef(poemId);

  useEffect(() => {
    if (poemId !== prevPoemId.current) {
      prevPoemId.current = poemId;
      abortRef.current?.abort();
      setResult(null);
      setSavedResult(null);
      setSavedLines([]);
      setStatus("idle");
      setErrorMsg("");
      setIsUnconfigured(false);
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

    try {
      if (mode === "compare" && canCompare) {
        const res = await comparePoem(
          {
            title, lines, previousLines: savedLines,
            previousScores: { overall_score: savedResult!.overall_score, dimensions: savedResult!.dimensions },
            localAnalysis, goals: goalsPlain, writingFocus: writingFocus.trim() || undefined,
            scoreHistory: scoreHistory.slice(-10),
          },
          model, ctrl.signal,
        );
        setResult(res);
        setSavedResult(res);
        setSavedLines(lines);
        saveLastAnalysis(poemId, res);
        onAnalysisDone?.(res.issues, res.overall_score);
        setScoreHistory(appendScoreHistory(res.overall_score));
      } else {
        const combinedFocus = [
          mainIdea.trim() ? `Main idea: ${mainIdea.trim()}` : "",
          writingFocus.trim(),
        ].filter(Boolean).join("\n") || undefined;
        const res = await analyzePoem({ title, lines, localAnalysis, goals: goalsPlain, harshness, writingFocus: combinedFocus }, model, ctrl.signal);
        setResult(res);
        setSavedResult(res);
        setSavedLines(lines);
        saveLastAnalysis(poemId, res);
        onAnalysisDone?.(res.issues, res.overall_score);
        setScoreHistory(appendScoreHistory(res.overall_score));
      }
      setStatus("done");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const msg = (err as Error).message ?? "Unknown error";
      if (msg.toLowerCase().includes("not configured") || msg.toLowerCase().includes("api key")) {
        setIsUnconfigured(true);
        setStatus("idle");
      } else {
        setErrorMsg(msg);
        setStatus("error");
      }
    }
  }, [canCompare, hasPoem, harshness, lines, mainIdea, mode, model, savedLines, savedResult, title, writingFocus]);

  useEffect(() => {
    onAnalyzeRef?.(() => { if (hasPoem) void handleAnalyze(); });
  }, [handleAnalyze, hasPoem, onAnalyzeRef]);

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
                  Fresh
                </button>
                <button type="button"
                  className={`ai-mode-btn ${effectiveMode === "compare" ? "is-active" : ""}`}
                  onClick={() => setMode("compare")}
                  disabled={!canCompare}
                  title={canCompare
                    ? "Compare to your previous analysis"
                    : "Run a Fresh analysis first to unlock comparison"}>
                  Compare
                </button>
              </div>

              <label className="ai-model-label">
                <select className="ai-model-select" value={model}
                  onChange={(e) => saveModel(e.target.value)}>
                  <option value="gpt-4o-mini">Fast</option>
                  <option value="gpt-4o">Thinking</option>
                </select>
              </label>

              <label className="ai-model-label ai-harshness-label" title="Who should read your poem? Changes how critical the feedback is.">
                <span className="ai-harshness-icon" aria-hidden>👁</span>
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
          </div>

          {/* Main idea */}
          <div className="ai-focus-section">
            <button
              type="button"
              className="ai-focus-toggle"
              onClick={() => setIdeaOpen((v) => !v)}
            >
              <span className="ai-focus-toggle-label">
                {mainIdea.trim() ? `Idea: ${mainIdea.trim().slice(0, 48)}${mainIdea.trim().length > 48 ? "…" : ""}` : "Set the main idea"}
              </span>
              <span className="ai-issue-chevron" aria-hidden style={{ transform: ideaOpen ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
            </button>
            {ideaOpen && (
              <div className="ai-focus-body">
                <textarea
                  className="ai-focus-input"
                  value={mainIdea}
                  onChange={(e) => {
                    setMainIdea(e.target.value);
                    saveMainIdea(e.target.value);
                  }}
                  placeholder="e.g. the feeling of leaving home for the first time…"
                  rows={2}
                />
                <p className="ai-focus-hint muted small">Gives the AI context about what the poem is about.</p>
              </div>
            )}
          </div>

          {/* Writing focus */}
          <div className="ai-focus-section">
            <button
              type="button"
              className="ai-focus-toggle"
              onClick={() => setFocusOpen((v) => !v)}
            >
              <span className="ai-focus-toggle-label">
                {writingFocus.trim() ? `Focus: ${writingFocus.trim().slice(0, 48)}${writingFocus.trim().length > 48 ? "…" : ""}` : "Set a writing focus"}
              </span>
              <span className="ai-issue-chevron" aria-hidden style={{ transform: focusOpen ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
            </button>
            {focusOpen && (
              <div className="ai-focus-body">
                <textarea
                  className="ai-focus-input"
                  value={writingFocus}
                  onChange={(e) => {
                    setWritingFocus(e.target.value);
                    saveWritingFocus(e.target.value);
                  }}
                  placeholder="e.g. strengthen the imagery in the second stanza, make the ending more surprising…"
                  rows={2}
                />
                <p className="ai-focus-hint muted small">The AI will weight its feedback toward this goal.</p>
              </div>
            )}
          </div>

          {/* Word count hint */}
          {hasPoem && status !== "loading" && (
            <p className="ai-word-hint muted small">
              {wordCount} word{wordCount !== 1 ? "s" : ""}
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
                Scores your poem on <strong>Imagery</strong>,{" "}
                <strong>Musicality</strong>, <strong>Originality</strong>, and{" "}
                <strong>Clarity</strong> — then gives line-level feedback with
                specific suggestions. After the first run, <strong>Compare</strong>{" "}
                shows exactly what improved between drafts.
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
              />
              <button type="button"
                className="small-btn ai-rerun-btn"
                onClick={() => void handleAnalyze()}>
                Analyze again
              </button>
              <AiChat title={title} lines={lines} result={result} model={model} />
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
}: {
  title: string;
  lines: string[];
  result: PoemAnalysis | PoemComparison;
  model: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatStatus, setChatStatus] = useState<"idle" | "loading" | "error">("idle");
  const [chatError, setChatError] = useState("");
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

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || chatStatus === "loading") return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setChatStatus("loading");
    setChatError("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, lines, message: text, analysisContext, model }),
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
  }, [input, chatStatus, title, lines, analysisContext, model]);

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
