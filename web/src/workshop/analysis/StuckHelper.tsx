import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { parseAiErrorAndNotify } from "@/workshop/ai-cost/aiBudgetBus";
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
  { id: "idea",     icon: "💡", label: "Idea",     desc: "Generate a poem concept or starting point." },
  { id: "continue", icon: "→",  label: "Continue", desc: "What could come next." },
  { id: "words",    icon: "✦",  label: "Words",    desc: "Vivid alternatives for the wording." },
  { id: "rhyme",    icon: "♪",  label: "Rhyme",    desc: "Rhymes for your last line." },
  { id: "spark",    icon: "⚡", label: "Angle",    desc: "Break out of a rut with a new direction." },
  { id: "line",     icon: "✏",  label: "Fix line", desc: "Rewrite a specific line." },
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
    const { message } = await parseAiErrorAndNotify(res, "suggest");
    throw new Error(message);
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
  const contextInputRef = useRef<HTMLInputElement>(null);

  const nonEmptyLines = useMemo(
    () => lines
      .map((text, i) => ({ text, num: i + 1 }))
      .filter(({ text }) => text.trim().length > 0),
    [lines],
  );

  const targetLineText = targetLineNum != null
    ? (lines[targetLineNum - 1] ?? "")
    : "";

  const isFirstRender = useRef(true);

  const titleRef   = useRef(title);
  const linesRef   = useRef(lines);
  const contextRef = useRef(context);
  titleRef.current   = title;
  linesRef.current   = lines;
  contextRef.current = context;

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
        contextRef.current,
        targetLine,
      );
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeType, targetLineText]); // eslint-disable-line

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

  const activeConfig = TYPE_CONFIG.find((c) => c.id === activeType)!;

  const resultLabel = () => {
    if (activeType === "idea")     return "Poem ideas";
    if (activeType === "words")    return "Word alternatives";
    if (activeType === "rhyme")    return result?.rhymes_with ? `Rhymes for "${result.rhymes_with}"` : "Rhyme suggestions";
    if (activeType === "spark")    return "New directions";
    if (activeType === "line")     return "Line rewrites";
    return "Continue with…";
  };

  const generateDisabled = loading || (activeType === "line" && !targetLineText.trim());

  return (
    <div className="sh-root">
      {/* Pill tab strip */}
      <div className="sh-tabs" role="tablist" aria-label="Suggestion mode">
        {TYPE_CONFIG.map(({ id, icon, label, desc }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeType === id}
            className={`sh-tab${activeType === id ? " is-active" : ""}`}
            onClick={() => handleSelectMode(id)}
            title={desc}
          >
            <span className="sh-tab-icon" aria-hidden>{icon}</span>
            <span className="sh-tab-label">{label}</span>
          </button>
        ))}
      </div>

      {/* Active mode description */}
      <p className="sh-tab-desc">{activeConfig.desc}</p>

      {/* Line picker for "Fix a line" */}
      {activeType === "line" && (
        <div className="sh-line-picker">
          {nonEmptyLines.length === 0 ? (
            <p className="sh-empty-hint">Write a few lines first.</p>
          ) : (
            <div className="sh-line-list">
              {nonEmptyLines.map(({ text, num }) => (
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
              ))}
            </div>
          )}
        </div>
      )}

      {/* Controls row: note chip + generate */}
      <div className="sh-controls">
        {!showContext ? (
          <button
            type="button"
            className={`sh-note-chip${context.trim() ? " has-value" : ""}`}
            onClick={() => {
              setShowContext(true);
              setTimeout(() => contextInputRef.current?.focus(), 30);
            }}
            title={context.trim() ? `Note: ${context}` : "Add an optional steering note"}
          >
            <span aria-hidden>+</span>
            {context.trim() ? "Edit note" : "Note"}
          </button>
        ) : (
          <div className="sh-note-row">
            <input
              ref={contextInputRef}
              type="text"
              className="sh-note-input"
              placeholder='Steer the suggestions — e.g. "more concrete imagery"'
              value={context}
              onChange={(e) => setContext(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { setShowContext(false); void handleGenerate(); }
                else if (e.key === "Escape") { setShowContext(false); }
              }}
              maxLength={200}
              aria-label="Optional context note"
            />
            <button
              type="button"
              className="sh-note-close"
              onClick={() => setShowContext(false)}
              aria-label="Close note"
              title="Done"
            >✓</button>
          </div>
        )}

        <button
          type="button"
          className="sh-generate-btn"
          onClick={() => void handleGenerate()}
          disabled={generateDisabled}
        >
          {loading ? (
            <><span className="sh-btn-spinner" aria-hidden /> Generating…</>
          ) : activeType === "line" ? (
            <>↺ Rewrite line</>
          ) : result ? (
            <>↺ Try again</>
          ) : (
            <>✦ Generate</>
          )}
        </button>
      </div>

      {error && (
        <div className="sh-error" role="alert">{error}</div>
      )}

      {/* Skeleton while loading */}
      {loading && !result && (
        <div className="sh-skeleton" aria-hidden>
          <div className="sh-skel-card" />
          <div className="sh-skel-card" />
          <div className="sh-skel-card" />
        </div>
      )}

      {result && !loading && (
        <div className="sh-results">
          <div className="sh-results-header">
            <span className="sh-results-label">{resultLabel()}</span>
            <span className="sh-results-count">{result.suggestions.length}</span>
          </div>
          <div className="sh-suggestions">
            {result.suggestions.map((s, i) => (
              <SuggestionCard
                key={i}
                index={i + 1}
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
  index,
  text,
  onInsert,
  onReplace,
}: {
  index: number;
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
      onInsert(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
    }
    setApplied(true);
    setTimeout(() => setApplied(false), 1800);
  }, [onReplace, onInsert, text]);

  const canApply = Boolean(onReplace || onInsert);
  const applyLabel = onReplace ? "Replace" : "Use";
  const applyTitle = onReplace ? "Replace the selected line in the poem" : "Append to poem";

  return (
    <div className="sh-suggestion">
      <span className="sh-suggestion-index" aria-hidden>{index}</span>
      <p className="sh-suggestion-text">{text}</p>
      <div className="sh-suggestion-actions">
        <button
          type="button"
          className={`sh-icon-btn${copied ? " is-copied" : ""}`}
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy"}
          title={copied ? "Copied!" : "Copy"}
        >
          {copied ? "✓" : "⎘"}
        </button>
        {canApply && (
          <button
            type="button"
            className={`sh-apply-btn${applied ? " is-applied" : ""}${onReplace ? " sh-replace-btn" : ""}`}
            onClick={handleApply}
            title={applyTitle}
          >
            {applied ? "✓ Done" : (onReplace ? applyLabel : `↓ ${applyLabel}`)}
          </button>
        )}
      </div>
    </div>
  );
}
