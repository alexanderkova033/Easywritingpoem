import "./AiSummaryPopover.css";
import { useEffect, useRef, useState } from "react";
import type { PoemAnalysis, PoemComparison } from "@/workshop/analysis/ai-analyze";
import { scoreColor, scoreLabel } from "./ai-analysis-helpers";

function ScoreRing({ score }: { score: number }) {
  const r = 24;
  const circ = 2 * Math.PI * r;
  const color = scoreColor(score);
  const offset = circ - (score / 100) * circ;
  return (
    <svg className="ai-pop-ring" viewBox="0 0 60 60" aria-hidden width="48" height="48">
      <circle cx="30" cy="30" r={r} fill="none"
        stroke="color-mix(in srgb, currentColor 12%, transparent)" strokeWidth="5" />
      <circle cx="30" cy="30" r={r} fill="none"
        stroke={color} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 30 30)"
      />
    </svg>
  );
}

export interface AiSummaryPopoverProps {
  result: PoemAnalysis | PoemComparison;
  scoringEnabled: boolean;
  onJumpToLine?: (line: number) => void;
  /** Fires when user clicks one of the tab-jump buttons inside the popover. */
  onOpenTab?: (tab: "overview" | "issues" | "chat") => void;
  visibleIssueCount?: number;
}

export function AiSummaryPopover({ result, scoringEnabled, onJumpToLine, onOpenTab, visibleIssueCount }: AiSummaryPopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const strengths = result.strengths ?? [];
  const weaknesses = result.weaknesses ?? [];

  return (
    <div className="ai-pop-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`ai-pop-trigger${open ? " is-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="AI summary"
        aria-expanded={open}
      >
        <span className="ai-pop-trigger-mark" aria-hidden>✦</span>
        {scoringEnabled && (
          <span className="ai-pop-trigger-score" style={{ color: scoreColor(result.overall_score) }}>
            {result.overall_score}
          </span>
        )}
      </button>

      {open && (
        <div className="ai-pop-panel" role="dialog" aria-label="AI summary">
          {scoringEnabled && (
            <div className="ai-pop-score-row">
              <div className="ai-pop-ring-wrap">
                <ScoreRing score={result.overall_score} />
                <span
                  className="ai-pop-score-num"
                  style={{ color: scoreColor(result.overall_score) }}
                >
                  {result.overall_score}
                </span>
              </div>
              <span
                className="ai-pop-verdict"
                style={{ color: scoreColor(result.overall_score) }}
              >
                {scoreLabel(result.overall_score)}
              </span>
            </div>
          )}

          {result.warm_reaction && (
            <p className="ai-pop-reaction">&ldquo;{result.warm_reaction}&rdquo;</p>
          )}

          {result.strongest_line && onJumpToLine && (
            <button
              type="button"
              className="ai-pop-strongest"
              onClick={() => { onJumpToLine(result.strongest_line!.line); setOpen(false); }}
              title={result.strongest_line.why}
            >
              <span aria-hidden>★</span> Line {result.strongest_line.line}
              {result.strongest_line.why && (
                <span className="ai-pop-strongest-why"> · {result.strongest_line.why}</span>
              )}
            </button>
          )}

          {strengths.length > 0 && (
            <div className="ai-pop-section">
              <span className="ai-pop-section-label">Strengths</span>
              <ul className="ai-pop-list ai-pop-list-strengths">
                {strengths.slice(0, 3).map((s, i) => <li key={`s-${i}`}>{s}</li>)}
              </ul>
            </div>
          )}

          {weaknesses.length > 0 && (
            <div className="ai-pop-section">
              <span className="ai-pop-section-label">Work on</span>
              <ul className="ai-pop-list ai-pop-list-weaknesses">
                {weaknesses.slice(0, 3).map((s, i) => <li key={`w-${i}`}>{s}</li>)}
              </ul>
            </div>
          )}

          {result.personal_feedback && (
            <div className="ai-pop-section ai-pop-personal">
              <span className="ai-pop-section-label">For you</span>
              <p className="ai-pop-personal-text">{result.personal_feedback}</p>
            </div>
          )}

          {onOpenTab && (
            <div className="ai-pop-actions">
              <button type="button" className="ai-pop-action-btn"
                onClick={() => { onOpenTab("overview"); setOpen(false); }}>
                Overview
              </button>
              <button type="button" className="ai-pop-action-btn"
                onClick={() => { onOpenTab("issues"); setOpen(false); }}>
                Issues
                {typeof visibleIssueCount === "number" && visibleIssueCount > 0 && (
                  <span className="ai-pop-action-badge">{visibleIssueCount}</span>
                )}
              </button>
              <button type="button" className="ai-pop-action-btn"
                onClick={() => { onOpenTab("chat"); setOpen(false); }}>
                Chat
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
