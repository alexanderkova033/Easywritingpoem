import type { DragEvent, FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createIdea,
  IDEA_MOOD_OPTIONS,
  IDEA_TEXT_MAX,
  loadIdeas,
  saveIdeas,
  type IdeaEntry,
  type IdeaMood,
} from "./ideas-notebook-storage";

const NEXT_MOOD: Record<IdeaMood, IdeaMood> = {
  neutral: "warm",
  warm: "cool",
  cool: "tender",
  tender: "dark",
  dark: "neutral",
};

function nextMood(current: IdeaMood | undefined): IdeaMood {
  if (!current) return "warm";
  return NEXT_MOOD[current];
}

function moodLabel(mood: IdeaMood | undefined): string {
  const found = IDEA_MOOD_OPTIONS.find((o) => o.mood === (mood ?? "neutral"));
  return found?.label ?? "Neutral";
}

export function IdeasNotebook() {
  const [ideas, setIdeas] = useState<IdeaEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [draftMood, setDraftMood] = useState<IdeaMood>("neutral");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [doneOpen, setDoneOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);

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
      const mood = draftMood === "neutral" ? undefined : draftMood;
      persist([createIdea(text, mood), ...ideas]);
      setDraft("");
      setDraftMood("neutral");
    },
    [draft, draftMood, ideas, persist],
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

  const onCycleMood = useCallback(
    (id: string) => {
      persist(
        ideas.map((i) =>
          i.id === id ? { ...i, mood: nextMood(i.mood) } : i,
        ),
      );
    },
    [ideas, persist],
  );

  const reorder = useCallback(
    (sourceId: string, targetId: string) => {
      if (sourceId === targetId) return;
      const src = ideas.find((i) => i.id === sourceId);
      const tgt = ideas.find((i) => i.id === targetId);
      if (!src || !tgt) return;
      // Only allow reorder within same done bucket.
      if (src.done !== tgt.done) return;
      const sIdx = ideas.indexOf(src);
      const tIdx = ideas.indexOf(tgt);
      const next = ideas.slice();
      next.splice(sIdx, 1);
      const insertAt = next.indexOf(tgt);
      next.splice(insertAt, 0, src);
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

  const onEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  const active = useMemo(() => ideas.filter((i) => !i.done), [ideas]);
  const done = useMemo(() => ideas.filter((i) => i.done), [ideas]);

  const onDragStart = (id: string) => (e: DragEvent<HTMLLIElement>) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const onDragOver = (id: string) => (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverId !== id) setDragOverId(id);
  };
  const onDrop = (id: string) => (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    const src = dragId ?? e.dataTransfer.getData("text/plain");
    if (src) reorder(src, id);
    setDragId(null);
    setDragOverId(null);
  };
  const onDragEnd = () => {
    setDragId(null);
    setDragOverId(null);
  };

  const renderItem = (idea: IdeaEntry) => {
    const moodKey = idea.mood ?? "neutral";
    const isDragging = dragId === idea.id;
    const isDragOver = dragOverId === idea.id && dragId && dragId !== idea.id;
    return (
      <li
        key={idea.id}
        className={`ideas-card ideas-card--${moodKey}${idea.done ? " ideas-card--done" : ""}${isDragging ? " ideas-card--dragging" : ""}${isDragOver ? " ideas-card--drop-target" : ""}`}
        draggable={!editingId || editingId !== idea.id}
        onDragStart={onDragStart(idea.id)}
        onDragOver={onDragOver(idea.id)}
        onDrop={onDrop(idea.id)}
        onDragEnd={onDragEnd}
      >
        <span className="ideas-card-tape" aria-hidden="true" />

        <div className="ideas-card-top">
          <span
            className="ideas-card-grip"
            aria-hidden="true"
            title="Drag to reorder"
          >
            <svg viewBox="0 0 10 16" focusable="false">
              <circle cx="2.5" cy="3" r="1.2" fill="currentColor" />
              <circle cx="7.5" cy="3" r="1.2" fill="currentColor" />
              <circle cx="2.5" cy="8" r="1.2" fill="currentColor" />
              <circle cx="7.5" cy="8" r="1.2" fill="currentColor" />
              <circle cx="2.5" cy="13" r="1.2" fill="currentColor" />
              <circle cx="7.5" cy="13" r="1.2" fill="currentColor" />
            </svg>
          </span>

          <label className="ideas-card-check">
            <input
              type="checkbox"
              className="ideas-card-check-input"
              checked={idea.done}
              onChange={() => onToggle(idea.id)}
              aria-label={`Mark "${idea.text}" ${idea.done ? "not done" : "done"}`}
            />
            <span className="ideas-card-check-box" aria-hidden="true">
              <svg viewBox="0 0 16 16" focusable="false">
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

          <button
            type="button"
            className={`ideas-card-mood ideas-card-mood--${moodKey}`}
            onClick={() => onCycleMood(idea.id)}
            aria-label={`Mood: ${moodLabel(idea.mood)} — click to change`}
            title={`${moodLabel(idea.mood)} — click to cycle`}
          />

          <button
            type="button"
            className="ideas-card-del"
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

        {editingId === idea.id ? (
          <textarea
            ref={editInputRef}
            className="ideas-card-edit"
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={onEditKeyDown}
            maxLength={IDEA_TEXT_MAX}
            rows={3}
            aria-label="Edit idea"
          />
        ) : (
          <button
            type="button"
            className="ideas-card-text"
            onClick={() => startEdit(idea)}
            title="Click to edit"
          >
            {idea.text}
          </button>
        )}
      </li>
    );
  };

  return (
    <section className="ideas-notebook" aria-labelledby="ideas-notebook-heading">
      <header className="ideas-notebook-header">
        <h4 className="tool-subheading" id="ideas-notebook-heading">
          <span className="ideas-notebook-icon" aria-hidden="true">📝</span>
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

      {ideas.length > 0 ? (
        <div
          className="ideas-notebook-dots"
          role="progressbar"
          aria-valuenow={done.length}
          aria-valuemin={0}
          aria-valuemax={ideas.length}
          aria-label="Ideas completion"
        >
          {ideas.map((i) => (
            <span
              key={i.id}
              className={`ideas-notebook-dot${i.done ? " ideas-notebook-dot--done" : ""}`}
              aria-hidden="true"
            />
          ))}
        </div>
      ) : null}

      <p className="muted small ideas-notebook-hint">
        Jot poem ideas. Pick a mood colour. Drag to reorder. Tick when written.
      </p>

      <form className="ideas-notebook-add" onSubmit={onAdd}>
        <div className="ideas-notebook-add-row">
          <input
            type="text"
            className="ideas-notebook-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="A spark, a line, a memory…"
            maxLength={IDEA_TEXT_MAX}
            aria-label="New idea"
          />
          <button
            type="submit"
            className="ideas-notebook-add-btn"
            disabled={!draft.trim()}
            aria-label="Add idea"
            title="Add"
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
          </button>
        </div>
        <div
          className="ideas-notebook-mood-picker"
          role="radiogroup"
          aria-label="Idea mood"
        >
          {IDEA_MOOD_OPTIONS.map((o) => (
            <button
              key={o.mood}
              type="button"
              role="radio"
              aria-checked={draftMood === o.mood}
              className={`ideas-notebook-mood-swatch ideas-notebook-mood-swatch--${o.mood}${draftMood === o.mood ? " is-active" : ""}`}
              onClick={() => setDraftMood(o.mood)}
              title={o.label}
              aria-label={`${o.label} mood`}
            />
          ))}
        </div>
      </form>

      {ideas.length === 0 ? (
        <div className="ideas-notebook-empty">
          <div className="ideas-notebook-empty-stack" aria-hidden="true">
            <span className="ideas-notebook-empty-card ideas-notebook-empty-card--1" />
            <span className="ideas-notebook-empty-card ideas-notebook-empty-card--2" />
            <span className="ideas-notebook-empty-card ideas-notebook-empty-card--3" />
          </div>
          <p className="muted small">Pin your first idea above.</p>
        </div>
      ) : (
        <>
          {active.length > 0 ? (
            <ul className="ideas-notebook-grid">
              {active.map((idea) => renderItem(idea))}
            </ul>
          ) : (
            <p className="muted small ideas-notebook-all-done">
              ✓ Every idea written
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
                  className="ideas-notebook-grid ideas-notebook-grid--done"
                  id="ideas-notebook-done-list"
                >
                  {done.map((idea) => renderItem(idea))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
