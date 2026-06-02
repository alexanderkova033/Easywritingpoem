import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisIssue, RecheckResult } from "@/workshop/analysis/ai-analyze";
import { recheckIssue } from "@/workshop/analysis/ai-analyze";
import { parseAiErrorAndNotify } from "@/workshop/ai-cost/aiBudgetBus";
import {
  deriveCategory,
  renderRationaleWithMarks,
  severityColor,
  useCopyFlash,
} from "./ai-analysis-helpers";

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

export function IssueCard({
  issue, index, isOpen, onOpenChange, isResolved, onResolve, onIgnore,
  onJump, onHighlight, onClearHighlight, onApplyLine, poemLines, originalLines, poemTitle, model,
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
  /** Lines as they were at the time of the analysis (used for the re-check button). */
  originalLines?: string[];
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

  const [recheckLoading, setRecheckLoading] = useState(false);
  const [recheckResult, setRecheckResult] = useState<RecheckResult | null>(null);
  const [recheckError, setRecheckError] = useState("");
  const recheckAbortRef = useRef<AbortController | null>(null);

  const originalLineText = poemLines
    ? poemLines.slice(issue.line_start - 1, issue.line_end).join("\n")
    : null;

  const oldLineText = originalLines
    ? originalLines.slice(issue.line_start - 1, issue.line_end).join("\n")
    : "";
  const newLineText = poemLines
    ? poemLines.slice(issue.line_start - 1, issue.line_end).join("\n")
    : "";
  const lineUnchanged =
    !!originalLines && !!poemLines && oldLineText.trim() === newLineText.trim();
  const recheckAvailable = !!originalLines && !!poemLines && !!model && !!issue.rationale;

  const handleRecheck = useCallback(async () => {
    if (!recheckAvailable || recheckLoading) return;
    recheckAbortRef.current?.abort();
    const ctrl = new AbortController();
    recheckAbortRef.current = ctrl;
    setRecheckLoading(true);
    setRecheckError("");
    setRecheckResult(null);
    try {
      // Small surrounding context — one line above and below the issue range.
      const start = Math.max(1, issue.line_start - 1);
      const end = Math.min(poemLines?.length ?? issue.line_end, issue.line_end + 1);
      const ctx = (poemLines ?? [])
        .slice(start - 1, end)
        .map((l, i) => `${start + i}: ${l}`)
        .join("\n");
      const out = await recheckIssue(
        {
          oldLine: oldLineText,
          newLine: newLineText,
          context: ctx,
          rationale: issue.rationale,
          headline: issue.headline,
          lineRange: rangeLabel,
        },
        model!,
        ctrl.signal,
      );
      setRecheckResult(out);
      if (out.status === "resolved") onResolve(true);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setRecheckError((err as Error).message ?? "Could not re-check this issue.");
    } finally {
      setRecheckLoading(false);
    }
  }, [
    recheckAvailable, recheckLoading, oldLineText, newLineText, poemLines, issue.line_start,
    issue.line_end, issue.rationale, issue.headline, rangeLabel, model, onResolve,
  ]);

  useEffect(() => () => recheckAbortRef.current?.abort(), []);

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
          {recheckAvailable && !isResolved && (
            <button
              type="button"
              className="ai-recheck-btn-compact"
              onClick={handleRecheck}
              disabled={recheckLoading || lineUnchanged}
              title={
                lineUnchanged
                  ? "Edit the line first, then click to ask the AI if your fix addressed this issue"
                  : "Re-check fix — ask the AI if your edit addressed this issue"
              }
              aria-label="Re-check fix"
            >
              {recheckLoading ? <span className="ai-chat-dot" /> : <span aria-hidden>↻</span>}
            </button>
          )}
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

          {/* Recheck feedback (button moved to header actions) */}
          {recheckAvailable && (recheckLoading || recheckResult || recheckError) && (
            <div className="ai-issue-recheck-row">
              {recheckLoading && (
                <span className="ai-issue-recheck-hint muted small">
                  <span className="ai-chat-dot" />
                  <span className="ai-chat-dot" />
                  <span className="ai-chat-dot" />
                  <span>Re-checking…</span>
                </span>
              )}
              {recheckResult && (
                <div className={`ai-issue-recheck-result ai-issue-recheck-${recheckResult.status}`}>
                  <span className="ai-issue-recheck-status">
                    {recheckResult.status === "resolved" && "✓ Resolved"}
                    {recheckResult.status === "partial" && "◐ Partly addressed"}
                    {recheckResult.status === "still" && "○ Still present"}
                    {recheckResult.status === "elsewhere" && "△ New concern"}
                  </span>
                  {recheckResult.note && (
                    <span className="ai-issue-recheck-note">{recheckResult.note}</span>
                  )}
                </div>
              )}
              {recheckError && (
                <p className="ai-issue-recheck-err">{recheckError}</p>
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
