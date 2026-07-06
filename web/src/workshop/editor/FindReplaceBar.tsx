import type { EditorView } from "@codemirror/view";
import {
  SearchQuery,
  findNext,
  findPrevious,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from "@codemirror/search";
import { useEffect, useMemo, useRef, useState } from "react";
import { useHoverHintBinder } from "@/workshop/hints/HoverHintsContext";

export interface FindReplaceBarProps {
  editorView: EditorView | null;
  open: boolean;
  mode: "find" | "replace";
  onClose: () => void;
}

function countMatches(view: EditorView, query: SearchQuery): number {
  try {
    if (!query.valid) return 0;
    const cursor = query.getCursor(view.state.doc);
    let n = 0;
    while (!cursor.next().done) n++;
    return n;
  } catch {
    return 0;
  }
}

export function FindReplaceBar(props: FindReplaceBarProps) {
  const hint = useHoverHintBinder();
  const { editorView, open, mode, onClose } = props;
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [wrapMsg, setWrapMsg] = useState<"start" | "end" | null>(null);
  const wrapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const findRef = useRef<HTMLInputElement | null>(null);

  const query = useMemo(() => {
    return new SearchQuery({
      search: find,
      replace,
      caseSensitive,
      wholeWord,
      regexp,
    });
  }, [caseSensitive, find, regexp, replace, wholeWord]);

  useEffect(() => {
    if (!open) return;
    if (!editorView) return;
    editorView.dispatch({ effects: setSearchQuery.of(query) });
    if (find.trim()) {
      setMatchCount(countMatches(editorView, query));
    } else {
      setMatchCount(null);
    }
  }, [editorView, open, query, find]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      findRef.current?.focus();
      findRef.current?.select();
    });
  }, [open]);

  const showWrap = (dir: "start" | "end") => {
    setWrapMsg(dir);
    if (wrapTimerRef.current) clearTimeout(wrapTimerRef.current);
    wrapTimerRef.current = setTimeout(() => setWrapMsg(null), 1400);
  };

  const handleFindNext = () => {
    if (!editorView || !find.trim()) return;
    const before = editorView.state.selection.main.from;
    findNext(editorView);
    const after = editorView.state.selection.main.from;
    // Wrapped forward if new position is before old position
    if (after < before) showWrap("start");
  };

  const handleFindPrev = () => {
    if (!editorView || !find.trim()) return;
    const before = editorView.state.selection.main.from;
    findPrevious(editorView);
    const after = editorView.state.selection.main.from;
    // Wrapped backward if new position is after old position
    if (after > before) showWrap("end");
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Enter") {
        if (!editorView || !find.trim()) return;
        e.preventDefault();
        if (e.shiftKey) {
          handleFindPrev();
        } else {
          handleFindNext();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorView, find, onClose, open]);

  useEffect(() => {
    if (open) return;
    if (!editorView) return;
    editorView.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: "",
          replace: "",
          caseSensitive,
          wholeWord,
          regexp,
        }),
      ),
    });
    setMatchCount(null);
    setWrapMsg(null);
  }, [caseSensitive, editorView, open, regexp, wholeWord]);

  useEffect(() => {
    return () => {
      if (wrapTimerRef.current) clearTimeout(wrapTimerRef.current);
    };
  }, []);

  if (!open) return null;

  return (
    <div className="findbar" role="group" aria-label="Find and replace">
      <div className="findbar-row">
        <label className="findbar-field">
          Find
          <input
            ref={findRef}
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Text…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {mode === "replace" ? (
          <label className="findbar-field">
            Replace
            <input
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="Replacement…"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        ) : null}
        <div className="findbar-actions">
          <button
            type="button"
            className="small-btn"
            onClick={handleFindPrev}
            disabled={!editorView || !find.trim()}
            {...hint("Previous match (Shift+Enter)")}
          >
            Prev
          </button>
          <button
            type="button"
            className="small-btn small-btn-primary"
            onClick={handleFindNext}
            disabled={!editorView || !find.trim()}
            {...hint("Next match (Enter)")}
          >
            Next
          </button>
          {mode === "replace" ? (
            <>
              <button
                type="button"
                className="small-btn"
                onClick={() => editorView && replaceNext(editorView)}
                disabled={!editorView || !find.trim()}
                {...hint("Replace current match and move to the next")}
              >
                Replace
              </button>
              <button
                type="button"
                className="small-btn"
                onClick={() => editorView && replaceAll(editorView)}
                disabled={!editorView || !find.trim()}
                {...hint("Replace all matches in the poem")}
              >
                All
              </button>
            </>
          ) : null}
          <button type="button" className="small-btn" onClick={onClose}>
            Close
          </button>
        </div>
        {matchCount !== null ? (
          <span className="findbar-count" role="status" aria-live="polite">
            {matchCount === 0 ? "No matches" : `${matchCount} match${matchCount !== 1 ? "es" : ""}`}
          </span>
        ) : null}
        {wrapMsg ? (
          <span className="findbar-wrap-msg" role="status" aria-live="polite">
            {wrapMsg === "start" ? "↩ Wrapped to top" : "↩ Wrapped to bottom"}
          </span>
        ) : null}
      </div>
      <div className="findbar-row findbar-toggles" aria-label="Find options">
        <label className="findbar-toggle">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          Case
        </label>
        <label className="findbar-toggle">
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(e) => setWholeWord(e.target.checked)}
          />
          Word
        </label>
        <label className="findbar-toggle">
          <input
            type="checkbox"
            checked={regexp}
            onChange={(e) => setRegexp(e.target.checked)}
          />
          Regex
        </label>
      </div>
    </div>
  );
}
