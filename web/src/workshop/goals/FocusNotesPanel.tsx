import type { FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createIdea,
  IDEA_TEXT_MAX,
  type IdeaEntry,
} from "./ideas-notebook-storage";
import { sortPinnedFirst, useIdeasNotebook } from "./useIdeasNotebook";

const COLLAPSED_PREVIEW_COUNT = 3;

/**
 * Side panel that appears in focus mode showing pinned + active ideas from the
 * goals notebook. Subtle/dimmed by default, fades with chrome on idle, and
 * expands into a small floating sheet for adding/toggling notes without
 * leaving focus mode.
 */
export function FocusNotesPanel() {
  const [ideas, persist] = useIdeasNotebook();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(
    () => sortPinnedFirst(ideas.filter((i) => !i.done)),
    [ideas],
  );

  const previewIdeas = useMemo(() => {
    if (active.length === 0) return [];
    const pinned = active.filter((i) => i.pinned);
    if (pinned.length >= COLLAPSED_PREVIEW_COUNT) {
      return pinned.slice(0, COLLAPSED_PREVIEW_COUNT);
    }
    return active.slice(0, COLLAPSED_PREVIEW_COUNT);
  }, [active]);

  const onToggleDone = useCallback(
    (id: string) => {
      persist(ideas.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
    },
    [ideas, persist],
  );

  const onTogglePin = useCallback(
    (id: string) => {
      persist(
        ideas.map((i) => (i.id === id ? { ...i, pinned: !i.pinned } : i)),
      );
    },
    [ideas, persist],
  );

  const onAdd = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = draft.trim();
      if (!text) return;
      persist([createIdea(text), ...ideas]);
      setDraft("");
    },
    [draft, ideas, persist],
  );

  const startEdit = useCallback((idea: IdeaEntry) => {
    setEditingId(idea.id);
    setEditingText(idea.text);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingText("");
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingId) return;
    const text = editingText.trim();
    if (!text) {
      persist(ideas.filter((i) => i.id !== editingId));
    } else {
      persist(
        ideas.map((i) => (i.id === editingId ? { ...i, text } : i)),
      );
    }
    setEditingId(null);
    setEditingText("");
  }, [editingId, editingText, ideas, persist]);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  // Close on outside click when expanded.
  useEffect(() => {
    if (!expanded) return;
    const onDocPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && panelRef.current && !panelRef.current.contains(t)) {
        setExpanded(false);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  const onEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  const pinnedCount = active.filter((i) => i.pinned).length;

  return (
    <div
      ref={panelRef}
      className={`focus-notes-panel${expanded ? " is-expanded" : ""}`}
      data-has-ideas={active.length > 0 ? "1" : "0"}
    >
      {!expanded ? (
        <button
          type="button"
          className="focus-notes-toggle"
          onClick={() => setExpanded(true)}
          aria-label={
            active.length === 0
              ? "Open notes"
              : `Open notes (${active.length} active${pinnedCount > 0 ? `, ${pinnedCount} pinned` : ""})`
          }
          title="Notes"
        >
          <span className="focus-notes-toggle-icon" aria-hidden="true">
            📝
          </span>
          {previewIdeas.length > 0 ? (
            <ul className="focus-notes-preview" aria-hidden="true">
              {previewIdeas.map((i) => (
                <li
                  key={i.id}
                  className={`focus-notes-preview-line${i.pinned ? " is-pinned" : ""}`}
                >
                  {i.pinned ? (
                    <span className="focus-notes-preview-pin" aria-hidden="true">
                      ◆
                    </span>
                  ) : null}
                  <span className="focus-notes-preview-text">{i.text}</span>
                </li>
              ))}
              {active.length > previewIdeas.length ? (
                <li className="focus-notes-preview-more">
                  +{active.length - previewIdeas.length} more
                </li>
              ) : null}
            </ul>
          ) : (
            <span className="focus-notes-toggle-empty">Notes</span>
          )}
        </button>
      ) : (
        <section
          className="focus-notes-sheet"
          role="dialog"
          aria-label="Notes"
        >
          <header className="focus-notes-sheet-header">
            <h4 className="focus-notes-sheet-title">
              <span aria-hidden="true">📝</span> Notes
            </h4>
            <button
              type="button"
              className="focus-notes-sheet-close"
              onClick={() => setExpanded(false)}
              aria-label="Close notes"
              title="Close"
            >
              ✕
            </button>
          </header>

          <form className="focus-notes-add" onSubmit={onAdd}>
            <input
              type="text"
              className="focus-notes-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="A line, a spark, a memory…"
              maxLength={IDEA_TEXT_MAX}
              aria-label="New idea"
            />
            <button
              type="submit"
              className="focus-notes-add-btn"
              disabled={!draft.trim()}
              aria-label="Add idea"
              title="Add"
            >
              +
            </button>
          </form>

          {active.length === 0 ? (
            <p className="focus-notes-empty">No notes yet. Jot one above.</p>
          ) : (
            <ul className="focus-notes-list">
              {active.map((idea) => (
                <li
                  key={idea.id}
                  className={`focus-notes-item${idea.pinned ? " is-pinned" : ""}`}
                >
                  <button
                    type="button"
                    className={`focus-notes-pin${idea.pinned ? " is-on" : ""}`}
                    onClick={() => onTogglePin(idea.id)}
                    aria-pressed={!!idea.pinned}
                    aria-label={idea.pinned ? "Unpin" : "Pin to top"}
                    title={idea.pinned ? "Unpin" : "Pin to top"}
                  >
                    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                      <path
                        d="M9.5 1.5l5 5-2 2-1.5-.5L8 11l-.5 3-1.5-1.5L3 9.5l-1.5-1.5L5 5l-.5-1.5 5-2z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  {editingId === idea.id ? (
                    <textarea
                      ref={editRef}
                      className="focus-notes-edit"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={onEditKeyDown}
                      maxLength={IDEA_TEXT_MAX}
                      rows={2}
                      aria-label="Edit idea"
                    />
                  ) : (
                    <button
                      type="button"
                      className="focus-notes-text"
                      onClick={() => startEdit(idea)}
                      title="Click to edit"
                    >
                      {idea.text}
                    </button>
                  )}
                  <button
                    type="button"
                    className="focus-notes-done"
                    onClick={() => onToggleDone(idea.id)}
                    aria-label="Mark done"
                    title="Mark done"
                  >
                    ✓
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
