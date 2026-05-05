import { useState, useCallback, useEffect, useRef } from "react";
import "./StuckHelper.css";

type SuggestType = "idea" | "continue" | "words" | "rhyme" | "spark" | "line";

interface SuggestResult {
  suggestions: string[];
  rhymes_with?: string;
}

const TYPE_CONFIG: {
  id: SuggestType;
  icon: string;
  label: string;
  desc: string;
}[] = [
  { id: "idea",     icon: "💡", label: "Poem idea",    desc: "Generate a poem concept or starting point" },
  { id: "continue", icon: "→",  label: "Continue",     desc: "What could come next"      },
  { id: "words",    icon: "✦",  label: "Better words", desc: "Vivid alternatives"         },
  { id: "rhyme",    icon: "♪",  label: "Rhymes",       desc: "For your last line"         },
  { id: "spark",    icon: "⚡", label: "New angle",    desc: "Break out of a rut"         },
  { id: "line",     icon: "✏",  label: "Fix a line",   desc: "Rewrite a specific line"    },
];

async function fetchSuggestions(
  title: string,
  lines: string[],
  type: SuggestType,
  context: string,
  targetLine?: string,
): Promise<SuggestResult> {
  const res = await fetch("/api/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, lines, type, context, targetLine }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<SuggestResult>;
}

export interface StuckHelperProps {
  title: string;
  lines: string[];
  onInsert?: (text: string) => void;
  onReplaceLine?: (lineNum: number, text: string) => void;
}

export function StuckHelper({ title, lines, onInsert, onReplaceLine }: StuckHelperProps) {
  const [activeType, setActiveType] = useState<SuggestType>(() =>
    lines.some((l) => l.trim().length > 0) ? "continue" : "idea"
  );
  const [context, setContext] = useState("");
  const [targetLineNum, setTargetLineNum] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const contextRef = useRef<HTMLInputElement>(null);

  const nonEmptyLines = lines
    .map((text, i) => ({ text, num: i + 1 }))
    .filter(({ text }) => text.trim().length > 0);

  const targetLineText = targetLineNum != null
    ? (lines[targetLineNum - 1] ?? "")
    : "";

  const isFirstRender = useRef(true);

  // Stable refs so effects can call the latest version without stale closures
  const titleRef   = useRef(title);
  const linesRef   = useRef(lines);
  const contextRef2 = useRef(context);
  titleRef.current    = title;
  linesRef.current    = lines;
  contextRef2.current = context;

  // When switching to "line" mode, auto-select last non-empty line if none picked
  useEffect(() => {
    if (activeType === "line" && targetLineNum == null && nonEmptyLines.length > 0) {
      setTargetLineNum(nonEmptyLines[nonEmptyLines.length - 1]!.num);
    }
  }, [activeType]); // eslint-disable-line

  const handleGenerate = useCallback(async (typeOverride?: SuggestType, targetOverride?: string) => {
    const suggestType  = typeOverride  ?? activeType;
    const targetLine   = targetOverride ?? (suggestType === "line" ? targetLineText : undefined);
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const data = await fetchSuggestions(
        titleRef.current,
        linesRef.current,
        suggestType,
        contextRef2.current,
        targetLine,
      );
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeType, targetLineText]); // eslint-disable-line

  // Auto-generate when the user switches mode (skip first render and "line" mode
  // which needs the user to pick a specific line first)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (activeType === "line") return;
    void handleGenerate(activeType);
  }, [activeType]); // eslint-disable-line

  const handleSelectMode = useCallback((type: SuggestType) => {
    setActiveType(type);
    setResult(null);
    setError(null);
  }, []);

  const resultLabel = () => {
    if (!activeType) return "";
    if (activeType === "idea") return "Poem ideas";
    if (activeType === "words") return "Word alternatives";
    if (activeType === "rhyme") return result?.rhymes_with ? `Rhymes for "${result.rhymes_with}"` : "Rhyme suggestions";
    if (activeType === "spark") return "New directions";
    if (activeType === "line") return "Line rewrites";
    return "Continue with…";
  };

  return (
    <div className="sh-root">
      {/* Mode card grid */}
      <div className="sh-card-grid" role="group" aria-label="Suggestion mode">
        {TYPE_CONFIG.map(({ id, icon, label, desc }) => (
          <button
            key={id}
            type="button"
            aria-pressed={activeType === id}
            className={`sh-card${activeType === id ? " is-active" : ""}${id === "idea" ? " sh-card-idea" : ""}`}
            onClick={() => handleSelectMode(id)}
            title={desc}
          >
            <span className="sh-card-icon" aria-hidden>{icon}</span>
            <span className="sh-card-label">{label}</span>
            <span className="sh-card-desc">{desc}</span>
          </button>
        ))}
      </div>

      {/* Active mode body */}
      {(
        <div className="sh-body">
          {/* Line picker for "Fix a line" */}
          {activeType === "line" && (
            <div className="sh-line-picker">
              <p className="sh-section-label">Which line?</p>
              <div className="sh-line-list">
                {nonEmptyLines.length === 0 ? (
                  <p className="sh-empty-hint">Write a few lines first.</p>
                ) : (
                  nonEmptyLines.map(({ text, num }) => (
                    <button
                      key={num}
                      type="button"
                      className={`sh-line-item${targetLineNum === num ? " is-selected" : ""}`}
                      onClick={() => setTargetLineNum(num)}
                      title={`Line ${num}`}
                    >
                      <span className="sh-line-num">{num}</span>
                      <span className="sh-line-text">{text}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Optional context toggle */}
          <button
            type="button"
            className="sh-context-toggle"
            onClick={() => {
              setShowContext((v) => !v);
              if (!showContext) setTimeout(() => contextRef.current?.focus(), 50);
            }}
          >
            <span className="sh-context-toggle-icon" aria-hidden>{showContext ? "▾" : "›"}</span>
            {showContext ? "Hide note" : "Add a note"}<span className="sh-context-toggle-hint"> — optional, e.g. "wants to feel hopeful"</span>
          </button>
          {showContext && (
            <input
              ref={contextRef}
              type="text"
              className="sh-context-input"
              placeholder='e.g. "wants to feel hopeful" or "more concrete imagery"'
              value={context}
              onChange={(e) => setContext(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleGenerate(); }}
              maxLength={200}
              aria-label="Optional context note"
            />
          )}

          {/* Generate / Regenerate button */}
          <button
            type="button"
            className="sh-generate-btn"
            onClick={() => void handleGenerate()}
            disabled={loading || (activeType === "line" && !targetLineText.trim())}
          >
            {loading ? (
              <><span className="sh-btn-spinner" aria-hidden /> Generating…</>
            ) : activeType === "line" ? (
              "↺ Rewrite this line"
            ) : result ? (
              "↺ Try again"
            ) : (
              "✦ Generate"
            )}
          </button>
        </div>
      )}

      {/* Error */}
      {/* (closing brace removed — activeType is always set) */}
      {error && (
        <div className="sh-error" role="alert">{error}</div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="sh-results">
          <div className="sh-results-header">
            <span className="sh-results-label">{resultLabel()}</span>
            <button
              type="button"
              className="sh-regenerate-btn"
              onClick={() => void handleGenerate()}
              title="Generate again"
            >
              ↺ Again
            </button>
          </div>
          <div className="sh-suggestions">
            {result.suggestions.map((s, i) => (
              <SuggestionCard
                key={i}
                text={s}
                onInsert={onInsert}
                onReplace={
                  activeType === "line" && targetLineNum != null && onReplaceLine
                    ? () => onReplaceLine(targetLineNum, s)
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

function SuggestionCard({
  text,
  onInsert,
  onReplace,
}: {
  text: string;
  onInsert?: (text: string) => void;
  onReplace?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [text]);

  const handleApply = useCallback(() => {
    if (onReplace) {
      onReplace();
    } else if (onInsert) {
      // Normalise line endings so multi-line suggestions each become a poem line.
      onInsert(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
    }
    setApplied(true);
    setTimeout(() => setApplied(false), 1800);
  }, [onReplace, onInsert, text]);

  const canApply = Boolean(onReplace || onInsert);
  const applyLabel = onReplace ? "Replace" : "↓ Use";
  const applyTitle = onReplace ? "Replace the selected line in the poem" : "Append to poem";

  return (
    <div className="sh-suggestion">
      <p className="sh-suggestion-text">{text}</p>
      <div className="sh-suggestion-footer">
        <button
          type="button"
          className={`sh-copy-btn${copied ? " is-copied" : ""}`}
          onClick={handleCopy}
          title={copied ? "Copied!" : "Copy to clipboard"}
        >
          {copied ? "✓ Copied" : "⎘ Copy"}
        </button>
        {canApply && (
          <button
            type="button"
            className={`sh-apply-btn${applied ? " is-applied" : ""}${onReplace ? " sh-replace-btn" : ""}`}
            onClick={handleApply}
            title={applyTitle}
          >
            {applied ? "✓ Done" : applyLabel}
          </button>
        )}
      </div>
    </div>
  );
}
