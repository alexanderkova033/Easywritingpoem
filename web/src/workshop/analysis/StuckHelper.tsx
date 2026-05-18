import { useState, useCallback, useRef, useMemo } from "react";
import { parseAiErrorAndNotify } from "@/workshop/ai-cost/aiBudgetBus";
import "./StuckHelper.css";

type SuggestType = "idea" | "continue" | "rhyme" | "spark";

interface SuggestResult {
  suggestions: string[];
  rhymes_with?: string;
  exact?: string[];
  near?: string[];
  slant?: string[];
}

interface Batch {
  result: SuggestResult;
  steer?: string;
  note?: string;
  anchor?: string;
  generatedAt: number;
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
    desc: "Starting concepts — scene + feeling.",
    emptyQuote: "A blank page is a beginning.",
    emptyHint: "Concrete starting points: scene, mood, opening phrase.",
  },
  {
    id: "continue",
    icon: "→",
    label: "Continue",
    desc: "What could come next.",
    emptyQuote: "Where does this poem want to go?",
    emptyHint: "Next lines that match your tone. Place your cursor or select a passage to anchor the continuation.",
  },
  {
    id: "rhyme",
    icon: "♪",
    label: "Rhyme",
    desc: "Exact, near, and slant rhymes.",
    emptyQuote: "Endings echo.",
    emptyHint: "Rhymes for your last word — grouped by exact, near, and slant.",
  },
  {
    id: "spark",
    icon: "⚡",
    label: "Angle",
    desc: "Structural pivots, not new topics.",
    emptyQuote: "Twist what you already have.",
    emptyHint: "Constraints, swaps, what-ifs — directional pivots on your draft.",
  },
];

const STEER_CHIPS: Record<SuggestType, { id: string; label: string }[]> = {
  idea: [
    { id: "concrete", label: "Concrete" },
    { id: "narrative", label: "Narrative" },
    { id: "lyric", label: "Lyric" },
    { id: "strange", label: "Strange" },
  ],
  continue: [
    { id: "shorter", label: "Shorter" },
    { id: "longer", label: "Longer" },
    { id: "quieter", label: "Quieter" },
    { id: "sharper", label: "Sharper" },
  ],
  rhyme: [
    { id: "exact", label: "Exact only" },
    { id: "open", label: "Open to slant" },
  ],
  spark: [
    { id: "structural", label: "Structural" },
    { id: "imagery", label: "Imagery" },
    { id: "constraint", label: "Constraint" },
    { id: "reverse", label: "Reverse" },
  ],
};

function steerDescription(type: SuggestType, id: string): string {
  // Convert the chip id into an instruction the model can act on.
  const map: Record<string, string> = {
    concrete: "Favour concrete, specific imagery over abstractions.",
    narrative: "Frame each concept as a scene with a small narrative arc.",
    lyric: "Lean lyric — sound and music over plot.",
    strange: "Favour the unusual, the surreal, the unexpected pairing.",
    shorter: "Keep each continuation to one short line.",
    longer: "Allow each continuation to be 2–3 lines, denser.",
    quieter: "Soften the register — more restraint, less drama.",
    sharper: "Push harder edges, stronger verbs, more specificity.",
    exact: "Return only exact perfect rhymes; skip near and slant.",
    open: "Include slant and consonance rhymes generously.",
    structural: "Suggest structural pivots — line breaks, ordering, form.",
    imagery: "Suggest swaps of central imagery or perspective.",
    constraint: "Suggest a writing constraint to apply to the next pass.",
    reverse: "Suggest reversals — flip the speaker, time, or framing.",
  };
  return map[id] ?? `${type}: ${id}`;
}

async function fetchSuggestions(payload: {
  title: string;
  lines: string[];
  type: SuggestType;
  context: string;
  steer?: string;
  cursorLine?: number;
  selectedText?: string;
}): Promise<SuggestResult> {
  const res = await fetch("/api/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
  /** Append to the end of the poem. */
  onInsert?: (text: string) => void;
  /** Insert at the editor cursor (replaces selection if any). Used by Continue. */
  onInsertAtCursor?: (text: string) => void;
  /** 1-based line number where the cursor currently sits. */
  cursorLine?: number;
  /** Currently selected text in the editor, if any. */
  selectedText?: string | null;
}

export function StuckHelper({ title, lines, onInsert, onInsertAtCursor, cursorLine, selectedText }: StuckHelperProps) {
  const [activeType, setActiveType] = useState<SuggestType>(() =>
    lines.some((l) => l.trim().length > 0) ? "continue" : "idea"
  );
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [activeSteer, setActiveSteer] = useState<Record<SuggestType, string | null>>({
    idea: null,
    continue: null,
    rhyme: null,
    spark: null,
  });
  /** Most-recent batch per mode (visible). */
  const [latest, setLatest] = useState<Record<SuggestType, Batch | null>>({
    idea: null,
    continue: null,
    rhyme: null,
    spark: null,
  });
  /** Older batches per mode, newest first, capped at 2. */
  const [history, setHistory] = useState<Record<SuggestType, Batch[]>>({
    idea: [],
    continue: [],
    rhyme: [],
    spark: [],
  });

  const contextInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef(title);
  const linesRef = useRef(lines);
  const contextRef = useRef(context);
  const cursorLineRef = useRef(cursorLine);
  const selectedTextRef = useRef(selectedText);
  titleRef.current = title;
  linesRef.current = lines;
  contextRef.current = context;
  cursorLineRef.current = cursorLine;
  selectedTextRef.current = selectedText;

  const activeConfig = TYPE_CONFIG.find((c) => c.id === activeType)!;
  const currentBatch = latest[activeType];
  const currentHistory = history[activeType];
  const currentSteer = activeSteer[activeType];

  // For continue mode, compute the "anchor" indicator shown above results.
  const continueAnchor = useMemo<string | null>(() => {
    if (activeType !== "continue") return null;
    const sel = (selectedText ?? "").trim();
    if (sel) return `from your selection — "${sel.slice(0, 60)}${sel.length > 60 ? "…" : ""}"`;
    if (cursorLine != null && cursorLine > 0 && cursorLine < lines.length) {
      return `from after line ${cursorLine}`;
    }
    return null;
  }, [activeType, selectedText, cursorLine, lines.length]);

  const handleGenerate = useCallback(async () => {
    const suggestType = activeType;
    const steerId = activeSteer[suggestType];
    const steerInstruction = steerId ? steerDescription(suggestType, steerId) : undefined;
    const sel = (selectedTextRef.current ?? "").trim();
    const cl = cursorLineRef.current;

    setLoading(true);
    setError(null);
    try {
      const data = await fetchSuggestions({
        title: titleRef.current,
        lines: linesRef.current,
        type: suggestType,
        context: contextRef.current,
        steer: steerInstruction,
        cursorLine: suggestType === "continue" ? cl : undefined,
        selectedText: suggestType === "continue" && sel ? sel : undefined,
      });
      const anchor =
        suggestType === "continue"
          ? sel
            ? `selection: "${sel.slice(0, 40)}${sel.length > 40 ? "…" : ""}"`
            : cl != null && cl > 0
              ? `cursor line ${cl}`
              : undefined
          : undefined;
      const batch: Batch = {
        result: data,
        steer: steerInstruction,
        note: contextRef.current.trim() || undefined,
        anchor,
        generatedAt: Date.now(),
      };
      // Push the previous latest into history (cap 2 older batches).
      setHistory((h) => {
        const prev = latest[suggestType];
        if (!prev) return h;
        const next = [prev, ...h[suggestType]].slice(0, 2);
        return { ...h, [suggestType]: next };
      });
      setLatest((l) => ({ ...l, [suggestType]: batch }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeType, activeSteer, latest]);

  const handleSelectMode = useCallback((type: SuggestType) => {
    setActiveType(type);
    setError(null);
  }, []);

  const handleToggleSteer = useCallback((id: string) => {
    setActiveSteer((s) => ({ ...s, [activeType]: s[activeType] === id ? null : id }));
  }, [activeType]);

  const handleClearHistory = useCallback(() => {
    setHistory((h) => ({ ...h, [activeType]: [] }));
    setLatest((l) => ({ ...l, [activeType]: null }));
  }, [activeType]);

  // The "insert" pathway per mode.
  const handleInsertSuggestion = useCallback((text: string) => {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (activeType === "continue" && onInsertAtCursor) {
      onInsertAtCursor(normalized);
    } else if (activeType === "rhyme" && onInsertAtCursor) {
      onInsertAtCursor(normalized);
    } else {
      onInsert?.(normalized);
    }
  }, [activeType, onInsert, onInsertAtCursor]);

  const insertLabel = activeType === "continue"
    ? (selectedText?.trim() ? "Replace selection" : "Insert at cursor")
    : activeType === "rhyme"
      ? "Insert at cursor"
      : "Append to poem";

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
      {!loading && !currentBatch && !error && (
        <div className="sh-empty-card" data-mode={activeType}>
          <p className="sh-empty-quote">{activeConfig.emptyQuote}</p>
          <p className="sh-empty-hint">{activeConfig.emptyHint}</p>
        </div>
      )}

      {/* Continue-mode anchor indicator */}
      {activeType === "continue" && continueAnchor && (
        <div className="sh-anchor">
          <span className="sh-anchor-icon" aria-hidden>↪</span>
          <span>Continuing {continueAnchor}</span>
        </div>
      )}

      {/* Quick-steer chips */}
      <div className="sh-steer" role="group" aria-label="Steer the suggestions">
        {STEER_CHIPS[activeType].map((chip) => {
          const isActive = currentSteer === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              className={`sh-steer-chip${isActive ? " is-active" : ""}`}
              onClick={() => handleToggleSteer(chip.id)}
              title={steerDescription(activeType, chip.id)}
              aria-pressed={isActive}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

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
          ) : currentBatch ? (
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
      {loading && !currentBatch && (
        <div className="sh-skeleton" aria-hidden>
          <div className="sh-skel-card" />
          <div className="sh-skel-card" />
          <div className="sh-skel-card" />
        </div>
      )}

      {currentBatch && (
        <BatchView
          batch={currentBatch}
          mode={activeType}
          isLatest
          insertLabel={insertLabel}
          onInsert={handleInsertSuggestion}
        />
      )}

      {/* Older batches in history */}
      {currentHistory.length > 0 && (
        <div className="sh-history">
          <div className="sh-history-header">
            <span className="sh-history-label">Previous</span>
            <button
              type="button"
              className="sh-history-clear"
              onClick={handleClearHistory}
              title="Clear this mode's history"
            >Clear</button>
          </div>
          {currentHistory.map((b, i) => (
            <BatchView
              key={b.generatedAt}
              batch={b}
              mode={activeType}
              isLatest={false}
              insertLabel={insertLabel}
              onInsert={handleInsertSuggestion}
              orderHint={i + 2}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── BatchView: renders one batch in mode-specific layout ───────── */

interface BatchViewProps {
  batch: Batch;
  mode: SuggestType;
  isLatest: boolean;
  insertLabel: string;
  onInsert: (text: string) => void;
  orderHint?: number;
}

function BatchView({ batch, mode, isLatest, insertLabel, onInsert, orderHint }: BatchViewProps) {
  const [collapsed, setCollapsed] = useState(!isLatest);
  const result = batch.result;

  const headerLabel = (() => {
    if (mode === "idea") return "Poem ideas";
    if (mode === "continue") return "Next lines";
    if (mode === "spark") return "Angles";
    return result.rhymes_with ? `Rhymes with "${result.rhymes_with}"` : "Rhymes";
  })();

  const totalCount = mode === "rhyme"
    ? (result.exact?.length ?? 0) + (result.near?.length ?? 0) + (result.slant?.length ?? 0) || result.suggestions.length
    : result.suggestions.length;

  return (
    <div className={`sh-batch${isLatest ? " is-latest" : " is-prev"}`} data-mode={mode}>
      <div className="sh-results-header">
        <div className="sh-results-header-left">
          {!isLatest && (
            <button
              type="button"
              className="sh-collapse-btn"
              onClick={() => setCollapsed((c) => !c)}
              aria-expanded={!collapsed}
              title={collapsed ? "Show" : "Hide"}
            >{collapsed ? "▸" : "▾"}</button>
          )}
          <span className="sh-results-label">
            {!isLatest && orderHint ? `Batch ${orderHint}: ` : ""}{headerLabel}
          </span>
          <span className="sh-results-count">{totalCount}</span>
        </div>
        {batch.steer && (
          <span className="sh-batch-meta" title={batch.steer}>steered</span>
        )}
      </div>

      {!collapsed && (
        <>
          {mode === "rhyme" ? (
            <RhymeView result={result} onInsert={onInsert} insertLabel={insertLabel} />
          ) : mode === "continue" ? (
            <ContinueView suggestions={result.suggestions} onInsert={onInsert} insertLabel={insertLabel} />
          ) : mode === "spark" ? (
            <SparkView suggestions={result.suggestions} />
          ) : (
            <IdeaView suggestions={result.suggestions} onInsert={onInsert} insertLabel={insertLabel} />
          )}
        </>
      )}
    </div>
  );
}

/* ── Per-mode views ─────────────────────────────────────────── */

function RhymeView({ result, onInsert, insertLabel }: { result: SuggestResult; onInsert: (s: string) => void; insertLabel: string }) {
  const groups: { label: string; words: string[] }[] = [];
  if (result.exact && result.exact.length > 0) groups.push({ label: "Exact", words: result.exact });
  if (result.near && result.near.length > 0) groups.push({ label: "Near", words: result.near });
  if (result.slant && result.slant.length > 0) groups.push({ label: "Slant", words: result.slant });
  // Fallback: ungrouped if the model didn't return groups.
  if (groups.length === 0 && result.suggestions.length > 0) {
    groups.push({ label: "Rhymes", words: result.suggestions });
  }

  return (
    <div className="sh-rhyme-groups">
      {groups.map((g) => (
        <div key={g.label} className="sh-rhyme-group">
          <div className="sh-rhyme-group-label">{g.label}</div>
          <div className="sh-rhyme-cloud">
            {g.words.map((w, i) => (
              <RhymeChip key={`${g.label}-${i}`} word={w} delayMs={i * 40} onInsert={onInsert} insertLabel={insertLabel} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RhymeChip({ word, delayMs, onInsert, insertLabel }: { word: string; delayMs: number; onInsert: (s: string) => void; insertLabel: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(word);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  }, [word]);
  return (
    <span className="sh-rhyme-chip" style={{ animationDelay: `${delayMs}ms` }}>
      <span className="sh-rhyme-chip-word" title={word}>{word}</span>
      <button
        type="button"
        className="sh-rhyme-chip-action"
        onClick={() => onInsert(word)}
        title={insertLabel}
        aria-label={insertLabel}
      >↓</button>
      <button
        type="button"
        className={`sh-rhyme-chip-action${copied ? " is-copied" : ""}`}
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy"}
        aria-label="Copy"
      >{copied ? "✓" : "⎘"}</button>
    </span>
  );
}

function ContinueView({ suggestions, onInsert, insertLabel }: { suggestions: string[]; onInsert: (s: string) => void; insertLabel: string }) {
  return (
    <div className="sh-continue-list">
      {suggestions.map((s, i) => (
        <ContinueCard key={i} text={s} index={i} onInsert={onInsert} insertLabel={insertLabel} />
      ))}
    </div>
  );
}

function ContinueCard({ text, index, onInsert, insertLabel }: { text: string; index: number; onInsert: (s: string) => void; insertLabel: string }) {
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);
  const lines = text.split("\n");

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [text]);

  const handleApply = useCallback(() => {
    onInsert(text);
    setApplied(true);
    setTimeout(() => setApplied(false), 1800);
  }, [onInsert, text]);

  return (
    <div className="sh-continue-card" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="sh-continue-body">
        {lines.map((ln, i) => (
          <div key={i} className="sh-continue-line">
            <span className="sh-continue-gutter" aria-hidden>·</span>
            <span className="sh-continue-text">{ln || " "}</span>
          </div>
        ))}
      </div>
      <div className="sh-continue-actions">
        <button
          type="button"
          className={`sh-icon-btn${copied ? " is-copied" : ""}`}
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy"}
          title={copied ? "Copied!" : "Copy"}
        >{copied ? "✓" : "⎘"}</button>
        <button
          type="button"
          className={`sh-apply-btn${applied ? " is-applied" : ""}`}
          onClick={handleApply}
          title={insertLabel}
        >{applied ? "✓ Done" : `↓ ${insertLabel}`}</button>
      </div>
    </div>
  );
}

function SparkView({ suggestions }: { suggestions: string[] }) {
  return (
    <div className="sh-spark-list">
      {suggestions.map((s, i) => (
        <SparkCard key={i} text={s} index={i} />
      ))}
    </div>
  );
}

function SparkCard({ text, index }: { text: string; index: number }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [text]);
  return (
    <div className="sh-spark-card" style={{ animationDelay: `${index * 80}ms` }}>
      <span className="sh-spark-bolt" aria-hidden>⚡</span>
      <p className="sh-spark-text">{text}</p>
      <button
        type="button"
        className={`sh-icon-btn sh-spark-copy${copied ? " is-copied" : ""}`}
        onClick={handleCopy}
        aria-label={copied ? "Copied" : "Copy"}
        title={copied ? "Copied!" : "Copy"}
      >{copied ? "✓" : "⎘"}</button>
    </div>
  );
}

function IdeaView({ suggestions, onInsert, insertLabel }: { suggestions: string[]; onInsert: (s: string) => void; insertLabel: string }) {
  return (
    <div className="sh-idea-list">
      {suggestions.map((s, i) => (
        <IdeaCard key={i} text={s} index={i} onInsert={onInsert} insertLabel={insertLabel} />
      ))}
    </div>
  );
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

function IdeaCard({ text, index, onInsert, insertLabel }: { text: string; index: number; onInsert: (s: string) => void; insertLabel: string }) {
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
    onInsert(text);
    setApplied(true);
    setTimeout(() => setApplied(false), 1800);
  }, [onInsert, text]);

  // Pull the first sentence (or first line) as a "title" if it's short.
  const firstBreak = text.search(/[.!?]\s|\n/);
  const head = firstBreak > 0 && firstBreak < 90 ? text.slice(0, firstBreak + 1) : "";
  const rest = head ? text.slice(head.length).trim() : text;

  const numeral = ROMAN[index] ?? String(index + 1);

  return (
    <div className="sh-idea-card" style={{ animationDelay: `${index * 70}ms` }}>
      <span className="sh-idea-numeral" aria-hidden>{numeral}</span>
      <div className="sh-idea-body">
        {head && <p className="sh-idea-head">{head}</p>}
        {rest && <p className="sh-idea-rest">{rest}</p>}
      </div>
      <div className="sh-idea-actions">
        <button
          type="button"
          className={`sh-icon-btn${copied ? " is-copied" : ""}`}
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy"}
          title={copied ? "Copied!" : "Copy"}
        >{copied ? "✓" : "⎘"}</button>
        <button
          type="button"
          className={`sh-apply-btn${applied ? " is-applied" : ""}`}
          onClick={handleApply}
          title={insertLabel}
        >{applied ? "✓ Done" : `↓ ${insertLabel}`}</button>
      </div>
    </div>
  );
}
