import { EditorView } from "@codemirror/view";
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

// Scrolls to the nearest match without moving the actual selection, so live
// typing doesn't trigger the editor's selection-based popovers.
function revealNearestMatch(view: EditorView, query: SearchQuery) {
  try {
    if (!query.valid) return;
    const from = view.state.selection.main.to;
    let cursor = query.getCursor(view.state.doc, from);
    let next = cursor.next();
    if (next.done) {
      cursor = query.getCursor(view.state.doc);
      next = cursor.next();
    }
    if (!next.done) {
      view.dispatch({ effects: EditorView.scrollIntoView(next.value.from, { y: "center" }) });
    }
  } catch {
    // ignore
  }
}

export function FindReplaceBar(props: FindReplaceBarProps) {
  const hint = useHoverHintBinder();
  const { editorView, open, mode, onClose } = props;
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [wrapMsg, setWrapMsg] = useState<"start" | "end" | null>(null);
  const wrapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const findRef = useRef<HTMLInputElement | null>(null);

  const query = useMemo(() => {
    return new SearchQuery({ search: find, replace });
  }, [find, replace]);

  useEffect(() => {
    if (!open) return;
    if (!editorView) return;
    editorView.dispatch({ effects: setSearchQuery.of(query) });
    if (find.trim()) {
      setMatchCount(countMatches(editorView, query));
      revealNearestMatch(editorView, query);
    } else {
      setMatchCount(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorView, open, query]);

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
    editorView.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "", replace: "" })) });
    setMatchCount(null);
    setWrapMsg(null);
  }, [editorView, open]);

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
            {...hint("Enter for next match, Shift+Enter for previous")}
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
    </div>
  );
}
