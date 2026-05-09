import "./AiSummaryPopover.css";
import { useEffect, useRef, useState } from "react";
import type { PoemAnalysis, PoemComparison } from "@/workshop/analysis/ai-analyze";

function scoreColor(score: number): string {
  if (score >= 80) return "var(--ai-score-high, #5fba7d)";
  if (score >= 55) return "var(--ai-score-mid, #e6a817)";
  return "var(--ai-score-low, #d95f5f)";
}

export interface AiSummaryPopoverProps {
  result: PoemAnalysis | PoemComparison;
  scoringEnabled: boolean;
  onJumpToLine?: (line: number) => void;
}

export function AiSummaryPopover({ result, scoringEnabled, onJumpToLine }: AiSummaryPopoverProps) {
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
        </div>
      )}
    </div>
  );
}
