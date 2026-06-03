import "./AiStatusStrip.css";
import { useEffect, useState } from "react";
import type { PoemAnalysis, PoemComparison } from "@/workshop/analysis/ai-analyze";
import { scoreColor } from "./ai-analysis-helpers";

export interface AiStatusStripProps {
  result: PoemAnalysis | PoemComparison;
  scoringEnabled: boolean;
  onJumpToLine?: (line: number) => void;
}

export function AiStatusStrip({ result, scoringEnabled, onJumpToLine }: AiStatusStripProps) {
  // Auto-fade the warm reaction after a few seconds so it doesn't compete
  // with the rest of the strip on subsequent glances.
  const [fadeReaction, setFadeReaction] = useState(false);
  useEffect(() => {
    setFadeReaction(false);
    const id = setTimeout(() => setFadeReaction(true), 6000);
    return () => clearTimeout(id);
  }, [result.warm_reaction, result.meta.analyzedAt]);

  const strengths = result.strengths ?? [];
  const weaknesses = result.weaknesses ?? [];

  return (
    <div className="ai-strip">
      {scoringEnabled && (
        <span
          className="ai-strip-score"
          style={{ color: scoreColor(result.overall_score) }}
          title="Overall score"
        >
          {result.overall_score}
        </span>
      )}

      {result.strongest_line && onJumpToLine && (
        <button
          type="button"
          className="ai-strip-strongest"
          onClick={() => onJumpToLine(result.strongest_line!.line)}
          title={result.strongest_line.why || `Strongest line — line ${result.strongest_line.line}`}
        >
          <span aria-hidden>★</span> L{result.strongest_line.line}
        </button>
      )}

      {strengths.length > 0 && (
        <div className="ai-strip-group" aria-label="Strengths">
          {strengths.slice(0, 3).map((s, i) => (
            <span key={`s-${i}`} className="ai-strip-chip ai-strip-chip-strength" title={s}>
              <span className="ai-strip-mark" aria-hidden>+</span>{s}
            </span>
          ))}
        </div>
      )}

      {weaknesses.length > 0 && (
        <div className="ai-strip-group" aria-label="Weaknesses">
          {weaknesses.slice(0, 3).map((s, i) => (
            <span key={`w-${i}`} className="ai-strip-chip ai-strip-chip-weakness" title={s}>
              <span className="ai-strip-mark" aria-hidden>−</span>{s}
            </span>
          ))}
        </div>
      )}

      {result.warm_reaction && (
        <span className={`ai-strip-reaction${fadeReaction ? " is-faded" : ""}`}>
          &ldquo;{result.warm_reaction}&rdquo;
        </span>
      )}
    </div>
  );
}
