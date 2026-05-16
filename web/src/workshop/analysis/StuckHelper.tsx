import { useState, useCallback, useRef } from "react";
import { parseAiErrorAndNotify } from "@/workshop/ai-cost/aiBudgetBus";
import "./StuckHelper.css";

type SuggestType = "idea" | "continue" | "rhyme" | "spark";

interface SuggestResult {
  suggestions: string[];
  rhymes_with?: string;
}

interface TypeMeta {
  id: SuggestType;
  icon: string;
  label: string;
  desc: string;
  emptyQuote: string;
  emptyHint: string;
}

const TYPE_CONFIG: TypeMeta[] = [
  {
    id: "idea",
    icon: "💡",
    label: "Idea",
    desc: "Generate a poem concept or starting point.",
    emptyQuote: "A blank page is a beginning.",
    emptyHint: "Generate three concrete starting points — scene, mood, opening phrase.",
  },
  {
    id: "continue",
    icon: "→",
    label: "Continue",
    desc: "What could come next.",
    emptyQuote: "Where does this poem want to go?",
    emptyHint: "Generate three possible next lines that match your tone.",
  },
  {
    id: "rhyme",
    icon: "♪",
    label: "Rhyme",
    desc: "Rhymes for your last line.",
    emptyQuote: "Endings echo.",
    emptyHint: "Generate rhymes for the final word of your poem.",
  },
  {
    id: "spark",
    icon: "⚡",
    label: "Angle",
    desc: "Break out of a rut with a new direction.",
    emptyQuote: "Try the unexpected.",
    emptyHint: "Generate three pivots — unusual angles, what-ifs, surprises.",
  },
];

async function fetchSuggestions(
  title: string,
  lines: string[],
  type: SuggestType,
  context: string,
): Promise<SuggestResult> {
  const res = await fetch("/api/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, lines, type, context }),
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
}

export function StuckHelper({ title, lines, onInsert }: StuckHelperProps) {
  const [activeType, setActiveType] = useState<SuggestType>(() =>
    lines.some((l) => l.trim().length > 0) ? "continue" : "idea"
  );
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [resultMode, setResultMode] = useState<SuggestType | null>(null);
  const contextInputRef = useRef<HTMLInputElement>(null);

  const titleRef = useRef(title);
  const linesRef = useRef(lines);
  const contextRef = useRef(context);
  titleRef.current = title;
  linesRef.current = lines;
  contextRef.current = context;

  const handleGenerate = useCallback(async () => {
    const suggestType = activeType;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const data = await fetchSuggestions(
        titleRef.current,
        linesRef.current,
        suggestType,
        contextRef.current,
      );
      setResult(data);
      setResultMode(suggestType);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeType]);

  const handleSelectMode = useCallback((type: SuggestType) => {
    setActiveType(type);
    setResult(null);
    setResultMode(null);
    setError(null);
  }, []);

  const activeConfig = TYPE_CONFIG.find((c) => c.id === activeType)!;
  const isRhyme = resultMode === "rhyme";

  const resultLabel = () => {
    if (resultMode === "idea") return "Poem ideas";
    if (resultMode === "rhyme") return result?.rhymes_with ? `Rhymes with "${result.rhymes_with}"` : "Rhyme suggestions";
    if (resultMode === "spark") return "New directions";
    return "Continue with…";
  };

  return (
    <div className="sh-root" data-mode={activeType}>
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

      {/* Empty-state preview card — shows before first generate for active mode */}
      {!loading && !result && !error && (
        <div className="sh-empty-card" data-mode={activeType}>
          <p className="sh-empty-quote">{activeConfig.emptyQuote}</p>
          <p className="sh-empty-hint">{activeConfig.emptyHint}</p>
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
          disabled={loading}
        >
          {loading ? (
            <><span className="sh-btn-spinner" aria-hidden /> Generating…</>
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
        <div className="sh-results" data-mode={resultMode ?? activeType}>
          <div className="sh-results-header">
            <span className="sh-results-label">{resultLabel()}</span>
            <span className="sh-results-count">{result.suggestions.length}</span>
          </div>

          {isRhyme ? (
            <div className="sh-rhyme-cloud">
              {result.suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  className="sh-rhyme-chip"
                  style={{ animationDelay: `${i * 40}ms` }}
                  onClick={() => onInsert?.(s)}
                  title={onInsert ? "Insert into poem" : s}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : (
            <div className="sh-suggestions">
              {result.suggestions.map((s, i) => (
                <SuggestionCard
                  key={i}
                  index={i + 1}
                  text={s}
                  delayMs={i * 60}
                  onInsert={onInsert}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

function SuggestionCard({
  index,
  text,
  delayMs,
  onInsert,
}: {
  index: number;
  text: string;
  delayMs: number;
  onInsert?: (text: string) => void;
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
    if (onInsert) {
      onInsert(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
    }
    setApplied(true);
    setTimeout(() => setApplied(false), 1800);
  }, [onInsert, text]);

  const numeral = ROMAN[index - 1] ?? String(index);

  return (
    <div className="sh-suggestion" style={{ animationDelay: `${delayMs}ms` }}>
      <span className="sh-suggestion-numeral" aria-hidden>{numeral}</span>
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
        {onInsert && (
          <button
            type="button"
            className={`sh-apply-btn${applied ? " is-applied" : ""}`}
            onClick={handleApply}
            title="Append to poem"
          >
            {applied ? "✓ Done" : "↓ Use"}
          </button>
        )}
      </div>
    </div>
  );
}
