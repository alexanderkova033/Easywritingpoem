import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import type { AnalysisIssue } from "@/workshop/analysis/ai-analyze";
import { countSyllablesInLine } from "@/workshop/analysis/syllables";
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
  ants: string[];
}

async function fetchLineSuggestions(
  title: string,
  lines: string[],
  targetLine: string,
  syllableTarget?: number,
  syllableTolerance?: number,
): Promise<string[]> {
  const res = await fetch("/api/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, lines, type: "line", targetLine, syllableTarget, syllableTolerance }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { suggestions?: string[] };
  return Array.isArray(data.suggestions) ? data.suggestions : [];
}

async function fetchDefinition(word: string, signal: AbortSignal): Promise<DefineResult> {
  const clean = word.replace(/[^a-zA-Z'-]/g, "").toLowerCase();
  const [dictRes, dmRes, dmAntRes] = await Promise.all([
    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean)}`, { signal }),
    fetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(clean)}&max=14`, { signal }),
    fetch(`https://api.datamuse.com/words?rel_ant=${encodeURIComponent(clean)}&max=8`, { signal }),
  ]);

  let pos = "";
  let defs: string[] = [];
  let syns: string[] = [];
  let ants: string[] = [];

  if (dictRes.ok) {
    const data = (await dictRes.json()) as Array<{ meanings?: Array<{ partOfSpeech: string; definitions: Array<{ definition: string }>; synonyms?: string[]; antonyms?: string[] }> }>;
    const meaning = data[0]?.meanings?.[0];
    if (meaning) {
      pos = meaning.partOfSpeech ?? "";
      defs = meaning.definitions.slice(0, 3).map((d) => d.definition);
      syns = meaning.synonyms?.slice(0, 8) ?? [];
      ants = meaning.antonyms?.slice(0, 4) ?? [];
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

  if (dmAntRes.ok) {
    const dmAntData = (await dmAntRes.json()) as Array<{ word?: string }>;
    const seenAnt = new Set(ants.map((a) => a.toLowerCase()));
    for (const row of dmAntData) {
      if (row.word && !seenAnt.has(row.word.toLowerCase()) && ants.length < 6) {
        ants.push(row.word);
        seenAnt.add(row.word.toLowerCase());
      }
    }
  }

  return { word: clean, pos, defs, syns, ants };
}

export interface SelectionSuggestPopoverProps {
  anchorRect: DOMRect;
  selectedText: string;
  poemTitle: string;
  poemLines: string[];
  wordLookupEnabled?: boolean;
  /** AI analysis issues currently visible — used to surface AI feedback when the selection matches a flagged word. */
  aiIssues?: AnalysisIssue[];
  /** Apply a full-line rewrite (used when the user accepts an issue's suggested rewrite from the popover). */
  onApplyLine?: (lineStart: number, lineEnd: number, text: string) => void;
  onApply: (text: string) => void;
  onClose: () => void;
}

export function SelectionSuggestPopover({
  anchorRect,
  selectedText,
  poemTitle,
  poemLines,
  wordLookupEnabled = true,
  aiIssues,
  onApplyLine,
  onApply,
  onClose,
}: SelectionSuggestPopoverProps) {
  const isSingleWord = !selectedText.trim().includes(" ") && selectedText.trim().length >= 1;
  const trimmedText = selectedText.trim();

  // Match selection against any issue's problem_words to surface AI feedback.
  const matchedIssue = useMemo<AnalysisIssue | null>(() => {
    if (!aiIssues || aiIssues.length === 0 || !isSingleWord) return null;
    const needle = trimmedText.toLowerCase().replace(/[^a-z'-]/g, "");
    if (!needle) return null;
    for (const iss of aiIssues) {
      if (!iss.problem_words || iss.problem_words.length === 0) continue;
      if (iss.problem_words.some((w) => w.toLowerCase().replace(/[^a-z'-]/g, "") === needle)) {
        return iss;
      }
    }
    return null;
  }, [aiIssues, isSingleWord, trimmedText]);

  const [mode, setMode] = useState<"menu" | "rewrite" | "define">("menu");
  const [rewritePhase, setRewritePhase] = useState<"idle" | "loading" | "results" | "error">("idle");
  const [definePhase, setDefinePhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [definition, setDefinition] = useState<DefineResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Syllable count of selection — prefill so the user has a sensible default,
  // but do NOT auto-fire the request (they may want to nudge the target).
  const detectedSyllables = useMemo(() => {
    if (!trimmedText) return 0;
    try { return countSyllablesInLine(trimmedText) ?? 0; } catch { return 0; }
  }, [trimmedText]);

  const [syllableInput, setSyllableInput] = useState(() => detectedSyllables > 0 ? String(detectedSyllables) : "");
  const [syllableTolerance, setSyllableTolerance] = useState(0); // ±N around target

  const adjustSyllables = (delta: number) => {
    const cur = parseInt(syllableInput.trim(), 10);
    const base = Number.isFinite(cur) ? cur : detectedSyllables;
    const next = Math.max(1, Math.min(30, base + delta));
    setSyllableInput(String(next));
  };
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
        Number.isFinite(sylTarget) && sylTarget! > 0 && syllableTolerance > 0 ? syllableTolerance : undefined,
      );
      setSuggestions(results.map((t) => ({ text: t, copied: false })));
      setRewritePhase("results");
    } catch (err) {
      setErrorMsg((err as Error).message);
      setRewritePhase("error");
    }
  }, [poemTitle, poemLines, trimmedText, syllableInput, syllableTolerance]);

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

      {/* AI issue feedback — appears when the selected word was flagged in analysis. */}
      {matchedIssue && mode === "menu" && (
        <div className={`ssp-issue ssp-issue-sev-${matchedIssue.severity ?? "low"}`}>
          <div className="ssp-issue-head">
            <span className="ssp-issue-mark" aria-hidden>!</span>
            <span className="ssp-issue-title">
              AI flagged this · Line {matchedIssue.line_start === matchedIssue.line_end
                ? matchedIssue.line_start
                : `${matchedIssue.line_start}–${matchedIssue.line_end}`}
            </span>
          </div>
          {matchedIssue.headline && (
            <div className="ssp-issue-headline">{matchedIssue.headline}</div>
          )}
          {matchedIssue.rationale && (
            <p className="ssp-issue-rationale">{matchedIssue.rationale}</p>
          )}
          {matchedIssue.rewrite && onApplyLine && (
            <button
              type="button"
              className="ssp-issue-apply"
              onClick={() => {
                onApplyLine(matchedIssue.line_start, matchedIssue.line_end, matchedIssue.rewrite!);
                onClose();
              }}
              title="Apply the AI's suggested rewrite for this whole line"
            >
              ✦ Apply suggested rewrite
            </button>
          )}
        </div>
      )}

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
            {matchedIssue ? "Try a different word" : "AI rewrite suggestions"}
          </button>
        </div>
      )}

      {/* ── Rewrite mode ── */}
      {mode === "rewrite" && (
        <>
          <div className="ssp-syllable-row">
            <div className="ssp-syllable-control">
              <span className="ssp-syllable-label-text">Target syllables</span>
              <div className="ssp-syllable-stepper">
                <button type="button" className="ssp-syllable-step" aria-label="Decrease"
                  onClick={() => adjustSyllables(-1)}>−</button>
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
                <button type="button" className="ssp-syllable-step" aria-label="Increase"
                  onClick={() => adjustSyllables(1)}>+</button>
              </div>
            </div>

            <div className="ssp-tolerance-row">
              <span className="ssp-tolerance-label">Range</span>
              <div className="ssp-tolerance-chips" role="group" aria-label="Syllable tolerance">
                {([0, 1, 2] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`ssp-tolerance-chip${syllableTolerance === t ? " is-active" : ""}`}
                    onClick={() => setSyllableTolerance(t)}
                  >
                    {t === 0 ? "Exact" : `±${t}`}
                  </button>
                ))}
              </div>
            </div>

            {detectedSyllables > 0 && (
              <span className="ssp-syllable-hint">
                Selection has {detectedSyllables} syllables. Adjust then generate.
              </span>
            )}
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
              {definition.ants.length > 0 && (
                <div className="ssp-define-syns ssp-define-ants">
                  <span className="ssp-define-syns-label">Antonyms</span>
                  <div className="ssp-define-chips">
                    {definition.ants.map((a) => (
                      <button
                        key={a}
                        type="button"
                        className="ssp-syn-chip ssp-ant-chip"
                        title={`Replace with "${a}"`}
                        onClick={() => { onApply(a); onClose(); }}
                      >
                        {a}
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
