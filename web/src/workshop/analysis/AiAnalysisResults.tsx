import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AnalysisIssue,
  type ComparisonChanges,
  type LocalAnalysisContext,
  type PoemAnalysis,
  type PoemComparison,
} from "@/workshop/analysis/ai-analyze";
import { computeVoiceFingerprint } from "@/workshop/analysis/voice-fingerprint";
import {
  LS_IGNORED_PREFIX,
  LS_RESOLVED_PREFIX,
  loadIdSet,
  saveIdSet,
} from "./ai-analysis-storage";
import {
  deriveCategory,
  scoreColor,
  scoreLabel,
} from "./ai-analysis-helpers";
import { ScoreRing, ScoreSparkline } from "./AiScoreViz";
import { IssueCard } from "./AiIssueCard";
import { AiChat } from "./AiChat";

export type AnalysisTab = "overview" | "issues" | "chat";

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

export function AnalysisResults({
  result, onJump, onPeek, onHighlight, onClearHighlight, onApplyLine, poemLines, originalLines, poemTitle, model,
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
  /** Lines of the poem at the time of the analysis — used by the per-issue re-check button. */
  originalLines?: string[];
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
  const [personalExpanded, setPersonalExpanded] = useState(false);
  const voiceFingerprint = useMemo(
    () => computeVoiceFingerprint(),
    [result.meta.analyzedAt],
  );
  const [cmpToastDismissed, setCmpToastDismissed] = useState(false);
  const lastResultIdRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (!externalTabSignal) return;
    setTab(externalTabSignal.tab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTabSignal?.nonce]);

  useEffect(() => { saveIdSet(LS_RESOLVED_PREFIX, poemId, resolvedIds); }, [poemId, resolvedIds]);
  useEffect(() => { saveIdSet(LS_IGNORED_PREFIX, poemId, ignoredIds); }, [poemId, ignoredIds]);

  const visibleIssues = useMemo(() => {
    const strongestLineNo = result.strongest_line?.line;
    return result.issues.filter((i) => {
      if (ignoredIds.has(i.id)) return false;
      if (strongestLineNo != null && i.line_start === strongestLineNo && i.line_end === strongestLineNo) return false;
      return true;
    });
  }, [result.issues, result.strongest_line, ignoredIds]);

  useEffect(() => {
    onVisibleIssuesChange?.(visibleIssues);
  }, [visibleIssues, onVisibleIssuesChange]);

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

  const issueCategories = useMemo(() => {
    const map = new Map<string, { label: string; color: string } | null>();
    for (const iss of result.issues) map.set(iss.id, deriveCategory(iss));
    return map;
  }, [result.issues]);

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
      originalLines={originalLines}
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
                <div className="ai-feedback-card ai-feedback-overall is-expanded">
                  <span className="ai-feedback-label">Overall</span>
                  <p className="ai-feedback-text">
                    {result.overall_feedback}
                  </p>
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
