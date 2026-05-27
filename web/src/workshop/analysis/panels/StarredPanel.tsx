import { useMemo, useState } from "react";
import {
  useStarredWords,
  useLookedUpWords,
} from "@/workshop/vocabulary/starred-words-storage";
import { LiveSectionTitle } from "../ToolTabBar";
import { EmptyState } from "@/workshop/analysis/tools/shared";

export interface StarredPanelProps {
  onInsertWord?: (text: string) => void;
}

type StarredSubTab = "starred" | "looked-up";

export function StarredPanel({ onInsertWord }: StarredPanelProps) {
  const { starred, removeStarred, addStarred, updateNote } = useStarredWords();
  const { lookedUp, removeLookup, clearLookups } = useLookedUpWords();
  const [subTab, setSubTab] = useState<StarredSubTab>("starred");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [filter, setFilter] = useState("");

  const starCount = starred.length;
  const lookCount = lookedUp.length;

  const sortedStarred = useMemo(() => {
    const t = filter.trim().toLowerCase();
    const all = [...starred].sort((a, b) => (b.addedAt > a.addedAt ? 1 : -1));
    if (!t) return all;
    return all.filter((s) =>
      s.word.includes(t) ||
      (s.note ?? "").toLowerCase().includes(t) ||
      (s.defs ?? []).some((d) => d.toLowerCase().includes(t)),
    );
  }, [starred, filter]);

  const sortedLookups = useMemo(() => {
    const t = filter.trim().toLowerCase();
    const all = [...lookedUp].sort((a, b) => (b.lookedUpAt > a.lookedUpAt ? 1 : -1));
    if (!t) return all;
    return all.filter((l) =>
      l.word.includes(t) || (l.firstDef ?? "").toLowerCase().includes(t),
    );
  }, [lookedUp, filter]);

  const startEditNote = (word: string, current: string | undefined) => {
    setEditingNote(word);
    setNoteDraft(current ?? "");
  };
  const commitNote = () => {
    if (editingNote != null) updateNote(editingNote, noteDraft);
    setEditingNote(null);
    setNoteDraft("");
  };

  return (
    <div
      className="tool-block tool-block-live tool-block-starred"
      id="tool-panel-starred"
      role="tabpanel"
      aria-labelledby="tool-tab-starred"
    >
      <LiveSectionTitle>Words you keep</LiveSectionTitle>

      <div className="rep-subtabs" role="tablist" aria-label="Word lists">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "starred"}
          className={`rep-subtab${subTab === "starred" ? " active" : ""}`}
          onClick={() => setSubTab("starred")}
        >
          ★ Starred <span className="rep-subtab-count">{starCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "looked-up"}
          className={`rep-subtab${subTab === "looked-up" ? " active" : ""}`}
          onClick={() => setSubTab("looked-up")}
        >
          📖 Looked up <span className="rep-subtab-count">{lookCount}</span>
        </button>
      </div>

      {(starCount > 0 || lookCount > 0) && (
        <div className="rep-controls">
          <label className="tool-filter-field starred-filter">
            <span className="tool-filter-label">Filter</span>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Substring"
              aria-label="Filter your word lists"
            />
          </label>
        </div>
      )}

      {subTab === "starred" && (
        <>
          {sortedStarred.length === 0 ? (
            starCount === 0 ? (
              <EmptyState title="No starred words yet">
                <p className="muted small">
                  Select a word in your poem, open <strong>Define</strong>, then tap
                  the ☆ Save button to keep it here. Starred words also surface in the
                  Rhyme tool when they happen to rhyme with what you're looking up.
                </p>
              </EmptyState>
            ) : (
              <p className="muted small">No starred words match this filter.</p>
            )
          ) : (
            <ul className="starred-list">
              {sortedStarred.map((s) => {
                const def = s.defs?.[0];
                const editing = editingNote === s.word;
                return (
                  <li key={s.word} className="starred-row">
                    <div className="starred-row-head">
                      <button
                        type="button"
                        className="starred-word linkish"
                        title={onInsertWord ? `Insert "${s.word}" into the poem` : s.word}
                        onClick={() => onInsertWord?.(s.word)}
                      >
                        {s.word}
                      </button>
                      {s.pos && <span className="starred-pos">{s.pos}</span>}
                      <button
                        type="button"
                        className="starred-remove"
                        onClick={() => removeStarred(s.word)}
                        title="Remove from starred"
                        aria-label={`Remove ${s.word} from starred`}
                      >
                        ×
                      </button>
                    </div>
                    {def && <p className="starred-def">{def}</p>}
                    {s.syns && s.syns.length > 0 && (
                      <div className="starred-syns">
                        {s.syns.slice(0, 8).map((syn) => (
                          <button
                            key={syn}
                            type="button"
                            className="starred-syn-chip"
                            title={onInsertWord ? `Insert "${syn}"` : syn}
                            onClick={() => onInsertWord?.(syn)}
                          >
                            {syn}
                          </button>
                        ))}
                      </div>
                    )}
                    {editing ? (
                      <div className="starred-note-edit">
                        <input
                          type="text"
                          className="starred-note-input"
                          autoFocus
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          onBlur={commitNote}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitNote();
                            if (e.key === "Escape") { setEditingNote(null); setNoteDraft(""); }
                          }}
                          placeholder="Why you saved this word…"
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={`starred-note${s.note ? " has-note" : ""}`}
                        onClick={() => startEditNote(s.word, s.note)}
                        title="Add or edit a note"
                      >
                        {s.note || "+ note"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {subTab === "looked-up" && (
        <>
          {sortedLookups.length === 0 ? (
            lookCount === 0 ? (
              <EmptyState title="No lookups yet">
                <p className="muted small">
                  Words you define from the editor appear here, newest first.
                </p>
              </EmptyState>
            ) : (
              <p className="muted small">No lookups match this filter.</p>
            )
          ) : (
            <>
              <div className="starred-toolbar">
                <button
                  type="button"
                  className="small-btn starred-clear-all"
                  onClick={clearLookups}
                  title="Clear the lookup history"
                >
                  Clear all
                </button>
              </div>
              <ul className="starred-list starred-list-compact">
                {sortedLookups.map((l) => (
                  <li key={l.word} className="starred-row starred-row-compact">
                    <div className="starred-row-head">
                      <button
                        type="button"
                        className="starred-word linkish"
                        title={onInsertWord ? `Insert "${l.word}"` : l.word}
                        onClick={() => onInsertWord?.(l.word)}
                      >
                        {l.word}
                      </button>
                      {l.pos && <span className="starred-pos">{l.pos}</span>}
                      <button
                        type="button"
                        className="starred-star"
                        onClick={() =>
                          addStarred({ word: l.word, pos: l.pos, defs: l.firstDef ? [l.firstDef] : [] })
                        }
                        title="Star this word"
                        aria-label={`Star ${l.word}`}
                      >
                        ☆
                      </button>
                      <button
                        type="button"
                        className="starred-remove"
                        onClick={() => removeLookup(l.word)}
                        title="Forget this lookup"
                        aria-label={`Remove ${l.word} from history`}
                      >
                        ×
                      </button>
                    </div>
                    {l.firstDef && <p className="starred-def">{l.firstDef}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
