import "./AiLineRibbons.css";
import { useEffect, useState, useCallback } from "react";
import type { MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import type { AnalysisIssue } from "@/workshop/analysis/ai-analyze";

interface RibbonPos {
  issue: AnalysisIssue;
  /** Top offset (px) within the editor body wrap. */
  top: number;
}

export interface AiLineRibbonsProps {
  editorViewRef: MutableRefObject<EditorView | null>;
  issues: AnalysisIssue[];
  ignoredIds?: Set<string>;
  /** Apply rewrite for a specific issue. */
  onApply: (issue: AnalysisIssue) => void;
  /** Ignore an issue (hide its ribbon). */
  onIgnore: (issueId: string) => void;
  /** Click ribbon body — open in side panel as fallback. */
  onSelect?: (line: number) => void;
}

function severityClass(s?: string): string {
  if (s === "high") return "ai-ribbon-sev-high";
  if (s === "medium") return "ai-ribbon-sev-medium";
  return "ai-ribbon-sev-low";
}

export function AiLineRibbons({
  editorViewRef,
  issues,
  ignoredIds,
  onApply,
  onIgnore,
  onSelect,
}: AiLineRibbonsProps) {
  const [positions, setPositions] = useState<RibbonPos[]>([]);

  const recompute = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) {
      setPositions([]);
      return;
    }
    const wrapEl = view.dom.parentElement; // .poem-editor-body-wrap
    if (!wrapEl) return;
    const wrapRect = wrapEl.getBoundingClientRect();
    const next: RibbonPos[] = [];
    for (const iss of issues) {
      if (ignoredIds?.has(iss.id)) continue;
      const lineNo = Math.max(1, Math.min(view.state.doc.lines, iss.line_start));
      try {
        const line = view.state.doc.line(lineNo);
        const coords = view.coordsAtPos(line.from);
        if (!coords) continue;
        const top = coords.top - wrapRect.top;
        next.push({ issue: iss, top });
      } catch { /* line out of range */ }
    }
    setPositions(next);
  }, [editorViewRef, issues, ignoredIds]);

  // Recompute on doc/scroll/resize and whenever the issue set changes.
  useEffect(() => {
    recompute();
    const view = editorViewRef.current;
    if (!view) return;
    const wrapEl = view.dom.parentElement;
    const scrollEl = view.scrollDOM;
    const onScrollOrResize = () => recompute();
    scrollEl.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    let ro: ResizeObserver | null = null;
    if (wrapEl) {
      ro = new ResizeObserver(onScrollOrResize);
      ro.observe(wrapEl);
    }
    // Also re-poll periodically while there are issues — covers font scaling
    // and other layout shifts the listeners miss.
    const id = window.setInterval(recompute, 500);
    return () => {
      scrollEl.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      ro?.disconnect();
      window.clearInterval(id);
    };
  }, [editorViewRef, recompute]);

  if (positions.length === 0) return null;

  return (
    <div className="ai-ribbons-overlay" aria-hidden="false">
      {positions.map(({ issue, top }) => (
        <div
          key={issue.id}
          className={`ai-ribbon ${severityClass(issue.severity)}`}
          style={{ top: `${top}px` }}
          role="group"
          aria-label={`Line ${issue.line_start} issue`}
        >
          <button
            type="button"
            className="ai-ribbon-body"
            onClick={() => onSelect?.(issue.line_start)}
            title={issue.headline ?? issue.rationale}
          >
            <span className={`ai-ribbon-dot ai-ribbon-dot-${issue.severity ?? "low"}`} aria-hidden />
            <span className="ai-ribbon-label">
              {issue.headline ?? issue.rationale ?? `Line ${issue.line_start}`}
            </span>
          </button>
          {issue.rewrite && (
            <button
              type="button"
              className="ai-ribbon-action ai-ribbon-apply"
              onClick={() => onApply(issue)}
              title={`Apply rewrite: ${issue.rewrite}`}
            >
              Apply
            </button>
          )}
          <button
            type="button"
            className="ai-ribbon-action ai-ribbon-dismiss"
            onClick={() => onIgnore(issue.id)}
            aria-label="Ignore issue"
            title="Ignore"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
