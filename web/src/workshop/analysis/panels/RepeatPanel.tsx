import { useMemo, useState } from "react";
export type RepeatSubTab = "words" | "phrases" | "patterns";
import type { DocumentStats } from "@/workshop/analysis/line-stats";
import type {
  RepeatedWord,
  RepetitionAnalysis,
} from "@/workshop/analysis/repeated-words";
import { EmptyState, NoLinesYetHint } from "@/workshop/analysis/tools/shared";
import {
  EdgeRepeatCard,
  PhraseRepeatCard,
  RepeatedWordCard,
} from "@/workshop/analysis/tools/RepetitionCards";
import { useIgnoredCraftItems } from "@/workshop/analysis/craft-ignored-storage";
import { LiveSectionTitle } from "../ToolTabBar";

const IGNORE_CATEGORY = "repeats";

export interface RepeatPanelProps {
  poemId?: string;
  docStats: DocumentStats;
  repeated: RepeatedWord[];
  repetition: RepetitionAnalysis;
  heavyToolsStale: boolean;
  goToLine: (line1Based: number) => void;
  subTab: RepeatSubTab;
  setSubTab: (t: RepeatSubTab) => void;
}

export function RepeatPanel({
  poemId,
  docStats,
  repeated,
  repetition,
  heavyToolsStale,
  goToLine,
  subTab: repeatSubTab,
  setSubTab: setRepeatSubTab,
}: RepeatPanelProps) {
  const [repeatWordFilter, setRepeatWordFilter] = useState("");
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const { ignored, ignore, restore, restoreAll, isIgnored, countInCategory } =
    useIgnoredCraftItems(poemId);
  const ignoredCount = countInCategory(IGNORE_CATEGORY);

  const ignoredItems = useMemo(() => {
    const prefix = `${IGNORE_CATEGORY}:`;
    const out: string[] = [];
    for (const k of ignored) {
      if (k.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [ignored]);

  // Priority: Patterns > Phrases > Words. If a token is already represented in
  // a higher tier, suppress its lower-tier card so the same word/phrase does
  // not surface in multiple subtabs.
  const patternPrefixes = useMemo(
    () => [
      ...repetition.anaphora.map((a) => a.prefix),
      ...repetition.epistrophe.map((e) => e.prefix),
    ],
    [repetition.anaphora, repetition.epistrophe],
  );

  const dedupedPhrases = useMemo(() => {
    if (patternPrefixes.length === 0) return repetition.phrases;
    const prefixSet = new Set(patternPrefixes);
    return repetition.phrases.filter((p) => {
      if (prefixSet.has(p.phrase)) return false;
      // Also drop phrases that are contiguous subsequences of a longer pattern.
      const phraseTokens = p.phrase.split(/\s+/);
      for (const prefix of patternPrefixes) {
        const prefixTokens = prefix.split(/\s+/);
        if (prefixTokens.length <= phraseTokens.length) continue;
        for (let i = 0; i + phraseTokens.length <= prefixTokens.length; i++) {
          let match = true;
          for (let j = 0; j < phraseTokens.length; j++) {
            if (prefixTokens[i + j] !== phraseTokens[j]) {
              match = false;
              break;
            }
          }
          if (match) return false;
        }
      }
      return true;
    });
  }, [repetition.phrases, patternPrefixes]);

  const wordsInHigherTiers = useMemo(() => {
    const s = new Set<string>();
    for (const p of dedupedPhrases) {
      for (const t of p.phrase.split(/\s+/)) if (t) s.add(t);
    }
    for (const prefix of patternPrefixes) {
      for (const t of prefix.split(/\s+/)) if (t) s.add(t);
    }
    return s;
  }, [dedupedPhrases, patternPrefixes]);

  const dedupedWords = useMemo(
    () =>
      repeated.filter(
        (r) =>
          !wordsInHigherTiers.has(r.word) &&
          !r.variants.some((v) => wordsInHigherTiers.has(v)),
      ),
    [repeated, wordsInHigherTiers],
  );

  const filteredRepeated = useMemo(() => {
    const t = repeatWordFilter.trim().toLowerCase();
    return dedupedWords
      .filter((r) => !isIgnored(IGNORE_CATEGORY, r.word))
      .filter(
        (r) =>
          !t ||
          r.word.toLowerCase().includes(t) ||
          r.variants.some((v) => v.toLowerCase().includes(t)),
      );
  }, [dedupedWords, repeatWordFilter, isIgnored]);

  const filteredPhrases = useMemo(() => {
    const t = repeatWordFilter.trim().toLowerCase();
    if (!t) return dedupedPhrases;
    return dedupedPhrases.filter((p) => p.phrase.toLowerCase().includes(t));
  }, [dedupedPhrases, repeatWordFilter]);

  const repetitionCounts = useMemo(
    () => ({
      words: dedupedWords.length,
      phrases: dedupedPhrases.length,
      patterns: repetition.anaphora.length + repetition.epistrophe.length,
    }),
    [dedupedWords, dedupedPhrases, repetition.anaphora, repetition.epistrophe],
  );

  return (
    <div
      className="tool-block tool-block-live"
      id="tool-panel-repeat"
      role="tabpanel"
      aria-labelledby="tool-tab-repeat"
    >
      <LiveSectionTitle>Repeats</LiveSectionTitle>
      {docStats.nonEmptyLines === 0 ? <NoLinesYetHint /> : null}
      {heavyToolsStale ? (
        <p
          className="tools-stale-hint muted small"
          role="status"
          aria-live="polite"
        >
          Tools updating…
        </p>
      ) : null}
      <div className="rep-subtabs" role="tablist" aria-label="Repeats categories">
        <button
          type="button"
          role="tab"
          aria-selected={repeatSubTab === "words"}
          className={`rep-subtab ${repeatSubTab === "words" ? "active" : ""}`}
          onClick={() => setRepeatSubTab("words")}
        >
          Words <span className="rep-subtab-count">{repetitionCounts.words}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={repeatSubTab === "phrases"}
          className={`rep-subtab ${repeatSubTab === "phrases" ? "active" : ""}`}
          onClick={() => setRepeatSubTab("phrases")}
        >
          Phrases <span className="rep-subtab-count">{repetitionCounts.phrases}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={repeatSubTab === "patterns"}
          className={`rep-subtab ${repeatSubTab === "patterns" ? "active" : ""}`}
          onClick={() => setRepeatSubTab("patterns")}
        >
          Patterns <span className="rep-subtab-count">{repetitionCounts.patterns}</span>
        </button>
      </div>

      {repeatSubTab !== "patterns" ? (
        <div className="rep-controls">
          <label className="tool-filter-field rep-filter">
            <span className="tool-filter-label">Filter</span>
            <input
              type="search"
              value={repeatWordFilter}
              onChange={(e) => setRepeatWordFilter(e.target.value)}
              placeholder="Substring"
              aria-label="Filter repeats results"
            />
          </label>
        </div>
      ) : null}

      {repeatSubTab === "words" ? (
        dedupedWords.length === 0 ? (
          <EmptyState title="No word repeats">
            <p className="muted small">
              {repeated.length > 0
                ? "Every repeat here is already shown as a phrase or pattern."
                : "Nice—list stays empty unless a non-stopword repeats."}
            </p>
          </EmptyState>
        ) : filteredRepeated.length === 0 ? (
          <p className="muted small">
            {ignoredCount > 0
              ? "No words left — everything you flagged is hidden."
              : "No words match this filter."}
          </p>
        ) : (
          <>
            <ul className="rep-card-list">
              {filteredRepeated.map((r) => (
                <RepeatedWordCard
                  key={r.word}
                  item={r}
                  cardId={`w:${r.word}`}
                  goToLine={goToLine}
                  onReject={() => ignore(IGNORE_CATEGORY, r.word)}
                />
              ))}
            </ul>
            {ignoredCount > 0 ? (
              <div className="rep-hidden-section">
                <button
                  type="button"
                  className="rep-hidden-toggle linkish small"
                  onClick={() => setHiddenOpen((v) => !v)}
                  aria-expanded={hiddenOpen}
                  aria-controls="rep-hidden-list"
                >
                  {hiddenOpen ? "▾" : "▸"} Hidden ({ignoredCount})
                </button>
                {hiddenOpen ? (
                  <ul id="rep-hidden-list" className="rep-hidden-list">
                    {ignoredItems.map((w) => (
                      <li key={w} className="rep-hidden-item">
                        <span className="rep-hidden-word">{w}</span>
                        <button
                          type="button"
                          className="linkish small"
                          onClick={() => restore(IGNORE_CATEGORY, w)}
                          aria-label={`Restore “${w}”`}
                        >
                          Restore
                        </button>
                      </li>
                    ))}
                    {ignoredCount > 1 ? (
                      <li className="rep-hidden-actions">
                        <button
                          type="button"
                          className="linkish small"
                          onClick={() => restoreAll(IGNORE_CATEGORY)}
                        >
                          Restore all
                        </button>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        )
      ) : null}

      {repeatSubTab === "phrases" ? (
        dedupedPhrases.length === 0 ? (
          <EmptyState title="No phrase echoes">
            <p className="muted small">
              {repetition.phrases.length > 0
                ? "Every phrase echo here is already shown as a pattern."
                : "No 2- or 3-word phrases repeat across your poem."}
            </p>
          </EmptyState>
        ) : filteredPhrases.length === 0 ? (
          <p className="muted small">No phrases match this filter.</p>
        ) : (
          <ul className="rep-card-list">
            {filteredPhrases.map((p) => (
              <PhraseRepeatCard
                key={`${p.n}:${p.phrase}`}
                item={p}
                cardId={`p${p.n}:${p.phrase}`}
                goToLine={goToLine}
              />
            ))}
          </ul>
        )
      ) : null}

      {repeatSubTab === "patterns" ? (
        repetition.anaphora.length === 0 &&
        repetition.epistrophe.length === 0 ? (
          <EmptyState title="No structural patterns">
            <p className="muted small">
              Anaphora (line-start) and epistrophe (line-end) repeats appear here
              when two or more lines share an edge — often intentional craft.
            </p>
          </EmptyState>
        ) : (
          <div className="rep-patterns">
            {repetition.anaphora.length > 0 ? (
              <section className="rep-pattern-section">
                <h4 className="rep-pattern-title">
                  Anaphora <span className="muted small">— line-start echoes</span>
                </h4>
                <ul className="rep-card-list">
                  {repetition.anaphora.map((g) => (
                    <EdgeRepeatCard
                      key={`a:${g.prefix}`}
                      group={g}
                      cardId={`a${g.n}:${g.prefix}`}
                      edge="start"
                      goToLine={goToLine}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {repetition.epistrophe.length > 0 ? (
              <section className="rep-pattern-section">
                <h4 className="rep-pattern-title">
                  Epistrophe <span className="muted small">— line-end echoes</span>
                </h4>
                <ul className="rep-card-list">
                  {repetition.epistrophe.map((g) => (
                    <EdgeRepeatCard
                      key={`e:${g.prefix}`}
                      group={g}
                      cardId={`e${g.n}:${g.prefix}`}
                      edge="end"
                      goToLine={goToLine}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
