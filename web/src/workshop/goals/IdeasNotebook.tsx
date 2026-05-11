import type { FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createIdea,
  IDEA_TEXT_MAX,
  loadIdeas,
  saveIdeas,
  type IdeaEntry,
} from "./ideas-notebook-storage";

export function IdeasNotebook() {
  const [ideas, setIdeas] = useState<IdeaEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [doneOpen, setDoneOpen] = useState(false);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setIdeas(loadIdeas());
  }, []);

  const persist = useCallback((next: IdeaEntry[]) => {
    setIdeas(next);
    saveIdeas(next);
  }, []);

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

  const onToggle = useCallback(
    (id: string) => {
      persist(ideas.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
    },
    [ideas, persist],
  );

  const onDelete = useCallback(
    (id: string) => {
      persist(ideas.filter((i) => i.id !== id));
    },
    [ideas, persist],
  );

  const onClearDone = useCallback(() => {
    persist(ideas.filter((i) => !i.done));
  }, [ideas, persist]);

  const move = useCallback(
    (id: string, dir: -1 | 1) => {
      const idx = ideas.findIndex((i) => i.id === id);
      if (idx < 0) return;
      const target = idx + dir;
      if (target < 0 || target >= ideas.length) return;
      if (ideas[idx].done !== ideas[target].done) return;
      const next = ideas.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      persist(next);
    },
    [ideas, persist],
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
      persist(ideas.map((i) => (i.id === editingId ? { ...i, text } : i)));
    }
    setEditingId(null);
    setEditingText("");
  }, [editingId, editingText, ideas, persist]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const onEditKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  const active = useMemo(() => ideas.filter((i) => !i.done), [ideas]);
  const done = useMemo(() => ideas.filter((i) => i.done), [ideas]);
  const progress =
    ideas.length === 0 ? 0 : Math.round((done.length / ideas.length) * 100);

  const renderItem = (idea: IdeaEntry, group: IdeaEntry[], index: number) => {
    const isFirst = index === 0;
    const isLast = index === group.length - 1;
    return (
      <li
        key={idea.id}
        className={`ideas-notebook-item${idea.done ? " ideas-notebook-item--done" : ""}`}
      >
        <label className="ideas-notebook-check">
          <input
            type="checkbox"
            className="ideas-notebook-check-input"
            checked={idea.done}
            onChange={() => onToggle(idea.id)}
            aria-label={`Mark "${idea.text}" ${idea.done ? "not done" : "done"}`}
          />
          <span className="ideas-notebook-check-box" aria-hidden="true">
            <svg
              viewBox="0 0 16 16"
              className="ideas-notebook-check-icon"
              focusable="false"
            >
              <path
                d="M3.5 8.4 6.6 11.5 12.5 5.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </label>

        {editingId === idea.id ? (
          <input
            ref={editInputRef}
            type="text"
            className="ideas-notebook-input ideas-notebook-edit"
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={onEditKeyDown}
            maxLength={IDEA_TEXT_MAX}
            aria-label="Edit idea"
          />
        ) : (
          <button
            type="button"
            className="ideas-notebook-text"
            onClick={() => startEdit(idea)}
            title="Click to edit"
          >
            {idea.text}
          </button>
        )}

        <div className="ideas-notebook-actions">
          <button
            type="button"
            className="ideas-notebook-move"
            onClick={() => move(idea.id, -1)}
            disabled={isFirst}
            aria-label="Move up"
            title="Move up"
          >
            <svg viewBox="0 0 12 12" focusable="false" aria-hidden="true">
              <path
                d="M2.5 7.5 6 4l3.5 3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="ideas-notebook-move"
            onClick={() => move(idea.id, 1)}
            disabled={isLast}
            aria-label="Move down"
            title="Move down"
          >
            <svg viewBox="0 0 12 12" focusable="false" aria-hidden="true">
              <path
                d="M2.5 4.5 6 8l3.5-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="ideas-notebook-del"
            onClick={() => onDelete(idea.id)}
            aria-label={`Delete idea: ${idea.text}`}
            title="Delete"
          >
            <svg viewBox="0 0 12 12" focusable="false" aria-hidden="true">
              <path
                d="M3 3l6 6M9 3l-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </li>
    );
  };

  return (
    <section className="ideas-notebook" aria-labelledby="ideas-notebook-heading">
      <header className="ideas-notebook-header">
        <h4 className="tool-subheading" id="ideas-notebook-heading">
          Ideas notebook
        </h4>
        {ideas.length > 0 ? (
          <span
            className="ideas-notebook-badge"
            aria-label={`${done.length} of ${ideas.length} done`}
          >
            {done.length}/{ideas.length}
          </span>
        ) : null}
      </header>
      <p className="muted small ideas-notebook-hint">
        Jot poem ideas to come back to. Tick them off when written.
      </p>

      {ideas.length > 0 ? (
        <div
          className="ideas-notebook-progress"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Ideas completion"
        >
          <div
            className="ideas-notebook-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}

      <form className="ideas-notebook-add" onSubmit={onAdd}>
        <input
          type="text"
          className="ideas-notebook-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="A new idea…"
          maxLength={IDEA_TEXT_MAX}
          aria-label="New idea"
        />
        <button
          type="submit"
          className="ideas-notebook-add-btn"
          disabled={!draft.trim()}
          aria-label="Add idea"
        >
          <svg viewBox="0 0 12 12" focusable="false" aria-hidden="true">
            <path
              d="M6 2v8M2 6h8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <span>Add</span>
        </button>
      </form>

      {ideas.length === 0 ? (
        <div className="ideas-notebook-empty">
          <div className="ideas-notebook-empty-icon" aria-hidden="true">
            ✎
          </div>
          <p className="muted small">No ideas yet. Add one above.</p>
        </div>
      ) : (
        <>
          {active.length > 0 ? (
            <ul className="ideas-notebook-list">
              {active.map((idea, i) => renderItem(idea, active, i))}
            </ul>
          ) : (
            <p className="muted small ideas-notebook-all-done">
              ✓ All ideas ticked off
            </p>
          )}

          {done.length > 0 ? (
            <div
              className={`ideas-notebook-done-section${doneOpen ? " ideas-notebook-done-section--open" : ""}`}
            >
              <div className="ideas-notebook-done-header">
                <button
                  type="button"
                  className="ideas-notebook-done-toggle"
                  onClick={() => setDoneOpen((s) => !s)}
                  aria-expanded={doneOpen}
                  aria-controls="ideas-notebook-done-list"
                >
                  <span
                    className={`ideas-notebook-caret${doneOpen ? " ideas-notebook-caret--open" : ""}`}
                    aria-hidden="true"
                  >
                    ▸
                  </span>
                  Done ({done.length})
                </button>
                <button
                  type="button"
                  className="ideas-notebook-clear"
                  onClick={onClearDone}
                  title="Remove all done ideas"
                >
                  Clear
                </button>
              </div>
              {doneOpen ? (
                <ul
                  className="ideas-notebook-list ideas-notebook-list--done"
                  id="ideas-notebook-done-list"
                >
                  {done.map((idea, i) => renderItem(idea, done, i))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
