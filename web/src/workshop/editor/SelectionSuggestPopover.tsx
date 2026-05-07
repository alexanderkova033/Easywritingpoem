import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./SelectionSuggestPopover.css";

interface Suggestion {
  text: string;
  copied: boolean;
}

interface DefineResult {
  word: string;
  pos: string;
  defs: string[];
  syns: string[];
}

async function fetchLineSuggestions(
  title: string,
  lines: string[],
  targetLine: string,
  syllableTarget?: number,
): Promise<string[]> {
  const res = await fetch("/api/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, lines, type: "line", targetLine, syllableTarget }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { suggestions?: string[] };
  return Array.isArray(data.suggestions) ? data.suggestions : [];
}

async function fetchDefinition(word: string, signal: AbortSignal): Promise<DefineResult> {
  const clean = word.replace(/[^a-zA-Z'-]/g, "").toLowerCase();
  const [dictRes, dmRes] = await Promise.all([
    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean)}`, { signal }),
    fetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(clean)}&max=14`, { signal }),
  ]);

  let pos = "";
  let defs: string[] = [];
  let syns: string[] = [];

  if (dictRes.ok) {
    const data = (await dictRes.json()) as Array<{ meanings?: Array<{ partOfSpeech: string; definitions: Array<{ definition: string }>; synonyms?: string[] }> }>;
    const meaning = data[0]?.meanings?.[0];
    if (meaning) {
      pos = meaning.partOfSpeech ?? "";
      defs = meaning.definitions.slice(0, 3).map((d) => d.definition);
      syns = meaning.synonyms?.slice(0, 8) ?? [];
    }
  }

  if (dmRes.ok) {
    const dmData = (await dmRes.json()) as Array<{ word?: string }>;
    const seen = new Set(syns.map((s) => s.toLowerCase()));
    for (const row of dmData) {
      if (row.word && !seen.has(row.word.toLowerCase()) && syns.length < 15) {
        syns.push(row.word);
        seen.add(row.word.toLowerCase());
      }
    }
  }

  return { word: clean, pos, defs, syns };
}

export interface SelectionSuggestPopoverProps {
  anchorRect: DOMRect;
  selectedText: string;
  poemTitle: string;
  poemLines: string[];
  wordLookupEnabled?: boolean;
  onApply: (text: string) => void;
  onClose: () => void;
}

export function SelectionSuggestPopover({
  anchorRect,
  selectedText,
  poemTitle,
  poemLines,
  wordLookupEnabled = true,
  onApply,
  onClose,
}: SelectionSuggestPopoverProps) {
  const isSingleWord = !selectedText.trim().includes(" ") && selectedText.trim().length >= 1;
  const trimmedText = selectedText.trim();

  const [mode, setMode] = useState<"menu" | "rewrite" | "define">("menu");
  const [rewritePhase, setRewritePhase] = useState<"idle" | "loading" | "results" | "error">("idle");
  const [definePhase, setDefinePhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [definition, setDefinition] = useState<DefineResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [syllableInput, setSyllableInput] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const defineAbortRef = useRef<AbortController | null>(null);
  const readyToCloseRef = useRef(false);

  const handleRewrite = useCallback(async () => {
    setRewritePhase("loading");
    const sylTarget = syllableInput.trim() ? parseInt(syllableInput.trim(), 10) : undefined;
    try {
      const results = await fetchLineSuggestions(
        poemTitle,
        poemLines,
        trimmedText,
        Number.isFinite(sylTarget) && sylTarget! > 0 ? sylTarget : undefined,
      );
      setSuggestions(results.map((t) => ({ text: t, copied: false })));
      setRewritePhase("results");
    } catch (err) {
      setErrorMsg((err as Error).message);
      setRewritePhase("error");
    }
  }, [poemTitle, poemLines, trimmedText, syllableInput]);

  const handleDefine = useCallback(async () => {
    setDefinePhase("loading");
    defineAbortRef.current?.abort();
    const ctrl = new AbortController();
    defineAbortRef.current = ctrl;
    try {
      const result = await fetchDefinition(trimmedText, ctrl.signal);
      setDefinition(result);
      setDefinePhase("done");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setDefinePhase("error");
    }
  }, [trimmedText]);

  useEffect(() => () => { defineAbortRef.current?.abort(); }, []);

  // Guard: don't close on the mousedown/pointerup that triggered opening
  useEffect(() => {
    const timer = setTimeout(() => { readyToCloseRef.current = true; }, 250);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!readyToCloseRef.current) return;
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleCopy = useCallback(async (text: string, idx: number) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setSuggestions((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, copied: true } : s)),
    );
    setTimeout(
      () => setSuggestions((prev) =>
        prev.map((s, i) => (i === idx ? { ...s, copied: false } : s)),
      ),
      1500,
    );
  }, []);

  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.max(8, anchorRect.top - 8),
    left: Math.min(
      window.innerWidth - 300,
      Math.max(8, anchorRect.left + anchorRect.width / 2 - 150),
    ),
    transform: "translateY(-100%)",
  };

  return createPortal(
    <div className="ssp-wrap" style={style} ref={popoverRef} role="dialog" aria-label="Word actions">
      <div className="ssp-header">
        <span className="ssp-title">
          {mode === "define" ? "Define" : mode === "rewrite" ? "✦ Rewrite" : "✦ Selection"}
        </span>
        <div className="ssp-header-actions">
          {mode !== "menu" && (
            <button type="button" className="ssp-back" onClick={() => { setMode("menu"); setRewritePhase("idle"); setDefinePhase("idle"); }} aria-label="Back">←</button>
          )}
          <button type="button" className="ssp-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      <div className="ssp-source">
        <span className="ssp-source-label">Selected:</span>
        <span className="ssp-source-text">{trimmedText.slice(0, 60)}{trimmedText.length > 60 ? "…" : ""}</span>
      </div>

      {/* ── Menu mode ── */}
      {mode === "menu" && (
        <div className="ssp-menu">
          {wordLookupEnabled && isSingleWord && (
            <button
              type="button"
              className="ssp-menu-btn"
              onClick={() => { setMode("define"); void handleDefine(); }}
            >
              <span className="ssp-menu-icon" aria-hidden>📖</span>
              Define &amp; synonyms
            </button>
          )}
          <button
            type="button"
            className="ssp-menu-btn ssp-menu-btn-primary"
            onClick={() => setMode("rewrite")}
          >
            <span className="ssp-menu-icon" aria-hidden>✦</span>
            AI rewrite suggestions
          </button>
        </div>
      )}

      {/* ── Rewrite mode ── */}
      {mode === "rewrite" && (
        <>
          <div className="ssp-syllable-row">
            <label className="ssp-syllable-label">
              Target syllables
              <input
                type="number"
                className="ssp-syllable-input"
                min={1}
                max={30}
                placeholder="any"
                value={syllableInput}
                onChange={(e) => setSyllableInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleRewrite(); }}
              />
            </label>
            <span className="ssp-syllable-hint">Leave blank to match naturally</span>
          </div>

          {rewritePhase === "idle" && (
            <div className="ssp-idle">
              <button type="button" className="ssp-generate-btn" onClick={() => void handleRewrite()}>
                ✦ Get rewrite suggestions
              </button>
            </div>
          )}

          {rewritePhase === "loading" && (
            <div className="ssp-loading">
              <span className="ssp-dot" /><span className="ssp-dot" /><span className="ssp-dot" />
              <span className="ssp-loading-label">Generating…</span>
            </div>
          )}

          {rewritePhase === "error" && (
            <div className="ssp-error-wrap">
              <p className="ssp-error">{errorMsg}</p>
              <button type="button" className="ssp-retry-btn" onClick={() => void handleRewrite()}>Retry</button>
            </div>
          )}

          {rewritePhase === "results" && (
            <>
              <ul className="ssp-list">
                {suggestions.map((s, i) => (
                  <li key={i} className="ssp-item">
                    <span className="ssp-text">{s.text}</span>
                    <div className="ssp-actions">
                      <button
                        type="button"
                        className={`ssp-btn${s.copied ? " is-copied" : ""}`}
                        title="Copy"
                        onClick={() => void handleCopy(s.text, i)}
                      >
                        {s.copied ? "✓" : "⎘"}
                      </button>
                      <button
                        type="button"
                        className="ssp-btn ssp-apply"
                        title="Replace selection"
                        onClick={() => { onApply(s.text); onClose(); }}
                      >
                        Apply
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <button type="button" className="ssp-retry-btn" onClick={() => void handleRewrite()}>↺ Again</button>
            </>
          )}
        </>
      )}

      {/* ── Define mode ── */}
      {mode === "define" && (
        <div className="ssp-define">
          {definePhase === "loading" && (
            <div className="ssp-loading">
              <span className="ssp-dot" /><span className="ssp-dot" /><span className="ssp-dot" />
              <span className="ssp-loading-label">Looking up…</span>
            </div>
          )}

          {definePhase === "error" && (
            <p className="ssp-error">Could not fetch definition — check your connection.</p>
          )}

          {definePhase === "done" && definition && (
            <>
              {definition.pos && <span className="ssp-define-pos">{definition.pos}</span>}
              {definition.defs.length > 0 ? (
                <ol className="ssp-define-defs">
                  {definition.defs.map((d, i) => <li key={i}>{d}</li>)}
                </ol>
              ) : (
                <p className="ssp-define-none">No dictionary entry found.</p>
              )}
              {definition.syns.length > 0 && (
                <div className="ssp-define-syns">
                  <span className="ssp-define-syns-label">Synonyms &amp; similar</span>
                  <div className="ssp-define-chips">
                    {definition.syns.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="ssp-syn-chip"
                        title={`Replace with "${s}"`}
                        onClick={() => { onApply(s); onClose(); }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
