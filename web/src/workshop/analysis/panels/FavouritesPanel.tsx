import { useMemo, useState } from "react";
import {
  useFavouriteWords,
  useLookedUpWords,
} from "@/workshop/vocabulary/favourite-words-storage";
import { LiveSectionTitle } from "../ToolTabBar";

export interface FavouritesPanelProps {
  onInsertWord?: (text: string) => void;
}

type FavTab = "favourites" | "looked-up";

export function FavouritesPanel({ onInsertWord }: FavouritesPanelProps) {
  const { favourites, removeFavourite, addFavourite, updateNote } = useFavouriteWords();
  const { lookedUp, removeLookup, clearLookups } = useLookedUpWords();
  const [tab, setTab] = useState<FavTab>("favourites");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const favCount = favourites.length;
  const lookCount = lookedUp.length;

  const sortedFavs = useMemo(
    () => [...favourites].sort((a, b) => (b.addedAt > a.addedAt ? 1 : -1)),
    [favourites],
  );
  const sortedLookups = useMemo(
    () => [...lookedUp].sort((a, b) => (b.lookedUpAt > a.lookedUpAt ? 1 : -1)),
    [lookedUp],
  );

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
      className="tool-block tool-block-live tool-block-favourites"
      id="tool-panel-favourites"
      role="tabpanel"
      aria-labelledby="tool-tab-favourites"
    >
      <LiveSectionTitle>Words you keep</LiveSectionTitle>

      <div className="favourites-tabs" role="tablist" aria-label="Word lists">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "favourites"}
          className={`favourites-tab${tab === "favourites" ? " is-active" : ""}`}
          onClick={() => setTab("favourites")}
        >
          ★ Favourites
          <span className="favourites-tab-count">{favCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "looked-up"}
          className={`favourites-tab${tab === "looked-up" ? " is-active" : ""}`}
          onClick={() => setTab("looked-up")}
        >
          📖 Looked up
          <span className="favourites-tab-count">{lookCount}</span>
        </button>
      </div>

      {tab === "favourites" && (
        <>
          {sortedFavs.length === 0 ? (
            <p className="muted small favourites-empty">
              No starred words yet. Select a word, open <strong>Define</strong>, then tap the
              star to keep it here.
            </p>
          ) : (
            <ul className="favourites-list">
              {sortedFavs.map((f) => {
                const def = f.defs?.[0];
                const editing = editingNote === f.word;
                return (
                  <li key={f.word} className="favourites-row">
                    <div className="favourites-row-head">
                      <button
                        type="button"
                        className="favourites-word linkish"
                        title={onInsertWord ? `Insert "${f.word}" into the poem` : f.word}
                        onClick={() => onInsertWord?.(f.word)}
                      >
                        {f.word}
                      </button>
                      {f.pos && <span className="favourites-pos">{f.pos}</span>}
                      <button
                        type="button"
                        className="favourites-remove"
                        onClick={() => removeFavourite(f.word)}
                        title="Remove favourite"
                        aria-label={`Remove ${f.word} from favourites`}
                      >
                        ×
                      </button>
                    </div>
                    {def && <p className="favourites-def">{def}</p>}
                    {f.syns && f.syns.length > 0 && (
                      <div className="favourites-syns">
                        {f.syns.slice(0, 8).map((s) => (
                          <button
                            key={s}
                            type="button"
                            className="favourites-syn-chip"
                            title={onInsertWord ? `Insert "${s}"` : s}
                            onClick={() => onInsertWord?.(s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                    {editing ? (
                      <div className="favourites-note-edit">
                        <input
                          type="text"
                          className="favourites-note-input"
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
                        className={`favourites-note${f.note ? " has-note" : ""}`}
                        onClick={() => startEditNote(f.word, f.note)}
                        title="Add or edit a note"
                      >
                        {f.note || "+ note"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {tab === "looked-up" && (
        <>
          {sortedLookups.length === 0 ? (
            <p className="muted small favourites-empty">
              Words you define from the editor appear here, newest first.
            </p>
          ) : (
            <>
              <div className="favourites-toolbar">
                <button
                  type="button"
                  className="small-btn favourites-clear-all"
                  onClick={clearLookups}
                  title="Clear the lookup history"
                >
                  Clear all
                </button>
              </div>
              <ul className="favourites-list favourites-list-compact">
                {sortedLookups.map((l) => (
                  <li key={l.word} className="favourites-row favourites-row-compact">
                    <div className="favourites-row-head">
                      <button
                        type="button"
                        className="favourites-word linkish"
                        title={onInsertWord ? `Insert "${l.word}"` : l.word}
                        onClick={() => onInsertWord?.(l.word)}
                      >
                        {l.word}
                      </button>
                      {l.pos && <span className="favourites-pos">{l.pos}</span>}
                      <button
                        type="button"
                        className="favourites-star"
                        onClick={() =>
                          addFavourite({ word: l.word, pos: l.pos, defs: l.firstDef ? [l.firstDef] : [] })
                        }
                        title="Add to favourites"
                        aria-label={`Add ${l.word} to favourites`}
                      >
                        ☆
                      </button>
                      <button
                        type="button"
                        className="favourites-remove"
                        onClick={() => removeLookup(l.word)}
                        title="Forget this lookup"
                        aria-label={`Remove ${l.word} from history`}
                      >
                        ×
                      </button>
                    </div>
                    {l.firstDef && <p className="favourites-def">{l.firstDef}</p>}
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
