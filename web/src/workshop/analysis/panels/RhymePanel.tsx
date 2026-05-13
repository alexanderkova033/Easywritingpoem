import { useMemo, useState } from "react";
import type { DocumentStats } from "@/workshop/analysis/line-stats";
import type { StanzaClusterGroup } from "@/workshop/rhyme/hints";
import type { RhymeBreadth } from "@/workshop/rhyme/scheme";
import { RhymeFinder } from "@/workshop/rhyme/RhymeFinder";
import { useIgnoredRhymes } from "@/workshop/rhyme/rhyme-storage";
import { endWordOfLine } from "@/workshop/analysis/tools/helpers";
import { NoLinesYetHint } from "@/workshop/analysis/tools/shared";
import { LiveSectionTitle } from "../ToolTabBar";

export interface RhymePanelProps {
  docStats: DocumentStats;
  stanzaRhymeGroups: StanzaClusterGroup[];
  poemLines: string[];
  goToLineEnd: (line1Based: number) => void;
  onInsertWord?: (text: string) => void;
  rhymeBreadth: RhymeBreadth;
  onRhymeBreadthChange: (b: RhymeBreadth) => void;
  rhymeFinderQuery?: { word: string; bump: number; expand?: boolean };
  onRhymeSuggestionHover?: (word: string | null) => void;
  manualRhymeLinks?: string[];
  onAddManualRhymeLink?: (a: string, b: string) => void;
  onRemoveManualRhymeLink?: (key: string) => void;
  manualRhymeUnlinks?: string[];
  onAddManualRhymeUnlink?: (a: string, b: string) => void;
  onRemoveManualRhymeUnlink?: (key: string) => void;
  heavyToolsStale: boolean;
}

export function RhymePanel({
  docStats,
  stanzaRhymeGroups,
  poemLines,
  goToLineEnd,
  onInsertWord,
  rhymeBreadth,
  onRhymeBreadthChange,
  rhymeFinderQuery,
  onRhymeSuggestionHover,
  manualRhymeLinks = [],
  onAddManualRhymeLink,
  onRemoveManualRhymeLink,
  manualRhymeUnlinks = [],
  onAddManualRhymeUnlink,
  onRemoveManualRhymeUnlink,
  heavyToolsStale,
}: RhymePanelProps) {
  const [rhymeSettingsOpen, setRhymeSettingsOpen] = useState(false);
  const [rhymeEditMode, setRhymeEditMode] = useState(false);
  const [rhymeLinkSelection, setRhymeLinkSelection] = useState<Array<{ word: string; line: number; label: string | null }>>([]);
  const [manualLinksCollapsed, setManualLinksCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("easy-poems:rhyme-manual-links-collapsed") !== "0"; } catch { return true; }
  });
  const [manualUnlinksCollapsed, setManualUnlinksCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("easy-poems:rhyme-manual-unlinks-collapsed") !== "0"; } catch { return true; }
  });
  const toggleManualLinksCollapsed = () => {
    setManualLinksCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("easy-poems:rhyme-manual-links-collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };
  const toggleManualUnlinksCollapsed = () => {
    setManualUnlinksCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("easy-poems:rhyme-manual-unlinks-collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };
  const { ignoreCluster, isIgnored } = useIgnoredRhymes();

  const toggleRhymeSelection = (word: string, line: number, label: string | null) => {
    setRhymeLinkSelection((prev) => {
      const i = prev.findIndex((p) => p.line === line);
      if (i >= 0) return prev.filter((_, idx) => idx !== i);
      return [...prev, { word, line, label }];
    });
  };

  // Whether the selected end-words all belong to the same rhyme cluster.
  // Used to decide what the action button does (link new group / split apart).
  const rhymeSelectionSameCluster = useMemo(() => {
    if (rhymeLinkSelection.length < 2) return false;
    const first = rhymeLinkSelection[0]!;
    if (first.label === null) return false;
    return rhymeLinkSelection.every((p) => p.label === first.label);
  }, [rhymeLinkSelection]);

  // Distinct end-words in the current selection, lowercased and sorted.
  const rhymeSelectionWords = useMemo(() => {
    const set = new Set<string>();
    for (const p of rhymeLinkSelection) {
      const w = p.word.toLowerCase().trim();
      if (w) set.add(w);
    }
    return [...set].sort();
  }, [rhymeLinkSelection]);

  // Anchor each pair to the first selected word so the manual-class union
  // chains them all into one group via the shared anchor line.
  const applyRhymeSelection = (mode: "link" | "split") => {
    if (rhymeSelectionWords.length < 2) return;
    const [anchor, ...rest] = rhymeSelectionWords;
    if (!anchor) return;
    for (const w of rest) {
      if (mode === "link") {
        const sorted = [anchor, w].sort();
        const conflictKey = `${sorted[0]}+${sorted[1]}`;
        onRemoveManualRhymeUnlink?.(conflictKey);
        onAddManualRhymeLink?.(anchor, w);
      } else {
        const sorted = [anchor, w].sort();
        const conflictKey = `${sorted[0]}+${sorted[1]}`;
        onRemoveManualRhymeLink?.(conflictKey);
        onAddManualRhymeUnlink?.(anchor, w);
      }
    }
    setRhymeLinkSelection([]);
  };
  const clearRhymeSelection = () => setRhymeLinkSelection([]);

  return (
    <div
      className="tool-block tool-block-live"
      id="tool-panel-rhyme"
      role="tabpanel"
      aria-labelledby="tool-tab-rhyme"
    >
      <LiveSectionTitle>Sound &amp; rhyme</LiveSectionTitle>
      {docStats.nonEmptyLines === 0 ? <NoLinesYetHint /> : null}

      <RhymeFinder
        onApplyWord={onInsertWord}
        externalQuery={rhymeFinderQuery}
        onHoverWord={onRhymeSuggestionHover}
      />

      <div className="rhyme-live-section">
        <div className="rhyme-live-header">
          <div className="rhyme-live-header-row">
            <h4 className="tool-subheading rhyme-live-title">Rhymes already in your poem</h4>
            <button
              type="button"
              className={`rhyme-edit-toggle${rhymeEditMode ? " is-active" : ""}`}
              onClick={() => { setRhymeEditMode((v) => !v); setRhymeLinkSelection([]); }}
              aria-pressed={rhymeEditMode}
              title={rhymeEditMode
                ? "Done editing — back to normal view"
                : "Manually link or split rhymes the detector got wrong"}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M10 13a5 5 0 0 0 7.07 0l1.42-1.42a5 5 0 1 0-7.07-7.07L10 6" />
                <path d="M14 11a5 5 0 0 0-7.07 0l-1.42 1.42a5 5 0 1 0 7.07 7.07L14 18" />
              </svg>
              <span>{rhymeEditMode ? "Done" : "Fix rhymes"}</span>
            </button>
            <button
              type="button"
              className={`rhyme-live-settings-btn${rhymeSettingsOpen ? " is-open" : ""}`}
              onClick={() => setRhymeSettingsOpen((v) => !v)}
              aria-expanded={rhymeSettingsOpen}
              aria-label="Rhyme strictness"
              title="Match strictness"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
              </svg>
            </button>
          </div>
          <p className="rhyme-live-sub muted small">
            {rhymeEditMode
              ? "Click end-words to pick a group, then press Link or Split. Pick as many as you like."
              : "Lines whose end-words rhyme — click a word to jump to it."}
          </p>
          {rhymeEditMode && rhymeLinkSelection.length > 0 ? (
            <div className="rhyme-edit-action-bar" role="toolbar" aria-label="Rhyme link actions">
              <span className="rhyme-edit-action-count muted small">
                {rhymeSelectionWords.length} selected
              </span>
              <button
                type="button"
                className="small-btn small-btn-primary"
                disabled={rhymeSelectionWords.length < 2 || rhymeSelectionSameCluster}
                onClick={() => applyRhymeSelection("link")}
                title="Group these end-words as a new rhyme"
              >
                Link as rhyme
              </button>
              <button
                type="button"
                className="small-btn"
                disabled={rhymeSelectionWords.length < 2 || !rhymeSelectionSameCluster}
                onClick={() => applyRhymeSelection("split")}
                title="Split these end-words apart"
              >
                Split apart
              </button>
              <button
                type="button"
                className="small-btn"
                onClick={clearRhymeSelection}
                title="Clear selection"
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>

        {rhymeSettingsOpen ? (
          <div className="rhyme-controls-row">
            <div className="rhyme-breadth-group" role="group" aria-label="Match strictness">
              {(["strict", "near", "broad"] as RhymeBreadth[]).map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`rhyme-breadth-chip${rhymeBreadth === b ? " is-active" : ""}`}
                  aria-pressed={rhymeBreadth === b}
                  onClick={() => onRhymeBreadthChange(b)}
                  title={
                    b === "strict" ? "Strict: last 4 letters must match" :
                    b === "near"   ? "Near: vowel-tail match (default)" :
                                     "Loose: last 2 letters"
                  }
                >
                  {b === "strict" ? "Strict" : b === "near" ? "Near" : "Loose"}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {heavyToolsStale ? (
          <p className="tools-stale-hint muted small" role="status" aria-live="polite">Updating…</p>
        ) : null}

        {stanzaRhymeGroups.length === 0 && docStats.nonEmptyLines > 0 ? (
          <p className="muted small">Rhymes appear once two line endings match in the same stanza.</p>
        ) : null}

        {stanzaRhymeGroups.map((group) => {
          // Scheme already produces final labels (auto + manual classes
          // with fresh letters). Just drop ignored clusters and render.
          const visibleClusters = group.clusters
            .filter((c) => {
              const words = c.lineNumbers.map((n) => endWordOfLine(poemLines[n - 1]));
              return !isIgnored(words);
            })
            .map((c) => ({
              ending: c.ending,
              label: c.label ?? null,
              lineNumbers: [...c.lineNumbers],
            }));

          // Loose ends: end-words in this stanza not currently in any visible cluster.
          // Shown only in edit mode so user can link them into other rhymes.
          const clusteredLines = new Set<number>();
          for (const c of visibleClusters) for (const n of c.lineNumbers) clusteredLines.add(n);
          const looseEnds: Array<{ line: number; word: string }> = [];
          if (rhymeEditMode) {
            for (let n = group.lineRange[0]; n <= group.lineRange[1]; n++) {
              if (clusteredLines.has(n)) continue;
              const w = endWordOfLine(poemLines[n - 1]);
              if (w) looseEnds.push({ line: n, word: w });
            }
          }

          if (visibleClusters.length === 0 && looseEnds.length === 0) return null;
          return (
            <div key={`stanza-${group.stanza}`} className="rhyme-stanza-group">
              <div className="rhyme-stanza-head">
                <span className="rhyme-stanza-label">Stanza {group.stanza}</span>
                <span className="rhyme-stanza-range muted small">
                  lines {group.lineRange[0]}–{group.lineRange[1]}
                </span>
              </div>
              <ul className="rhyme-cluster-cards">
                {visibleClusters.map((c) => {
                  const words = c.lineNumbers.map((n) => endWordOfLine(poemLines[n - 1]));
                  const labelChar = c.label ? c.label.charAt(0).toLowerCase() : "";
                  const labelClass = labelChar ? ` rhyme-label-${labelChar}` : "";
                  const cardClass = labelChar ? ` rhyme-cluster-card-${labelChar}` : "";
                  return (
                    <li key={c.ending} className={`rhyme-cluster-card${cardClass}`}>
                      {c.label ? <span className={`rhyme-cluster-card-tag rhyme-label-${labelChar}`}>{c.label}</span> : null}
                      <div className="rhyme-cluster-chips">
                        {c.lineNumbers.map((n) => {
                          const word = endWordOfLine(poemLines[n - 1]) || `line ${n}`;
                          const selected = rhymeLinkSelection.some((p) => p.line === n);
                          return (
                            <button
                              key={n}
                              type="button"
                              className={`rhyme-word-chip${labelClass}${selected ? " is-selected" : ""}`}
                              onClick={() => rhymeEditMode ? toggleRhymeSelection(word, n, c.label ?? null) : goToLineEnd(n)}
                              title={rhymeEditMode
                                ? (selected ? "Click to deselect" : "Pick another to link or split")
                                : `Line ${n} — jump to end word`}
                            >
                              <span className="rhyme-word-chip-word">{word}</span>
                              <span className="rhyme-word-chip-line">{n}</span>
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          className="rhyme-cluster-reject"
                          onClick={() => ignoreCluster(words)}
                          title="Not a rhyme — hide this group"
                          aria-label="Mark as not a rhyme"
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  );
                })}
                {looseEnds.length > 0 ? (
                  <li className="rhyme-cluster-card rhyme-cluster-card-loose">
                    <span className="rhyme-cluster-card-tag rhyme-cluster-card-tag-loose">unlinked</span>
                    <div className="rhyme-cluster-chips">
                      {looseEnds.map(({ line, word }) => {
                        const selected = rhymeLinkSelection.some((p) => p.line === line);
                        return (
                          <button
                            key={line}
                            type="button"
                            className={`rhyme-word-chip rhyme-word-chip-loose${selected ? " is-selected" : ""}`}
                            onClick={() => toggleRhymeSelection(word, line, null)}
                            title={selected ? "Click to deselect" : "Pick another to link as a rhyme"}
                          >
                            <span className="rhyme-word-chip-word">{word}</span>
                            <span className="rhyme-word-chip-line">{line}</span>
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ) : null}
              </ul>
            </div>
          );
        })}

        {manualRhymeLinks.length > 0 ? (
          <div className={`rhyme-manual-links${manualLinksCollapsed ? " is-collapsed" : ""}`}>
            <button
              type="button"
              className="rhyme-manual-links-head rhyme-manual-links-toggle"
              onClick={toggleManualLinksCollapsed}
              aria-expanded={!manualLinksCollapsed}
              title={manualLinksCollapsed ? "Show linked rhymes" : "Hide linked rhymes"}
            >
              <span className={`current-line-rhymes-chevron${manualLinksCollapsed ? "" : " is-open"}`} aria-hidden>▸</span>
              <span className="rhyme-stanza-label">Linked as rhymes</span>
              <span className="muted small">{manualRhymeLinks.length} pair{manualRhymeLinks.length === 1 ? "" : "s"}</span>
            </button>
            {manualLinksCollapsed ? null : (
            <ul className="rhyme-manual-links-list">
              {manualRhymeLinks.map((key) => {
                const parts = key.split("+");
                if (parts.length !== 2) return null;
                // Find which stanza + cluster letter this link landed in,
                // by scanning lines for end-words matching either side.
                let stanzaNum: number | null = null;
                let labelChar = "";
                for (let i = 0; i < poemLines.length; i++) {
                  const w = endWordOfLine(poemLines[i]).toLowerCase();
                  if (w === parts[0] || w === parts[1]) {
                    for (const g of stanzaRhymeGroups) {
                      if (i + 1 >= g.lineRange[0] && i + 1 <= g.lineRange[1]) {
                        stanzaNum = g.stanza;
                        for (const c of g.clusters) {
                          if (c.lineNumbers.includes(i + 1) && c.label) {
                            labelChar = c.label.charAt(0).toLowerCase();
                            break;
                          }
                        }
                        break;
                      }
                    }
                    if (labelChar) break;
                  }
                }
                return (
                  <li key={key} className="rhyme-manual-link-row">
                    {labelChar ? (
                      <span className={`rhyme-cluster-card-tag rhyme-label-${labelChar}`}>{labelChar.toUpperCase()}</span>
                    ) : null}
                    <span className="rhyme-manual-link-pair">
                      <span className="rhyme-manual-link-word">{parts[0]}</span>
                      <span className="rhyme-manual-link-arrow" aria-hidden>↔</span>
                      <span className="rhyme-manual-link-word">{parts[1]}</span>
                    </span>
                    {stanzaNum !== null ? (
                      <span className="rhyme-manual-link-stanza muted small">stanza {stanzaNum}</span>
                    ) : null}
                    <button
                      type="button"
                      className="rhyme-cluster-reject"
                      onClick={() => onRemoveManualRhymeLink?.(key)}
                      title="Remove rhyme link"
                      aria-label={`Remove rhyme link ${parts[0]} ↔ ${parts[1]}`}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
            )}
          </div>
        ) : null}

        {manualRhymeUnlinks.length > 0 ? (
          <div className={`rhyme-manual-links rhyme-manual-unlinks${manualUnlinksCollapsed ? " is-collapsed" : ""}`}>
            <button
              type="button"
              className="rhyme-manual-links-head rhyme-manual-links-toggle"
              onClick={toggleManualUnlinksCollapsed}
              aria-expanded={!manualUnlinksCollapsed}
              title={manualUnlinksCollapsed ? "Show split pairs" : "Hide split pairs"}
            >
              <span className={`current-line-rhymes-chevron${manualUnlinksCollapsed ? "" : " is-open"}`} aria-hidden>▸</span>
              <span className="rhyme-stanza-label">Split apart</span>
              <span className="muted small">{manualRhymeUnlinks.length} pair{manualRhymeUnlinks.length === 1 ? "" : "s"}</span>
            </button>
            {manualUnlinksCollapsed ? null : (
            <ul className="rhyme-manual-links-list">
              {manualRhymeUnlinks.map((key) => {
                const parts = key.split("+");
                if (parts.length !== 2) return null;
                return (
                  <li key={key} className="rhyme-manual-link-row">
                    <span className="rhyme-manual-link-pair">
                      <span className="rhyme-manual-link-word">{parts[0]}</span>
                      <span className="rhyme-manual-link-arrow" aria-hidden>⊘</span>
                      <span className="rhyme-manual-link-word">{parts[1]}</span>
                    </span>
                    <button
                      type="button"
                      className="rhyme-cluster-reject"
                      onClick={() => onRemoveManualRhymeUnlink?.(key)}
                      title="Remove split"
                      aria-label={`Remove split ${parts[0]} ⊘ ${parts[1]}`}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
