import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentStats } from "@/workshop/analysis/line-stats";
import type { SpellHit } from "@/spellcheck/scan";
import type { SpellMode } from "@/workshop/library/local-draft-storage";
import { downloadTextFile } from "@/workshop/library/export-poem";
import {
  addToPersonalDictionary,
  addWordsToPersonalDictionary,
  ignoreWordForSession,
  ignoreWordsForSession,
  listPersonalDictionaryWords,
  mergePersonalDictionaryFromJson,
  removeFromPersonalDictionary,
} from "@/spellcheck/personal-dictionary";
import { EmptyState, NoLinesYetHint } from "@/workshop/analysis/tools/shared";
import { LiveSectionTitle } from "../ToolTabBar";

export interface SpellPanelProps {
  docStats: DocumentStats;
  spellHits: SpellHit[];
  wordlist: Set<string> | null;
  wordlistErr: string | null;
  spellMode: SpellMode;
  onSpellModeChange: (mode: SpellMode) => void;
  goToSpellHitAt: (hit: SpellHit) => void;
  applySpellSuggestion: (hit: SpellHit, replacement: string) => boolean;
  applySpellSuggestionAll: (normalized: string, replacement: string) => boolean;
  spellBump: number;
  refreshSpell: () => void;
  onSpellPersistenceError: (message: string) => void;
  heavyToolsStale: boolean;
}

export function SpellPanel({
  docStats,
  spellHits,
  wordlist,
  wordlistErr,
  spellMode,
  onSpellModeChange,
  goToSpellHitAt,
  applySpellSuggestion,
  applySpellSuggestionAll,
  spellBump,
  refreshSpell,
  onSpellPersistenceError,
  heavyToolsStale,
}: SpellPanelProps) {
  const [spellListCap, setSpellListCap] = useState(50);
  const [spellReplaceErr, setSpellReplaceErr] = useState<string | null>(null);
  const [expandedSuggestions, setExpandedSuggestions] = useState<Set<string>>(
    () => new Set(),
  );
  const dictImportInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSpellListCap(50);
    setExpandedSuggestions(new Set());
  }, [spellHits, spellMode]);

  const toggleSuggestionExpand = (normalized: string) => {
    setExpandedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      return next;
    });
  };

  const personalWords = useMemo(
    () => listPersonalDictionaryWords(),
    [spellHits, spellBump],
  );

  const spellHitGroups = useMemo(() => {
    const map = new Map<
      string,
      { normalized: string; display: string; hits: SpellHit[]; suggestions: string[] }
    >();
    for (const h of spellHits) {
      const existing = map.get(h.normalized);
      if (existing) {
        existing.hits.push(h);
      } else {
        map.set(h.normalized, {
          normalized: h.normalized,
          display: h.word,
          hits: [h],
          suggestions: h.suggestions,
        });
      }
    }
    return Array.from(map.values());
  }, [spellHits]);

  const likelyProperNouns = useMemo(() => {
    const out: string[] = [];
    for (const g of spellHitGroups) {
      if (g.hits.length < 2) continue;
      const allCapitalized = g.hits.every((h) => {
        const first = h.word[0];
        return !!first && first === first.toUpperCase() && /[A-Z]/.test(first);
      });
      if (allCapitalized) out.push(g.normalized);
    }
    return out;
  }, [spellHitGroups]);

  return (
    <div
      className="tool-block tool-block-live"
      id="tool-panel-spell"
      role="tabpanel"
      aria-labelledby="tool-tab-spell"
    >
      <LiveSectionTitle>Spelling</LiveSectionTitle>
      {docStats.nonEmptyLines === 0 ? <NoLinesYetHint /> : null}
      <div
        className="spell-strategy-toggle"
        role="group"
        aria-label="How strictly to flag unknown words"
      >
        <button
          type="button"
          className={`segment-btn spell-strategy-btn ${spellMode === "permissive" ? "active" : ""}`}
          aria-pressed={spellMode === "permissive"}
          title="Fewer flags — poetry-friendly"
          onClick={() => onSpellModeChange("permissive")}
        >
          Poetry-friendly
        </button>
        <button
          type="button"
          className={`segment-btn spell-strategy-btn ${spellMode === "strict" ? "active" : ""}`}
          aria-pressed={spellMode === "strict"}
          title="More flags — strict"
          onClick={() => onSpellModeChange("strict")}
        >
          Strict
        </button>
      </div>
      {wordlistErr ? (
        <p className="error compact" role="alert">
          {wordlistErr}
        </p>
      ) : !wordlist ? (
        <p className="muted small" aria-busy="true">
          Loading dictionary…
        </p>
      ) : (
        <>
          {spellHits.length === 0 ? (
            <EmptyState title="No spelling flags">
              <p className="muted small">
                Looks clean under your current mode.
              </p>
            </EmptyState>
          ) : (
            <>
              {spellReplaceErr ? (
                <p className="error compact" role="alert">
                  {spellReplaceErr}
                </p>
              ) : null}
            <div
              className="spell-summary-bar"
              role="group"
              aria-label="Spelling summary and bulk actions"
            >
              <span className="spell-summary-count">
                {spellHitGroups.length} flagged
              </span>
              <span className="spell-summary-actions">
                <button
                  type="button"
                  className="linkish spell-summary-link"
                  title="Skip every flag for this session"
                  onClick={() => {
                    const words = spellHitGroups.map((g) => g.normalized);
                    if (words.length === 0) return;
                    if (!ignoreWordsForSession(words)) {
                      onSpellPersistenceError(
                        "Could not update session spelling skips.",
                      );
                      return;
                    }
                    refreshSpell();
                  }}
                >
                  Skip all
                </button>
                {likelyProperNouns.length > 0 ? (
                  <>
                    <span className="spell-aux-sep" aria-hidden="true">·</span>
                    <button
                      type="button"
                      className="linkish spell-summary-link"
                      title="Add words that appear capitalized 2+ times — usually names"
                      onClick={() => {
                        if (!addWordsToPersonalDictionary(likelyProperNouns)) {
                          onSpellPersistenceError(
                            "Could not save those words to your dictionary (browser storage blocked or full).",
                          );
                          return;
                        }
                        refreshSpell();
                      }}
                    >
                      Add {likelyProperNouns.length} likely{" "}
                      {likelyProperNouns.length === 1 ? "name" : "names"}
                    </button>
                  </>
                ) : null}
              </span>
            </div>
            <ul className="spell-hits spell-hits-draft">
              {spellHitGroups.slice(0, spellListCap).map((g) => {
                const count = g.hits.length;
                const first = g.hits[0]!;
                return (
                  <li key={g.normalized} className="spell-hit-group">
                    <div className="spell-hit-head">
                      <span className="mono spell-hit-word">{g.display}</span>
                      <span className="spell-hit-lines">
                        {g.hits.slice(0, 6).map((h, i) => (
                          <button
                            key={`${h.docFrom}-${h.docTo}`}
                            type="button"
                            className="linkish spell-hit-line-link"
                            onClick={() => goToSpellHitAt(h)}
                            title={`Jump to line ${h.lineNumber}`}
                          >
                            L{h.lineNumber}
                            {i < Math.min(g.hits.length, 6) - 1 ? "," : ""}
                          </button>
                        ))}
                        {g.hits.length > 6 ? (
                          <span className="muted small">
                            +{g.hits.length - 6}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    {g.suggestions.length > 0 ? (() => {
                      const isExpanded = expandedSuggestions.has(g.normalized);
                      const maxShown = Math.min(g.suggestions.length, 5);
                      const visibleLimit = isExpanded ? maxShown : Math.min(maxShown, 2);
                      const visible = g.suggestions.slice(0, visibleLimit);
                      const hiddenCount = maxShown - visible.length;
                      const showFewer = isExpanded && maxShown > 2;
                      return (
                        <div className="spell-suggestion-actions">
                          {visible.map((sug) => (
                            <button
                              key={sug}
                              type="button"
                              className="small-btn"
                              disabled={heavyToolsStale}
                              title={
                                heavyToolsStale
                                  ? "Pause typing so the list matches the editor"
                                  : count > 1
                                    ? `Replace all ${count} with “${sug}”`
                                    : `Replace with “${sug}”`
                              }
                              onClick={() => {
                                setSpellReplaceErr(null);
                                const ok =
                                  count > 1
                                    ? applySpellSuggestionAll(g.normalized, sug)
                                    : applySpellSuggestion(first, sug);
                                if (!ok) {
                                  setSpellReplaceErr(
                                    "Could not replace — wait until tools match your draft (pause typing), then try again.",
                                  );
                                  return;
                                }
                                refreshSpell();
                              }}
                            >
                              {sug}
                            </button>
                          ))}
                          {hiddenCount > 0 ? (
                            <button
                              type="button"
                              className="linkish spell-suggestion-more"
                              aria-expanded={false}
                              onClick={() => toggleSuggestionExpand(g.normalized)}
                              title={`Show ${hiddenCount} more suggestion${hiddenCount === 1 ? "" : "s"}`}
                            >
                              +{hiddenCount} more
                            </button>
                          ) : showFewer ? (
                            <button
                              type="button"
                              className="linkish spell-suggestion-more"
                              aria-expanded={true}
                              onClick={() => toggleSuggestionExpand(g.normalized)}
                            >
                              fewer
                            </button>
                          ) : null}
                        </div>
                      );
                    })() : null}
                    <div className="spell-row-aux">
                      <button
                        type="button"
                        className="linkish spell-aux-link"
                        onClick={() => {
                          if (!addToPersonalDictionary(g.normalized)) {
                            onSpellPersistenceError(
                              "Could not save that word to your dictionary (browser storage blocked or full).",
                            );
                            return;
                          }
                          refreshSpell();
                        }}
                      >
                        Add to dictionary
                      </button>
                      <span className="spell-aux-sep" aria-hidden="true">·</span>
                      <button
                        type="button"
                        className="linkish spell-aux-link"
                        onClick={() => {
                          if (!ignoreWordForSession(g.normalized)) {
                            onSpellPersistenceError(
                              "Could not update session spelling skips.",
                            );
                            return;
                          }
                          refreshSpell();
                        }}
                      >
                        Skip
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {spellHitGroups.length > spellListCap ? (
              <p className="spell-show-more-wrap">
                <button
                  type="button"
                  className="small-btn"
                  onClick={() => setSpellListCap((c) => c + 50)}
                >
                  Show 50 more
                </button>
              </p>
            ) : null}
            </>
          )}
          <details className="tool-hint-details personal-dict-details">
            <summary className="tool-hint-summary">
              Personal dictionary ({personalWords.length})
            </summary>
            {personalWords.length === 0 ? (
              <p className="muted small tool-hint-body">
                No words yet. Use <strong>Add to dictionary</strong> on any flag above.
              </p>
            ) : (
              <ul className="personal-dict-wordlist">
                {personalWords.map((w) => (
                  <li key={w}>
                    <span className="mono">{w}</span>
                    <button
                      type="button"
                      className="small-btn personal-dict-remove"
                      onClick={() => {
                        if (!removeFromPersonalDictionary(w)) {
                          onSpellPersistenceError(
                            "Could not update your dictionary (browser storage blocked or full).",
                          );
                          return;
                        }
                        refreshSpell();
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="personal-dict-io-row">
              {personalWords.length > 0 ? (
                <button
                  type="button"
                  className="small-btn"
                  onClick={() =>
                    downloadTextFile(
                      "easy-poems-personal-dictionary.json",
                      `${JSON.stringify(personalWords, null, 2)}\n`,
                    )
                  }
                >
                  Export
                </button>
              ) : null}
              <input
                ref={dictImportInputRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                aria-label="Import personal dictionary JSON"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  void (async () => {
                    try {
                      const text = await f.text();
                      const res = mergePersonalDictionaryFromJson(text);
                      if (!res.ok) {
                        onSpellPersistenceError(res.error);
                        return;
                      }
                      refreshSpell();
                    } catch {
                      onSpellPersistenceError(
                        "Could not read that file.",
                      );
                    }
                  })();
                }}
              />
              <button
                type="button"
                className="small-btn"
                onClick={() => dictImportInputRef.current?.click()}
              >
                Import
              </button>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
