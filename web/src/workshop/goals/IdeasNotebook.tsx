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
  const [hideDone, setHideDone] = useState(false);
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

  const visible = useMemo(
    () => (hideDone ? ideas.filter((i) => !i.done) : ideas),
    [ideas, hideDone],
  );

  const doneCount = useMemo(() => ideas.filter((i) => i.done).length, [ideas]);

  return (
    <section className="ideas-notebook" aria-labelledby="ideas-notebook-heading">
      <h4 className="tool-subheading" id="ideas-notebook-heading">
        Ideas notebook
      </h4>
      <p className="muted small ideas-notebook-hint">
        Jot poem ideas to come back to. Tick them off when written.
      </p>

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
          className="small-btn"
          disabled={!draft.trim()}
        >
          Add
        </button>
      </form>

      {ideas.length > 0 ? (
        <div className="ideas-notebook-toolbar">
          <label className="ideas-notebook-toolbar-toggle">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
            />
            Hide done
          </label>
          <span className="ideas-notebook-count muted small">
            {doneCount} / {ideas.length} done
          </span>
          {doneCount > 0 ? (
            <button
              type="button"
              className="linkish ideas-notebook-clear"
              onClick={onClearDone}
            >
              Clear done
            </button>
          ) : null}
        </div>
      ) : null}

      {ideas.length === 0 ? (
        <p className="muted small ideas-notebook-empty">No ideas yet.</p>
      ) : visible.length === 0 ? (
        <p className="muted small ideas-notebook-empty">
          All ideas done. Untick to show them.
        </p>
      ) : (
        <ul className="ideas-notebook-list">
          {visible.map((idea) => (
            <li
              key={idea.id}
              className={`ideas-notebook-item${idea.done ? " ideas-notebook-item--done" : ""}`}
            >
              <label className="ideas-notebook-check">
                <input
                  type="checkbox"
                  checked={idea.done}
                  onChange={() => onToggle(idea.id)}
                  aria-label={`Mark "${idea.text}" ${idea.done ? "not done" : "done"}`}
                />
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
              <button
                type="button"
                className="ideas-notebook-del"
                onClick={() => onDelete(idea.id)}
                aria-label={`Delete idea: ${idea.text}`}
                title="Delete"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
