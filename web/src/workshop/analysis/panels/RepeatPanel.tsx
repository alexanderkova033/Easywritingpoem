import { useMemo, useState } from "react";
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
import { CraftStatCard } from "@/workshop/analysis/tools/CraftCards";
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
  peekToLine?: (line1Based: number, word?: string) => void;
  clearHoverPeek?: () => void;
}

export function RepeatPanel({
  poemId,
  docStats,
  repeated,
  repetition,
  heavyToolsStale,
  goToLine,
  peekToLine,
  clearHoverPeek,
}: RepeatPanelProps) {
  const [repeatWordFilter, setRepeatWordFilter] = useState("");
  const [repeatSubTab, setRepeatSubTab] = useState<
    "words" | "phrases" | "patterns"
  >("words");
  const { ignore, restoreAll, isIgnored, countInCategory } =
    useIgnoredCraftItems(poemId);
  const ignoredCount = countInCategory(IGNORE_CATEGORY);

  const filteredRepeated = useMemo(() => {
    const t = repeatWordFilter.trim().toLowerCase();
    return repeated
      .filter((r) => !isIgnored(IGNORE_CATEGORY, r.word))
      .filter(
        (r) =>
          !t ||
          r.word.toLowerCase().includes(t) ||
          r.variants.some((v) => v.toLowerCase().includes(t)),
      );
  }, [repeated, repeatWordFilter, isIgnored]);

  const filteredPhrases = useMemo(() => {
    const t = repeatWordFilter.trim().toLowerCase();
    if (!t) return repetition.phrases;
    return repetition.phrases.filter((p) => p.phrase.toLowerCase().includes(t));
  }, [repetition.phrases, repeatWordFilter]);

  const repetitionCounts = useMemo(
    () => ({
      words: repeated.length,
      phrases: repetition.phrases.length,
      patterns: repetition.anaphora.length + repetition.epistrophe.length,
    }),
    [repeated, repetition],
  );

  const totalRepeats =
    repetitionCounts.words +
    repetitionCounts.phrases +
    repetitionCounts.patterns;

  let tone: "good" | "warn" | "info" = "info";
  let title = "";
  let metricLabel: string;
  let hint: string | undefined;
  if (totalRepeats === 0) {
    tone = "good";
    title = "No repeats";
    metricLabel = "clean";
    hint = "No non-stopword words, phrases, or patterns repeat in this poem.";
  } else if (repetitionCounts.words >= 6 || repetitionCounts.phrases >= 3) {
    tone = "warn";
    title = "Several echoes worth a look";
    metricLabel = "repeats";
    hint = "A few repeated words or phrases stand out. Tap any to jump to that line.";
  } else {
    title = "A few echoes spotted";
    metricLabel = "repeats";
    hint = "Most repeats are light. Tap any to jump to that line.";
  }

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
      <CraftStatCard
        tone={tone}
        title={title}
        metric={totalRepeats}
        metricLabel={metricLabel}
        hint={hint}
      />
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
        repeated.length === 0 ? (
          <EmptyState title="No word repeats">
            <p className="muted small">
              Nice—list stays empty unless a non-stopword repeats.
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
                  peekToLine={peekToLine}
                  clearHoverPeek={clearHoverPeek}
                  onReject={() => ignore(IGNORE_CATEGORY, r.word)}
                />
              ))}
            </ul>
            {ignoredCount > 0 ? (
              <button
                type="button"
                className="craft-restore-link linkish small"
                onClick={() => restoreAll(IGNORE_CATEGORY)}
              >
                Show {ignoredCount} hidden
              </button>
            ) : null}
          </>
        )
      ) : null}

      {repeatSubTab === "phrases" ? (
        repetition.phrases.length === 0 ? (
          <EmptyState title="No phrase echoes">
            <p className="muted small">
              No 2- or 3-word phrases repeat across your poem.
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
                peekToLine={peekToLine}
                clearHoverPeek={clearHoverPeek}
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
                      peekToLine={peekToLine}
                      clearHoverPeek={clearHoverPeek}
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
                      peekToLine={peekToLine}
                      clearHoverPeek={clearHoverPeek}
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
