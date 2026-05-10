import "./AiLineRibbons.css";
import { useEffect, useState, useCallback, useRef } from "react";
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

function severityLabel(s?: string): string {
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  return "Low";
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const recompute = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) {
      setPositions([]);
      return;
    }
    const wrapEl = view.dom.parentElement;
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
    const id = window.setInterval(recompute, 500);
    return () => {
      scrollEl.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      ro?.disconnect();
      window.clearInterval(id);
    };
  }, [editorViewRef, recompute]);

  // Close expanded popover on outside click / Escape.
  useEffect(() => {
    if (!expandedId) return;
    const onDown = (e: MouseEvent) => {
      if (!overlayRef.current) return;
      if (!overlayRef.current.contains(e.target as Node)) setExpandedId(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpandedId(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [expandedId]);

  if (positions.length === 0) return null;

  return (
    <div className="ai-ribbons-overlay" ref={overlayRef} aria-hidden="false">
      {positions.map(({ issue, top }) => {
        const isOpen = expandedId === issue.id;
        const sev = issue.severity ?? "low";
        return (
          <div
            key={issue.id}
            className={`ai-ribbon ${severityClass(issue.severity)}${isOpen ? " is-open" : ""}`}
            style={{ top: `${top}px` }}
            role="group"
            aria-label={`Line ${issue.line_start} issue`}
            onMouseEnter={() => setExpandedId(issue.id)}
            onMouseLeave={(e) => {
              // Keep open if focus moved to a child; otherwise close.
              const next = e.relatedTarget as Node | null;
              if (next && e.currentTarget.contains(next)) return;
              if (expandedId === issue.id) setExpandedId(null);
            }}
          >
            <button
              type="button"
              className="ai-ribbon-body"
              onClick={() => setExpandedId(isOpen ? null : issue.id)}
              aria-expanded={isOpen}
              title={issue.headline ?? issue.rationale}
            >
              <span className={`ai-ribbon-dot ai-ribbon-dot-${sev}`} aria-hidden />
              <span className="ai-ribbon-label">
                {issue.headline ?? issue.rationale ?? `Line ${issue.line_start}`}
              </span>
            </button>

            {isOpen && (
              <div className="ai-ribbon-popover" role="dialog" aria-label="Issue details">
                <div className="ai-ribbon-pop-head">
                  <span className={`ai-ribbon-sev-tag ai-ribbon-sev-tag-${sev}`}>
                    {severityLabel(issue.severity)}
                  </span>
                  <span className="ai-ribbon-pop-line">
                    Line {issue.line_start === issue.line_end
                      ? issue.line_start
                      : `${issue.line_start}–${issue.line_end}`}
                  </span>
                  <button
                    type="button"
                    className="ai-ribbon-pop-close"
                    onClick={() => setExpandedId(null)}
                    aria-label="Close"
                  >✕</button>
                </div>
                {issue.headline && (
                  <div className="ai-ribbon-pop-headline">{issue.headline}</div>
                )}
                {issue.rationale && (
                  <p className="ai-ribbon-pop-rationale">{issue.rationale}</p>
                )}
                {issue.rewrite && (
                  <div className="ai-ribbon-pop-rewrite">
                    <span className="ai-ribbon-pop-rewrite-label">Suggested:</span>
                    <span className="ai-ribbon-pop-rewrite-text">{issue.rewrite}</span>
                  </div>
                )}
                <div className="ai-ribbon-pop-actions">
                  {issue.rewrite && (
                    <button
                      type="button"
                      className="ai-ribbon-action ai-ribbon-apply"
                      onClick={() => { onApply(issue); setExpandedId(null); }}
                      title={`Apply rewrite`}
                    >
                      ✦ Apply
                    </button>
                  )}
                  {onSelect && (
                    <button
                      type="button"
                      className="ai-ribbon-action ai-ribbon-open"
                      onClick={() => { onSelect(issue.line_start); setExpandedId(null); }}
                      title="Show in side panel"
                    >
                      Open in panel
                    </button>
                  )}
                  <button
                    type="button"
                    className="ai-ribbon-action ai-ribbon-dismiss"
                    onClick={() => { onIgnore(issue.id); setExpandedId(null); }}
                    aria-label="Ignore issue"
                    title="Ignore"
                  >Ignore</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
