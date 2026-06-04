import "./AiAnalysis.css";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzePoem,
  comparePoem,
  type AnalysisIssue,
  type HarshnessLevel,
  type LocalAnalysisContext,
  type PoemAnalysis,
  type PoemComparison,
} from "@/workshop/analysis/ai-analyze";
import type { WorkshopGoals } from "@/workshop/goals/types";
import { tryLocalStorageSetItem } from "@/shared/platform/browser-storage";
import { STORAGE_KEY_AI_SCORING_ENABLED } from "@/shared/storage-keys";
import {
  LS_LAST_ANALYSIS_PREFIX,
  LS_LAST_ANALYZED_LINES_PREFIX,
  LS_RESOLVED_PREFIX,
  LS_IGNORED_PREFIX,
  LS_DISMISSED_PREFIX,
  loadLastAnalysis,
  saveLastAnalysis,
  loadLastAnalyzedLines,
  saveLastAnalyzedLines,
  loadIgnoredIssueIds,
} from "./ai-analysis-storage";
import {
  LS_CHAT_PREFIX,
  LS_LAST_HASH_PREFIX,
  LS_SCORE_HISTORY_PREFIX,
  LS_SNAPSHOTS_PREFIX,
  appendScoreHistory,
  hashInput,
  loadLastHash,
  loadScoreHistory,
  loadScoringEnabled,
  pushSnapshot,
  saveLastHash,
} from "./ai-analysis-helpers";
import { AnalysisResults, type AnalysisTab } from "./AiAnalysisResults";
export { loadLastAnalysis, loadIgnoredIssueIds };

export interface AiAnalysisProps {
  title: string;
  lines: string[];
  mainIdea?: string;
  poemId?: string;
  localAnalysis?: LocalAnalysisContext;
  goals?: WorkshopGoals;
  onJumpToLine?: (line: number) => void;
  /** Place the editor cursor at the start of a specific word on a line. */
  onJumpToWord?: (line: number, phrase: string) => void;
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

export function AiAnalysis({ title, lines, mainIdea, poemId, localAnalysis, goals, onJumpToLine, onJumpToWord, onPeekLine, onHighlightLines, onClearHighlight, onAnalysisDone, onVisibleIssuesChange, onApplyLine, onAnalyzeRef, onLoadingChange, onOpenIssueAtLineRef, onResultChange, onSwitchTabRef }: AiAnalysisProps) {
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
  const [savedLines, setSavedLines] = useState<string[]>(
    () => loadLastAnalyzedLines(poemId),
  );
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
      setSavedLines(loadLastAnalyzedLines(poemId));
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
    // Don't even attempt a new request while the rate-limit countdown is active —
    // the prior result should stay on screen, and we shouldn't churn the UI into
    // a loading state just to hit a 429 again.
    if (retryAfterSec > 0) return;
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
    // successful analysis — applies to BOTH fresh reads and Refines. The "compare
    // vs fresh" mode is intentionally NOT part of the hash, so clicking Refine on
    // an unchanged poem returns the same saved score instead of burning tokens.
    const inputHash = hashInput([
      lines.join("\n"),
      title,
      harshness,
      mainIdea ?? "",
    ].join("|"));
    if (result && loadLastHash(poemId) === inputHash) {
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
            previousWeaknesses: savedResult!.weaknesses,
            previousIssues: savedResult!.issues
              .filter((i) => i.severity !== "low")
              .slice(0, 6)
              .map((i) => ({
                line_start: i.line_start,
                line_end: i.line_end,
                headline: i.headline,
              })),
          },
          ctrl.signal,
        );
      } else {
        res = await analyzePoem({ title, lines, localAnalysis, goals: goalsPlain, harshness, writingFocus }, ctrl.signal);
      }
      // A new analysis replaces the prior one — resolution flags keyed to the
      // OLD issue IDs no longer apply (and would silently mark re-flagged
      // issues as "already resolved" if the model returns a colliding id like
      // "weak-opening"). Clear the per-issue stores, then bump sessionNonce so
      // AnalysisResults remounts and re-reads the now-empty sets.
      if (poemId) {
        try {
          localStorage.removeItem(LS_RESOLVED_PREFIX + poemId);
          localStorage.removeItem(LS_IGNORED_PREFIX + poemId);
          localStorage.removeItem(LS_DISMISSED_PREFIX + poemId);
        } catch { /* ignore */ }
      }
      setResult(res);
      setSavedResult(res);
      setSavedLines(lines);
      saveLastAnalysis(poemId, res);
      saveLastAnalyzedLines(poemId, lines);
      saveLastHash(poemId, inputHash);
      pushSnapshot(poemId, res);
      onAnalysisDone?.(res.issues, res.overall_score);
      setScoreHistory(appendScoreHistory(poemId, res.overall_score));
      setSessionNonce((n) => n + 1);
      setStatus("done");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const e = err as Error & { retryAfterSec?: number };
      const msg = e.message ?? "Unknown error";
      const isRateLimit = typeof e.retryAfterSec === "number" && e.retryAfterSec > 0;
      if (isRateLimit) {
        setRetryAfterSec(e.retryAfterSec!);
      }
      if (msg.toLowerCase().includes("not configured") || msg.toLowerCase().includes("api key")) {
        setIsUnconfigured(true);
        setStatus("idle");
      } else if (result) {
        // Keep the previous result on screen no matter what failed — a stale
        // read is strictly better than a blank panel. Rate limits are signalled
        // via the retry banner; other failures get a small error banner shown
        // above the results.
        if (!isRateLimit) setErrorMsg(msg);
        setStatus("done");
      } else {
        setErrorMsg(msg);
        setStatus("error");
      }
    }
  }, [canCompare, hasPoem, harshness, lines, mainIdea, savedLines, savedResult, title, scoreHistory, poemId, localAnalysis, goals, onAnalysisDone, result, retryAfterSec]);


  useEffect(() => {
    onAnalyzeRef?.(() => { if (hasPoem) void handleAnalyze(); });
  }, [handleAnalyze, hasPoem, onAnalyzeRef]);

  const handleNewSession = useCallback(() => {
    abortRef.current?.abort();
    if (poemId) {
      try {
        localStorage.removeItem(LS_LAST_ANALYSIS_PREFIX + poemId);
        localStorage.removeItem(LS_LAST_ANALYZED_LINES_PREFIX + poemId);
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

              <div className="ai-harshness-toggle" role="group" aria-label="Feedback tone">
                {([
                  { id: "casual" as const, label: "Gentle", icon: "♡" },
                  { id: "editor" as const, label: "Honest", icon: "※" },
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
                disabled={!hasPoem || status === "loading" || retryAfterSec > 0}
                title={
                  !hasPoem ? "Write some lines first"
                    : retryAfterSec > 0 ? `Rate limit — wait ${retryAfterSec}s`
                    : undefined
                }>
                {status === "loading"
                  ? (effectiveMode === "compare" ? "Refining…" : "Reading…")
                  : effectiveMode === "compare"
                    ? "⟳ Refine"
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

          {/* When a refresh fails but a prior result is on screen, surface the
              error as a small banner above the stale results. */}
          {status === "done" && result && errorMsg && (
            <div className="ai-error ai-error-inline" role="alert">
              <p className="ai-error-text">
                Couldn't refresh: {errorMsg} — showing your last analysis.
              </p>
              <button type="button" className="small-btn"
                onClick={() => setErrorMsg("")}>
                Dismiss
              </button>
            </div>
          )}

          {status === "done" && result && (
            <AnalysisResults
              key={`results-${sessionNonce}`}
              result={result}
              previous={effectiveMode === "compare" ? savedResult : null}
              onJump={onJumpToLine}
              onJumpToWord={onJumpToWord}
              onPeek={onPeekLine}
              onHighlight={onHighlightLines}
              onClearHighlight={onClearHighlight}
              scoreHistory={scoreHistory}
              onApplyLine={onApplyLine}
              poemLines={lines}
              originalLines={savedLines.length > 0 ? savedLines : undefined}
              poemTitle={title}
              poemId={poemId}
              onVisibleIssuesChange={onVisibleIssuesChange}
              openIssueLineSignal={openIssueLineSignal}
              scoringEnabled={scoringEnabled}
              externalTabSignal={externalTabSignal}
              localAnalysis={localAnalysis}
            />
          )}
        </div>
      )}
    </section>
  );
}
