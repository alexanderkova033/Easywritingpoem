import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SpellMode } from "@/workshop/library/local-draft-storage";
import type { SpellHit } from "@/spellcheck/scan";
import type { WorkshopGoals } from "@/workshop/library/workshop-goals";
import { FORM_PRESETS } from "@/workshop/library/workshop-goals";
import {
  ALL_GOAL_KEYS,
  hasAnyGoalSet,
} from "@/workshop/goals/types";
import type { GoalEvaluation } from "@/workshop/analysis/goal-metrics";
import type { DocumentStats } from "@/workshop/analysis/line-stats";
import type { ChecklistItem } from "@/workshop/analysis/publication-checklist";
import type { RhymeCluster } from "@/workshop/analysis/rhyme-hints";
import type { StanzaClusterGroup } from "@/workshop/rhyme/hints";
import type {
  RepeatedWord,
  RepetitionAnalysis,
} from "@/workshop/analysis/repeated-words";
import type { RevisionSnapshot } from "@/workshop/library/revision-snapshots";
import type { LineDiffRow } from "@/workshop/library/diff-lines";
import type {
  LineMeterHint,
} from "@/workshop/analysis/meter-hints";
import { downloadTextFile } from "@/workshop/library/export-poem";
import {
  addToPersonalDictionary,
  ignoreWordForSession,
  listPersonalDictionaryWords,
  mergePersonalDictionaryFromJson,
  removeFromPersonalDictionary,
} from "@/spellcheck/personal-dictionary";
import { LiveSectionTitle } from "./ToolTabBar";
import { RhymeFinder } from "./RhymeFinder";
import { useIgnoredRhymes } from "@/workshop/rhyme/rhyme-storage";
import { StuckHelper } from "./StuckHelper";
import { IdeasNotebook } from "@/workshop/goals/IdeasNotebook";
import type { ClicheHit } from "@/workshop/analysis/cliche-scan";
import {
  RevisionCompareSection,
  type CompareSnapshotOption,
} from "./RevisionCompareSection";
import type { ToolTab } from "@/workshop/shell/workshop-helpers";
import type { RhymeBreadth } from "@/workshop/analysis/rhyme-scheme";
import {
  LINES_TABLE_MAX,
  METER_TABLE_MAX,
  checklistJumpLabel,
  endWordOfLine,
  meterStressSourceHint,
  meterStressSourceMark,
} from "@/workshop/analysis/tools/helpers";
import {
  EmptyState,
  JumpLineList,
  NoLinesYetHint,
} from "@/workshop/analysis/tools/shared";
import {
  MetricGoalCard,
  RhymeSchemeCard,
  SyllableCapCard,
} from "@/workshop/analysis/tools/GoalCards";
import {
  EdgeRepeatCard,
  PhraseRepeatCard,
  RepeatedWordCard,
  RepetitionSummary,
} from "@/workshop/analysis/tools/RepetitionCards";


export interface WorkshopToolPanelsProps {
  toolTab: ToolTab;
  docStats: DocumentStats;
  meterHints: LineMeterHint[];
  goals: WorkshopGoals;
  goalEvaluation: GoalEvaluation;
  publication: { items: ChecklistItem[]; tips: string[] };
  rhymeClusters: RhymeCluster[];
  vowelTailClusters: RhymeCluster[];
  assonanceClusters: RhymeCluster[];
  consonanceClusters: RhymeCluster[];
  stanzaRhymeGroups: StanzaClusterGroup[];
  clicheHits: ClicheHit[];
  repeated: RepeatedWord[];
  repetition: RepetitionAnalysis;
  spellHits: SpellHit[];
  wordlist: Set<string> | null;
  wordlistErr: string | null;
  spellMode: SpellMode;
  onSpellModeChange: (mode: SpellMode) => void;
  goToLine: (line1Based: number) => void;
  goToLineEnd: (line1Based: number) => void;
  goToSpellHitAt: (hit: SpellHit) => void;
  cycleSpellHit: (delta: number) => void;
  spellNavIndex: number;
  applySpellSuggestion: (hit: SpellHit, replacement: string) => boolean;
  applySpellSuggestionAll: (normalized: string, replacement: string) => boolean;
  spellBump: number;
  refreshSpell: () => void;
  onSpellPersistenceError: (message: string) => void;
  updateGoal: (
    key: keyof WorkshopGoals,
  ) => (e: ChangeEvent<HTMLInputElement>) => void;
  setGoalValue: (key: keyof WorkshopGoals, value: number | undefined) => void;
  setRhymeSchemeGoal: (scheme: string | undefined) => void;
  setRhymeSchemePerStanza: (perStanza: boolean) => void;
  resetGoals: () => void;
  toggleGoalSoft: (key: string) => void;
  applyGoalPreset: (presetKey: string | null) => void;
  revisions: RevisionSnapshot[];
  snapshotLabel: string;
  onSnapshotLabelChange: (v: string) => void;
  onSaveSnapshot: () => void;
  snapshotFlash: "saved" | "duplicate" | null;
  onRestoreRevision: (snap: RevisionSnapshot) => void;
  onDeleteRevision: (id: string) => void;
  onDeleteDuplicateRevisions: () => void;
  duplicateRevisionCount: number;
  /** Open inline word-level diff in the editor against this snapshot. */
  onDiffSnapshot?: (snap: RevisionSnapshot) => void;
  /** ID of snapshot currently shown as inline diff, or null. */
  activeDiffSnapshotId?: string | null;
  compareLeftId: string;
  compareRightId: string;
  onCompareLeftChange: (id: string) => void;
  onCompareRightChange: (id: string) => void;
  compareViewMode: "side" | "diff";
  onCompareViewModeChange: (mode: "side" | "diff") => void;
  compareSnapshotOptions: CompareSnapshotOption[];
  compareLeftBody: string;
  compareRightBody: string;
  compareDiffRows: LineDiffRow[];
  onOpenToolTab: (tab: ToolTab) => void;
  focusPoemTitle: () => void;
  stressLexiconReady: boolean;
  stressLexiconErr: string | null;
  heavyToolsStale: boolean;
  poemTitle: string;
  poemLines: string[];
  onInsertSuggestion?: (text: string) => void;
  onInsertWord?: (text: string) => void;
  onReplaceLine?: (lineNum: number, text: string) => void;
  rhymeBreadth: RhymeBreadth;
  onRhymeBreadthChange: (b: RhymeBreadth) => void;
  cursorLine?: number;
  rhymeFinderQuery?: { word: string; bump: number; expand?: boolean };
  onRhymeSuggestionHover?: (word: string | null) => void;
  manualRhymeLinks?: string[];
  onAddManualRhymeLink?: (a: string, b: string) => void;
  onRemoveManualRhymeLink?: (key: string) => void;
  manualRhymeUnlinks?: string[];
  onAddManualRhymeUnlink?: (a: string, b: string) => void;
  onRemoveManualRhymeUnlink?: (key: string) => void;
}

export function WorkshopToolPanels(props: WorkshopToolPanelsProps) {
  const {
    toolTab,
    docStats,
    meterHints,
    goals,
    goalEvaluation,
    publication,
    stanzaRhymeGroups,
    clicheHits,
    repeated,
    repetition,
    spellHits,
    wordlist,
    wordlistErr,
    spellMode,
    onSpellModeChange,
    goToLine,
    goToLineEnd,
    goToSpellHitAt,
    applySpellSuggestion,
    applySpellSuggestionAll,
    spellBump,
    refreshSpell,
    onSpellPersistenceError,
    setGoalValue,
    setRhymeSchemeGoal,
    setRhymeSchemePerStanza,
    resetGoals,
    toggleGoalSoft,
    applyGoalPreset,
    revisions,
    snapshotLabel,
    onSnapshotLabelChange,
    onSaveSnapshot,
    snapshotFlash,
    onRestoreRevision,
    onDeleteRevision,
    onDeleteDuplicateRevisions,
    duplicateRevisionCount,
    onDiffSnapshot,
    activeDiffSnapshotId,
    compareLeftId,
    compareRightId,
    onCompareLeftChange,
    onCompareRightChange,
    compareViewMode,
    onCompareViewModeChange,
    compareSnapshotOptions,
    compareLeftBody,
    compareRightBody,
    compareDiffRows,
    onOpenToolTab,
    focusPoemTitle,
    stressLexiconReady,
    stressLexiconErr,
    heavyToolsStale,
    poemTitle,
    poemLines,
    onInsertSuggestion,
    onInsertWord,
    onReplaceLine,
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
  } = props;

  const [hideEmptyLines, setHideEmptyLines] = useState(false);
  const [spellListCap, setSpellListCap] = useState(50);
  const [spellReplaceErr, setSpellReplaceErr] = useState<string | null>(null);
  const dictImportInputRef = useRef<HTMLInputElement | null>(null);
  const [meterHideBlank, setMeterHideBlank] = useState(true);
  const [meterOnlyLowFit, setMeterOnlyLowFit] = useState(false);
  const [meterLowFitThreshold, setMeterLowFitThreshold] = useState(60);
  const [meterOnlyHeuristic, setMeterOnlyHeuristic] = useState(false);
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
  const [repeatWordFilter, setRepeatWordFilter] = useState("");
  const [repeatSubTab, setRepeatSubTab] = useState<
    "words" | "phrases" | "patterns"
  >("words");
  const [goLineField, setGoLineField] = useState("");

  useEffect(() => {
    if (toolTab !== "spell") setSpellReplaceErr(null);
  }, [toolTab]);

  useEffect(() => {
    setSpellListCap(50);
  }, [spellHits, spellMode]);

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

  const filteredRepeated = useMemo(() => {
    const t = repeatWordFilter.trim().toLowerCase();
    if (!t) return repeated;
    return repeated.filter(
      (r) =>
        r.word.toLowerCase().includes(t) ||
        r.variants.some((v) => v.toLowerCase().includes(t)),
    );
  }, [repeated, repeatWordFilter]);

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

  const displayedLineRows = useMemo(() => {
    if (!hideEmptyLines) return docStats.lines;
    return docStats.lines.filter((r) => r.text.trim().length > 0);
  }, [docStats.lines, hideEmptyLines]);

  const lineStanzaMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of docStats.stanzaStats) {
      for (let ln = s.startLine; ln <= s.endLine; ln++) {
        m.set(ln, s.stanzaIndex);
      }
    }
    return m;
  }, [docStats.stanzaStats]);

  const maxLineSyllables = useMemo(() => {
    let max = 0;
    for (const r of displayedLineRows) {
      if (r.syllables > max) max = r.syllables;
    }
    return max || 1;
  }, [displayedLineRows]);

  const syllOutlierBounds = useMemo(() => {
    const nums = docStats.lines
      .filter((r) => r.text.trim().length > 0)
      .map((r) => r.syllables)
      .sort((a, b) => a - b);
    if (nums.length < 4) return null;
    const q = (p: number) => {
      const i = (nums.length - 1) * p;
      const lo = Math.floor(i);
      const hi = Math.ceil(i);
      return nums[lo]! + (nums[hi]! - nums[lo]!) * (i - lo);
    };
    const q1 = q(0.25);
    const q3 = q(0.75);
    const iqr = q3 - q1;
    if (iqr < 1) return null;
    return { lo: q1 - 1.5 * iqr, hi: q3 + 1.5 * iqr };
  }, [docStats.lines]);

  const displayedMeterHints = useMemo(() => {
    const rows = meterHints.slice(0, METER_TABLE_MAX);
    return rows.filter((r) => {
      if (meterHideBlank && !r.stressPattern) return false;
      if (meterOnlyHeuristic && r.stressSource !== "heuristic") return false;
      if (!meterOnlyLowFit) return true;
      if (r.iambicFitPercent == null) return false;
      return r.iambicFitPercent < meterLowFitThreshold;
    });
  }, [
    meterHideBlank,
    meterHints,
    meterLowFitThreshold,
    meterOnlyHeuristic,
    meterOnlyLowFit,
  ]);


  const openChecklistItems = publication.items.filter((i) => !i.done);

  type QueueSeverity = "now" | "soon" | "optional";
  interface QueueIssue {
    id: string;
    severity: QueueSeverity;
    category: "spell" | "checklist" | "goal" | "cliche";
    categoryLabel: string;
    title: string;
    detail?: string;
    line?: number;
    onJump?: () => void;
    primary?: { label: string; onClick: () => void; disabled?: boolean };
  }

  const queueIssues = useMemo<QueueIssue[]>(() => {
    const list: QueueIssue[] = [];
    for (const w of goalEvaluation.warnings) {
      list.push({
        id: `goal:${w}`,
        severity: "now",
        category: "goal",
        categoryLabel: "Goal",
        title: w,
        primary: {
          label: "Open Goals",
          onClick: () => onOpenToolTab("goals"),
        },
      });
    }
    for (const item of openChecklistItems) {
      if (item.icon === "spell" || item.icon === "goals") continue;
      list.push({
        id: `chk:${item.text}`,
        severity: "soon",
        category: "checklist",
        categoryLabel: "Checklist",
        title: item.text,
        detail: item.detail,
        primary:
          item.focusTitleField
            ? { label: "Add title", onClick: () => focusPoemTitle() }
            : item.openToolTab
              ? {
                  label: checklistJumpLabel(item),
                  onClick: () => onOpenToolTab(item.openToolTab!),
                }
              : undefined,
      });
    }
    const groupMap = new Map<string, SpellHit[]>();
    for (const h of spellHits) {
      const arr = groupMap.get(h.normalized);
      if (arr) arr.push(h);
      else groupMap.set(h.normalized, [h]);
    }
    for (const [normalized, hits] of groupMap) {
      const first = hits[0]!;
      const count = hits.length;
      const top = first.suggestions[0];
      list.push({
        id: `spell:${normalized}`,
        severity: "soon",
        category: "spell",
        categoryLabel: "Spelling",
        title: `“${first.word}”${count > 1 ? ` ×${count}` : ""}`,
        detail:
          first.suggestions.length > 0
            ? `Try: ${first.suggestions.slice(0, 3).join(", ")}`
            : undefined,
        line: first.lineNumber,
        onJump: () => goToSpellHitAt(first),
        primary: top
          ? {
              label: count > 1 ? `Replace all → “${top}”` : `Use “${top}”`,
              disabled: heavyToolsStale,
              onClick: () => {
                const ok =
                  count > 1
                    ? applySpellSuggestionAll(normalized, top)
                    : applySpellSuggestion(first, top);
                if (ok) refreshSpell();
              },
            }
          : { label: "Jump", onClick: () => goToSpellHitAt(first) },
      });
    }
    for (let i = 0; i < clicheHits.length; i++) {
      const h = clicheHits[i]!;
      list.push({
        id: `cliche:${i}:${h.lineNumber}:${h.phrase}`,
        severity: "optional",
        category: "cliche",
        categoryLabel: "Cliché",
        title: `“${h.phrase}”`,
        line: h.lineNumber,
        onJump: () => goToLine(h.lineNumber),
        primary: { label: "Jump", onClick: () => goToLine(h.lineNumber) },
      });
    }
    return list;
  }, [
    goalEvaluation.warnings,
    openChecklistItems,
    spellHits,
    clicheHits,
    heavyToolsStale,
    onOpenToolTab,
    focusPoemTitle,
    goToLine,
    goToSpellHitAt,
    applySpellSuggestion,
    applySpellSuggestionAll,
    refreshSpell,
  ]);

  const queueBuckets = useMemo(() => {
    const buckets: Record<QueueSeverity, QueueIssue[]> = {
      now: [],
      soon: [],
      optional: [],
    };
    for (const it of queueIssues) buckets[it.severity].push(it);
    return buckets;
  }, [queueIssues]);

  return (
    <div className="tool-tab-panel" key={toolTab}>
      {toolTab === "issues" ? (
        <div
          className="tool-block tool-block-live"
          id="tool-panel-issues"
          role="tabpanel"
          aria-labelledby="tool-tab-issues"
        >
          <LiveSectionTitle>Revision queue</LiveSectionTitle>
          {!wordlist ? (
            <p className="muted small" aria-busy="true">
              Dictionary loading — spelling flags appear here when ready.
            </p>
          ) : null}
          {queueIssues.length === 0 ? (
            <EmptyState title="All clear — keep writing.">
              <p className="muted small">
                Checklist, goals, spelling, and clichés all satisfied. Issues
                appear here as you draft.
              </p>
            </EmptyState>
          ) : (
            <div className="queue-buckets">
              {(["now", "soon", "optional"] as QueueSeverity[]).map((sev) => {
                const items = queueBuckets[sev];
                if (items.length === 0) return null;
                const label =
                  sev === "now" ? "Now" : sev === "soon" ? "Soon" : "Optional";
                return (
                  <section
                    key={sev}
                    className={`queue-bucket queue-bucket-${sev}`}
                  >
                    <header className="queue-bucket-head">
                      <span className={`queue-sev-dot queue-sev-dot-${sev}`} aria-hidden />
                      <h4 className="tool-subheading queue-bucket-title">
                        {label}
                        <span className="queue-bucket-count">{items.length}</span>
                      </h4>
                    </header>
                    <ul className="queue-list" aria-label={`${label} issues`}>
                      {items.map((it) => (
                        <li
                          key={it.id}
                          className={`queue-item queue-item-${it.category}`}
                        >
                          <div className="queue-item-header">
                            <span
                              className={`queue-cat queue-cat-${it.category}`}
                              title={it.categoryLabel}
                            >
                              {it.categoryLabel}
                            </span>
                            {it.line != null && it.onJump ? (
                              <button
                                type="button"
                                className="queue-line-link"
                                onClick={it.onJump}
                                title={`Jump to line ${it.line}`}
                              >
                                L{it.line}
                              </button>
                            ) : null}
                          </div>
                          <div className="queue-body">
                            <div className="queue-title-row">
                              <span className="queue-title">{it.title}</span>
                            </div>
                            {it.detail ? (
                              <p className="queue-detail muted small">
                                {it.detail}
                              </p>
                            ) : null}
                          </div>
                          {it.primary ? (
                            <button
                              type="button"
                              className="small-btn queue-primary-btn"
                              disabled={it.primary.disabled}
                              onClick={it.primary.onClick}
                            >
                              {it.primary.label}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              {goalEvaluation.syllableOverLines.length > 0 ? (
                <p className="muted small goal-syllable-jumps">
                  Lines over syllable cap:{" "}
                  <JumpLineList
                    lineNumbers={goalEvaluation.syllableOverLines}
                    goToLine={goToLine}
                  />
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {toolTab === "goals" ? (
        <div
          className="tool-block"
          id="tool-panel-goals"
          role="tabpanel"
          aria-labelledby="tool-tab-goals"
        >
          <h3 className="tool-heading-you">
            <span className="you-marker" aria-hidden />
            <span className="tool-heading-you-text">Goals</span>
          </h3>

          <div className="goal-presets-row">
            <div className="goal-presets" role="group" aria-label="Form presets">
              {FORM_PRESETS.map((p) => {
                const isActive = goals.preset === p.key;
                // Detect drift: compare each preset goal key to current value.
                const drifted =
                  isActive &&
                  ALL_GOAL_KEYS.some((k) => {
                    const presetVal = (p.goals as Record<string, unknown>)[k];
                    const curVal = (goals as Record<string, unknown>)[k];
                    return (presetVal ?? null) !== (curVal ?? null);
                  });
                return (
                  <button
                    key={p.key}
                    type="button"
                    className={`goal-preset-chip${isActive ? " goal-preset-chip--active" : ""}${drifted ? " goal-preset-chip--drifted" : ""}`}
                    title={
                      drifted
                        ? `${p.description} (modified — click to re-apply)`
                        : p.description
                    }
                    onClick={() =>
                      isActive && !drifted
                        ? applyGoalPreset(null)
                        : applyGoalPreset(p.key)
                    }
                  >
                    {p.label}
                    {drifted ? (
                      <span className="goal-preset-chip-modified" aria-hidden>
                        ●
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {hasAnyGoalSet(goals) ? (
              <button
                type="button"
                className="goal-reset-btn linkish"
                onClick={resetGoals}
                title="Clear every goal target"
              >
                Reset all
              </button>
            ) : null}
          </div>

          {!hasAnyGoalSet(goals) ? (
            <p className="muted small goal-empty-hint">
              Pick a form preset above, or set your own targets below.
            </p>
          ) : null}

          <div className="goal-cards">
            <MetricGoalCard
              label="Lines"
              current={docStats.nonEmptyLines}
              isSoft={!!goals.softGoals?.includes("targetLines")}
              onToggleSoft={() => toggleGoalSoft("targetLines")}
              targetValue={goals.targetLines}
              rangeMin={goals.minLines}
              rangeMax={goals.maxLines}
              onSetTarget={(v) => setGoalValue("targetLines", v)}
              onSetRange={(min, max) => {
                setGoalValue("minLines", min);
                setGoalValue("maxLines", max);
              }}
            />
            <MetricGoalCard
              label="Stanzas"
              current={docStats.stanzaCount}
              hint="Stanzas are blocks of lines separated by blank lines"
              isSoft={!!goals.softGoals?.includes("targetStanzas")}
              onToggleSoft={() => toggleGoalSoft("targetStanzas")}
              targetValue={goals.targetStanzas}
              rangeMin={goals.minStanzas}
              rangeMax={goals.maxStanzas}
              onSetTarget={(v) => setGoalValue("targetStanzas", v)}
              onSetRange={(min, max) => {
                setGoalValue("minStanzas", min);
                setGoalValue("maxStanzas", max);
              }}
            />
            <MetricGoalCard
              label="Words"
              current={docStats.totalWords}
              isSoft={!!goals.softGoals?.includes("targetWords")}
              onToggleSoft={() => toggleGoalSoft("targetWords")}
              targetValue={goals.targetWords}
              rangeMin={goals.minWords}
              rangeMax={goals.maxWords}
              onSetTarget={(v) => setGoalValue("targetWords", v)}
              onSetRange={(min, max) => {
                setGoalValue("minWords", min);
                setGoalValue("maxWords", max);
              }}
            />
            <SyllableCapCard
              cap={goals.maxSyllablesPerLine}
              overLines={goalEvaluation.syllableOverLines}
              goToLine={goToLine}
              isSoft={!!goals.softGoals?.includes("maxSyllablesPerLine")}
              onToggleSoft={() => toggleGoalSoft("maxSyllablesPerLine")}
              onSet={(v) => setGoalValue("maxSyllablesPerLine", v)}
            />
            <RhymeSchemeCard
              target={goals.targetRhymeScheme ?? ""}
              perStanza={!!goals.targetRhymeSchemePerStanza}
              matches={goalEvaluation.rhymeSchemeMatches}
              schemePerLine={goalEvaluation.schemePerLine}
              onSet={setRhymeSchemeGoal}
              onSetPerStanza={setRhymeSchemePerStanza}
              isSoft={!!goals.softGoals?.includes("targetRhymeScheme")}
              onToggleSoft={() => toggleGoalSoft("targetRhymeScheme")}
            />
          </div>

          {goalEvaluation.softHints.length > 0 && (
            <ul className="goal-soft-hints">
              {goalEvaluation.softHints.map((h, i) => (
                <li key={i} className="goal-soft-hint">◇ {h}</li>
              ))}
            </ul>
          )}

          {goalEvaluation.warnings.length === 0 &&
          goalEvaluation.softHints.length === 0 &&
          hasAnyGoalSet(goals) ? (
            <p className="goal-on-target">✓ All goals met</p>
          ) : null}

          <IdeasNotebook />
        </div>
      ) : null}

      {toolTab === "lines" ? (
        <div
          className="tool-block tool-block-live"
          id="tool-panel-lines"
          role="tabpanel"
          aria-labelledby="tool-tab-lines"
        >
          <LiveSectionTitle>Line table</LiveSectionTitle>
          {docStats.nonEmptyLines === 0 ? <NoLinesYetHint /> : null}
          {heavyToolsStale ? (
            <p
              className="tools-stale-hint muted small"
              role="status"
              aria-live="polite"
            >
              Table syllable estimates match your text in a moment.
            </p>
          ) : null}
          <form
            className="lines-go-form"
            onSubmit={(e) => {
              e.preventDefault();
              const n = parseInt(goLineField.trim(), 10);
              if (!Number.isFinite(n) || n < 1) return;
              goToLine(n);
            }}
          >
            <label className="lines-go-label">
              Go to line
              <input
                id="go-line-input"
                value={goLineField}
                onChange={(e) => setGoLineField(e.target.value)}
                inputMode="numeric"
                placeholder="#"
                aria-label="Go to line number"
              />
            </label>
            <button type="submit" className="small-btn">
              Go
            </button>
          </form>
          <div className="lines-table-toolbar">
            <label className="lines-hide-empty-label">
              <input
                type="checkbox"
                checked={hideEmptyLines}
                onChange={(e) => setHideEmptyLines(e.target.checked)}
              />
              Hide blank lines
            </label>
          </div>
          <div className="table-wrap table-wrap-draft">
            <table
              className="line-table line-table-draft"
              title="Per-line stats; click a row to jump in the editor."
            >
              <caption className="sr-only">
                Per line: line number, estimated syllables, word count,
                and character count. Activate a row to move the cursor
                there.
              </caption>
              <thead>
                <tr>
                  <th scope="col">
                    <abbr title="Line number">Line</abbr>
                  </th>
                  <th scope="col" className="line-table-preview-th">Text</th>
                  <th scope="col" className="line-table-syll-th">
                    <abbr title="Estimated syllables (heuristic) with bar relative to longest line">
                      Syll.
                    </abbr>
                  </th>
                  <th scope="col">Words</th>
                  <th scope="col">Chars</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const rows = displayedLineRows.slice(0, LINES_TABLE_MAX);
                  const out: ReactNode[] = [];
                  let prevStanza: number | null = null;
                  for (const row of rows) {
                    const stanza = lineStanzaMap.get(row.lineNumber) ?? null;
                    if (
                      stanza != null &&
                      prevStanza != null &&
                      stanza !== prevStanza
                    ) {
                      out.push(
                        <tr
                          key={`sep-${row.lineNumber}`}
                          className="line-table-stanza-sep"
                          aria-hidden="true"
                        >
                          <td colSpan={5}>
                            <span className="line-table-stanza-sep-bar" />
                          </td>
                        </tr>,
                      );
                    }
                    prevStanza = stanza ?? prevStanza;
                    const trimmed = row.text.trim();
                    const preview =
                      trimmed.length > 22
                        ? trimmed.slice(0, 22).trimEnd() + "…"
                        : trimmed;
                    const isBlank = trimmed.length === 0;
                    const barPct = isBlank
                      ? 0
                      : Math.max(
                          4,
                          Math.round((row.syllables / maxLineSyllables) * 100),
                        );
                    const outlier =
                      !isBlank &&
                      syllOutlierBounds != null &&
                      (row.syllables < syllOutlierBounds.lo ||
                        row.syllables > syllOutlierBounds.hi);
                    out.push(
                      <tr
                        key={row.lineNumber}
                        className={`line-table-data-row line-table-row-jump${outlier ? " is-syll-outlier" : ""}${isBlank ? " is-blank-line" : ""}`}
                        tabIndex={0}
                        aria-label={`Line ${row.lineNumber}: ${row.syllables} syllables, ${row.words} words${outlier ? " (syllable outlier)" : ""}. Open in editor.`}
                        onClick={() => goToLine(row.lineNumber)}
                        onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            goToLine(row.lineNumber);
                          }
                        }}
                      >
                        <td className="line-table-metric line-table-line-num">
                          {row.lineNumber}
                        </td>
                        <td
                          className="line-table-preview"
                          title={trimmed || "(blank line)"}
                        >
                          {isBlank ? (
                            <span className="line-table-preview-blank">·</span>
                          ) : (
                            preview
                          )}
                        </td>
                        <td className="line-table-metric line-table-syll-cell">
                          <span className="line-table-syll-bar-wrap" aria-hidden>
                            <span
                              className="line-table-syll-bar"
                              style={{ width: `${barPct}%` }}
                            />
                          </span>
                          <span className="line-table-syll-num">
                            {row.syllables}
                            {outlier ? (
                              <span
                                className="line-table-syll-flag"
                                aria-hidden
                                title="Syllable outlier vs. rest of the poem"
                              >
                                !
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="line-table-metric">{row.words}</td>
                        <td className="line-table-metric">{row.chars}</td>
                      </tr>,
                    );
                  }
                  return out;
                })()}
              </tbody>
            </table>
          </div>
          {displayedLineRows.length > LINES_TABLE_MAX ? (
            <p className="muted small">
              Showing first {LINES_TABLE_MAX} of {displayedLineRows.length}{" "}
              rows
              {hideEmptyLines ? " (blank lines hidden)" : ""}.
            </p>
          ) : null}
        </div>
      ) : null}

      {toolTab === "meter" ? (
        <div
          className="tool-block tool-block-live tool-block-meter"
          id="tool-panel-meter"
          role="tabpanel"
          aria-labelledby="tool-tab-meter"
        >
          <LiveSectionTitle>Stress &amp; meter</LiveSectionTitle>
          {docStats.nonEmptyLines === 0 ? <NoLinesYetHint /> : null}
          {stressLexiconErr ? (
            <p className="error compact" role="alert">{stressLexiconErr}</p>
          ) : !stressLexiconReady ? (
            <p className="muted small meter-lexicon-status" aria-busy="true">Loading stress dictionary…</p>
          ) : null}
          {heavyToolsStale ? (
            <p className="tools-stale-hint muted small" role="status" aria-live="polite">Updating…</p>
          ) : null}

          <div className="meter-controls" role="group" aria-label="Meter filters">
            <label className="meter-toggle">
              <input type="checkbox" checked={meterHideBlank} onChange={(e) => setMeterHideBlank(e.target.checked)} />
              Hide blanks
            </label>
            <label className="meter-toggle">
              <input type="checkbox" checked={meterOnlyLowFit} onChange={(e) => setMeterOnlyLowFit(e.target.checked)} />
              Low fit only
            </label>
            <label className="meter-toggle">
              <input type="checkbox" checked={meterOnlyHeuristic} onChange={(e) => setMeterOnlyHeuristic(e.target.checked)} />
              Guessed only
            </label>
            {meterOnlyLowFit ? (
              <label className="meter-threshold">
                Below <input type="number" min={0} max={100} step={5} value={meterLowFitThreshold}
                  onChange={(e) => setMeterLowFitThreshold(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 60)} /> %
              </label>
            ) : null}
          </div>

          {/* Visual stress bars — one row per line */}
          <ul className="meter-bar-list" aria-label="Stress patterns by line">
            {displayedMeterHints.map((row) => {
              const fit = row.iambicFitPercent;
              const fitClass = fit == null ? "" : fit >= 70 ? "meter-fit-high" : fit >= 40 ? "meter-fit-mid" : "meter-fit-low";
              return (
                <li
                  key={row.lineNumber}
                  className="meter-bar-row"
                  tabIndex={0}
                  role="button"
                  aria-label={`Line ${row.lineNumber}: ${row.stressPattern || "no pattern"}. Click to jump.`}
                  onClick={() => goToLine(row.lineNumber)}
                  onKeyDown={(e: KeyboardEvent<HTMLLIElement>) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goToLine(row.lineNumber); }
                  }}
                  title={meterStressSourceHint(row.stressSource)}
                >
                  <span className="meter-bar-line-num">{row.lineNumber}</span>
                  <span className="meter-bar-beats" aria-hidden>
                    {row.stressPattern
                      ? row.stressPattern.split("").map((ch, i) =>
                          ch === "/" ? <span key={i} className="meter-beat meter-beat-s" /> :
                          ch === "x" ? <span key={i} className="meter-beat meter-beat-u" /> :
                          <span key={i} className="meter-beat-gap" />
                        )
                      : <span className="meter-bar-empty">—</span>
                    }
                  </span>
                  {fit != null ? (
                    <span className={`meter-bar-fit ${fitClass}`}>{fit}%</span>
                  ) : (
                    <span className="meter-bar-fit meter-fit-none">—</span>
                  )}
                  <span className="meter-bar-src" title={meterStressSourceHint(row.stressSource)}>
                    {meterStressSourceMark(row.stressSource)}
                  </span>
                </li>
              );
            })}
          </ul>

          {meterHints.length > METER_TABLE_MAX ? (
            <p className="muted small">Showing first {METER_TABLE_MAX} of {meterHints.length} lines.</p>
          ) : null}
        </div>
      ) : null}

      {toolTab === "rhyme" ? (
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
      ) : null}

      {toolTab === "repeat" ? (
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
          <RepetitionSummary counts={repetitionCounts} />
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
              <p className="muted small">No words match this filter.</p>
            ) : (
              <ul className="rep-card-list">
                {filteredRepeated.map((r) => (
                  <RepeatedWordCard
                    key={r.word}
                    item={r}
                    goToLine={goToLine}
                  />
                ))}
              </ul>
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
      ) : null}

      {toolTab === "spell" ? (
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
                        {g.suggestions.length > 0 ? (
                          <div className="spell-suggestion-actions">
                            {g.suggestions.slice(0, 2).map((sug) => (
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
                          </div>
                        ) : null}
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
      ) : null}

      {toolTab === "snapshots" ? (
        <div
          className="tool-block tool-block-snapshots"
          id="tool-panel-snapshots"
          role="tabpanel"
          aria-labelledby="tool-tab-snapshots"
        >
          <RevisionCompareSection
            embedInTools
            revisions={revisions}
            snapshotLabel={snapshotLabel}
            onSnapshotLabelChange={onSnapshotLabelChange}
            onSaveSnapshot={onSaveSnapshot}
            snapshotFlash={snapshotFlash}
            onRestoreRevision={onRestoreRevision}
            onDeleteRevision={onDeleteRevision}
            onDeleteDuplicates={onDeleteDuplicateRevisions}
            duplicateCount={duplicateRevisionCount}
            onDiffSnapshot={onDiffSnapshot}
            activeDiffSnapshotId={activeDiffSnapshotId}
            compareLeftId={compareLeftId}
            compareRightId={compareRightId}
            onCompareLeftChange={onCompareLeftChange}
            onCompareRightChange={onCompareRightChange}
            compareViewMode={compareViewMode}
            onCompareViewModeChange={onCompareViewModeChange}
            compareSnapshotOptions={compareSnapshotOptions}
            compareLeftBody={compareLeftBody}
            compareRightBody={compareRightBody}
            compareDiffRows={compareDiffRows}
          />
        </div>
      ) : null}

      {toolTab === "suggest" ? (
        <div
          className="tool-block"
          id="tool-panel-suggest"
          role="tabpanel"
          aria-labelledby="tool-tab-suggest"
        >
          <StuckHelper title={poemTitle} lines={poemLines} onInsert={onInsertSuggestion} onReplaceLine={onReplaceLine} />
        </div>
      ) : null}

    </div>
  );
}
