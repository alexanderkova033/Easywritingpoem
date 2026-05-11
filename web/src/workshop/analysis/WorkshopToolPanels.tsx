import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SpellMode } from "@/workshop/library/local-draft-storage";
import type { SpellHit } from "@/spellcheck/scan";
import type { WorkshopGoals } from "@/workshop/library/workshop-goals";
import { FORM_PRESETS } from "@/workshop/library/workshop-goals";
import type { GoalEvaluation } from "@/workshop/analysis/goal-metrics";
import type { DocumentStats } from "@/workshop/analysis/line-stats";
import type { ChecklistItem } from "@/workshop/analysis/publication-checklist";
import type { RhymeCluster } from "@/workshop/analysis/rhyme-hints";
import type { StanzaClusterGroup } from "@/workshop/rhyme/hints";
import type { RepeatedWord } from "@/workshop/analysis/repeated-words";
import type { RevisionSnapshot } from "@/workshop/library/revision-snapshots";
import type { LineDiffRow } from "@/workshop/library/diff-lines";
import type {
  LineMeterHint,
  LineStressSource,
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

const LINES_TABLE_MAX = 400;
const METER_TABLE_MAX = 400;

function meterStressSourceMark(s: LineStressSource): string {
  if (s === "lexicon") return "✓";
  if (s === "mixed") return "~";
  return "—";
}

function meterStressSourceHint(s: LineStressSource): string {
  if (s === "lexicon") return "Stress from CMU dictionary for this line";
  if (s === "mixed") return "Mixed dictionary + heuristic stress";
  return "Heuristic stress (word not in CMU list or invented)";
}

function NoLinesYetHint() {
  return (
    <p className="tool-no-lines-hint muted small" role="status">
      Add a line with text in the poem body to see live stats and pattern tools
      here. Blank-only lines don&apos;t count.
    </p>
  );
}

function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="tool-empty" role="status" aria-live="polite">
      <p className="tool-empty-title">{title}</p>
      <div className="tool-empty-body">{children}</div>
    </div>
  );
}

function GoalCard({
  label,
  current,
  target,
  onSet,
  hint,
  extra,
  soft,
  onToggleSoft,
  isCap = false,
}: {
  label: string;
  current: number | null;
  target: number | undefined;
  onSet: (v: number | undefined) => void;
  hint?: string;
  extra?: ReactNode;
  soft?: boolean;
  onToggleSoft?: () => void;
  isCap?: boolean;
}) {
  const [inputVal, setInputVal] = useState(target != null ? String(target) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputVal(target != null ? String(target) : "");
  }, [target]);

  const hasGoal = target != null;
  const hasCurrent = current !== null && current >= 0;
  const met = isCap
    ? hasGoal && hasCurrent && (current as number) === 0
    : hasGoal && hasCurrent && current === target;
  const over = isCap
    ? hasGoal && hasCurrent && (current as number) > 0
    : hasGoal && hasCurrent && current! > target!;
  const pct = !isCap && hasGoal && hasCurrent && target! > 0
    ? Math.min(1, (current as number) / target!)
    : null;
  const statusClass = met ? "goal-card--met" : over ? "goal-card--over" : "";

  function commitInput(raw: string) {
    const n = parseInt(raw, 10);
    onSet(Number.isFinite(n) && n >= 1 ? n : undefined);
  }
  function step(delta: number) {
    const base = target ?? (hasCurrent && (current as number) > 0 ? (current as number) : 1);
    onSet(Math.max(1, base + delta));
  }

  return (
    <div
      className={`goal-card${isCap ? " goal-card--cap" : ""}${soft ? " goal-card--soft" : ""} ${statusClass}${hasGoal ? "" : " goal-card--unset"}`}
      title={hint}
    >
      <div className="goal-card-header">
        <span className="goal-card-label">{label}</span>
        <div className="goal-card-actions">
          {onToggleSoft && (
            <button
              type="button"
              className={`goal-card-soft-btn${soft ? " goal-card-soft-btn--soft" : ""}`}
              onClick={onToggleSoft}
              title={soft ? "Aspirational — click to make required" : "Required — click to make aspirational"}
              aria-label={soft ? `${label}: aspirational` : `${label}: required`}
            >
              {soft ? "◇" : "◆"}
            </button>
          )}
          {hasGoal && (
            <button
              type="button"
              className="goal-card-clear"
              onClick={() => onSet(undefined)}
              aria-label={`Clear ${label} goal`}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="goal-card-value-row">
        <span className={`goal-card-current${!hasCurrent ? " goal-card-current--empty" : ""}`}>
          {hasCurrent ? current : "—"}
        </span>
        {hasGoal && (
          <span className={`goal-card-of${met ? " goal-card-of--met" : over ? " goal-card-of--over" : ""}`}>
            /{target}
          </span>
        )}
      </div>

      <div className="goal-card-controls">
        <button type="button" className="goal-card-step" onClick={() => step(-1)} aria-label={`Decrease ${label} target`}>−</button>
        <input
          ref={inputRef}
          type="number"
          className="goal-card-input"
          min={1}
          inputMode="numeric"
          value={inputVal}
          placeholder="—"
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={(e) => commitInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { commitInput(inputVal); inputRef.current?.blur(); }
          }}
          aria-label={`${label} target`}
        />
        <button type="button" className="goal-card-step" onClick={() => step(1)} aria-label={`Increase ${label} target`}>+</button>
      </div>

      {extra}

      {pct !== null && (
        <div className="goal-card-bar" aria-hidden>
          <div
            className={`goal-card-bar-fill${met ? " goal-card-bar--met" : over ? " goal-card-bar--over" : ""}`}
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function checklistJumpLabel(item: ChecklistItem): string {
  if (item.focusTitleField) return "Focus title";
  switch (item.openToolTab) {
    case "lines":
      return "Lines";
    case "spell":
      return "Spelling";
    case "goals":
      return "Goals";
    default:
      return "Open";
  }
}

function endWordOfLine(line: string | undefined): string {
  if (!line) return "";
  const m = line.match(/[a-zA-Z']+(?=[^a-zA-Z']*$)/);
  return m ? m[0] : "";
}

function JumpLineList({
  lineNumbers,
  goToLine,
}: {
  lineNumbers: number[];
  goToLine: (line1Based: number) => void;
}) {
  return (
    <>
      {lineNumbers.map((n, i) => (
        <span key={`${n}-${i}`}>
          {i > 0 ? ", " : null}
          <button
            type="button"
            className="linkish line-jump-inline"
            onClick={() => goToLine(n)}
          >
            {n}
          </button>
        </span>
      ))}
    </>
  );
}

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
  spellBump: number;
  refreshSpell: () => void;
  onSpellPersistenceError: (message: string) => void;
  updateGoal: (
    key: keyof WorkshopGoals,
  ) => (e: ChangeEvent<HTMLInputElement>) => void;
  setGoalValue: (key: keyof WorkshopGoals, value: number | undefined) => void;
  toggleGoalSoft: (key: string) => void;
  applyGoalPreset: (presetKey: string | null) => void;
  revisions: RevisionSnapshot[];
  snapshotLabel: string;
  onSnapshotLabelChange: (v: string) => void;
  onSaveSnapshot: () => void;
  snapshotFlash: boolean;
  onRestoreRevision: (snap: RevisionSnapshot) => void;
  onDeleteRevision: (id: string) => void;
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
    spellHits,
    wordlist,
    wordlistErr,
    spellMode,
    onSpellModeChange,
    goToLine,
    goToLineEnd,
    goToSpellHitAt,
    cycleSpellHit,
    spellNavIndex,
    applySpellSuggestion,
    spellBump,
    refreshSpell,
    onSpellPersistenceError,
    setGoalValue,
    toggleGoalSoft,
    applyGoalPreset,
    revisions,
    snapshotLabel,
    onSnapshotLabelChange,
    onSaveSnapshot,
    snapshotFlash,
    onRestoreRevision,
    onDeleteRevision,
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
  const { ignoreCluster, isIgnored } = useIgnoredRhymes();

  // Auto-resolve when two end-words are selected:
  //   • different clusters (or one loose) → link them as a rhyme
  //   • same cluster → split them apart (unlink)
  // The opposite-direction record is removed so the same pair can never
  // appear in both lists at once.
  useEffect(() => {
    if (rhymeLinkSelection.length < 2) return;
    const [a, b] = rhymeLinkSelection;
    if (a && b && a.word.toLowerCase() !== b.word.toLowerCase()) {
      const sameCluster = a.label !== null && a.label === b.label;
      const sorted = [a.word.toLowerCase().trim(), b.word.toLowerCase().trim()].sort();
      const conflictKey = `${sorted[0]}+${sorted[1]}`;
      if (sameCluster) {
        onRemoveManualRhymeLink?.(conflictKey);
        onAddManualRhymeUnlink?.(a.word, b.word);
      } else {
        onRemoveManualRhymeUnlink?.(conflictKey);
        onAddManualRhymeLink?.(a.word, b.word);
      }
    }
    setRhymeLinkSelection([]);
  }, [rhymeLinkSelection, onAddManualRhymeLink, onAddManualRhymeUnlink, onRemoveManualRhymeLink, onRemoveManualRhymeUnlink]);

  const toggleRhymeSelection = (word: string, line: number, label: string | null) => {
    setRhymeLinkSelection((prev) => {
      const i = prev.findIndex((p) => p.line === line);
      if (i >= 0) return prev.filter((_, idx) => idx !== i);
      return [...prev, { word, line, label }].slice(-2);
    });
  };
  const [repeatWordFilter, setRepeatWordFilter] = useState("");
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

  const filteredRepeated = useMemo(() => {
    const t = repeatWordFilter.trim().toLowerCase();
    if (!t) return repeated;
    return repeated.filter((r) => r.word.toLowerCase().includes(t));
  }, [repeated, repeatWordFilter]);

  const displayedLineRows = useMemo(() => {
    if (!hideEmptyLines) return docStats.lines;
    return docStats.lines.filter((r) => r.text.trim().length > 0);
  }, [docStats.lines, hideEmptyLines]);

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
  const issuesAllClear =
    openChecklistItems.length === 0 &&
    goalEvaluation.warnings.length === 0 &&
    (!wordlist || spellHits.length === 0) &&
    clicheHits.length === 0;

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
          {issuesAllClear ? (
            <EmptyState title="All clear — keep writing.">
              <p className="muted small">
                Checklist, goals, and spelling are all satisfied. Issues appear
                here as you draft.
              </p>
            </EmptyState>
          ) : (
            <>
              {openChecklistItems.length > 0 ? (
                <>
                  <h4 className="tool-subheading">Publication checklist</h4>
                  <ul
                    className="checklist checklist-draft"
                    aria-label="Open checklist items"
                  >
                    {openChecklistItems.map((item) => (
                      <li
                        key={item.text}
                        className="checklist-item open checklist-item-needs-attn"
                      >
                        <span className="checklist-mark" aria-hidden>
                          ○
                        </span>
                        <span className="checklist-text">
                          {item.text}
                          {item.detail ? (
                            <span className="checklist-detail">
                              {" "}
                              — {item.detail}
                            </span>
                          ) : null}
                        </span>
                        {item.focusTitleField || item.openToolTab ? (
                          <button
                            type="button"
                            className="small-btn checklist-jump-btn"
                            onClick={() =>
                              item.focusTitleField
                                ? focusPoemTitle()
                                : onOpenToolTab(item.openToolTab!)
                            }
                          >
                            {checklistJumpLabel(item)}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {goalEvaluation.warnings.length > 0 ? (
                <>
                  <h4 className="tool-subheading">Goals</h4>
                  <ul className="goal-warnings">
                    {goalEvaluation.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  <p className="muted small goal-syllable-jumps">
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => onOpenToolTab("goals")}
                    >
                      Open Goals
                    </button>
                    {goalEvaluation.syllableOverLines.length > 0 ? (
                      <>
                        {" "}
                        · Lines over syllable cap:{" "}
                        <JumpLineList
                          lineNumbers={goalEvaluation.syllableOverLines}
                          goToLine={goToLine}
                        />
                      </>
                    ) : null}
                  </p>
                </>
              ) : null}
              {!wordlist ? (
                <p className="muted small" aria-busy="true">
                  Dictionary loading — spelling flags will appear here when
                  ready.
                </p>
              ) : spellHits.length > 0 ? (
                <>
                  <h4 className="tool-subheading">Spelling</h4>
                  <p className="muted small">
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => onOpenToolTab("spell")}
                    >
                      Open Spelling
                    </button>{" "}
                    for the full list and dictionary actions.
                  </p>
                  <ul className="spell-hits spell-hits-draft issues-spell-preview">
                    {spellHits.slice(0, 12).map((h) => (
                      <li key={`${h.docFrom}-${h.docTo}`}>
                        <div className="spell-hit-head">
                          <button
                            type="button"
                            className="linkish"
                            onClick={() => goToSpellHitAt(h)}
                          >
                            Line {h.lineNumber}
                          </button>
                          <span className="mono">{h.word}</span>
                        </div>
                        {h.suggestions.length > 0 ? (
                          <p className="suggestions">
                            Try: {h.suggestions.join(", ")}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {spellHits.length > 12 ? (
                    <p className="muted small">
                      +{spellHits.length - 12} more in{" "}
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenToolTab("spell")}
                      >
                        Spelling
                      </button>
                      .
                    </p>
                  ) : null}
                </>
              ) : null}
              {clicheHits.length > 0 ? (
                <>
                  <h4 className="tool-subheading">Possible clichés</h4>
                  <p className="muted small">
                    Common phrases that may weaken your poem's originality.
                  </p>
                  <ul className="cliche-list">
                    {clicheHits.map((h, i) => (
                      <li key={i} className="cliche-hit">
                        <button
                          type="button"
                          className="linkish cliche-line-btn"
                          onClick={() => goToLine(h.lineNumber)}
                        >
                          Line {h.lineNumber}
                        </button>
                        <span className="cliche-phrase mono">&ldquo;{h.phrase}&rdquo;</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
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

          <div className="goal-presets" role="group" aria-label="Form presets">
            {FORM_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`goal-preset-chip${goals.preset === p.key ? " goal-preset-chip--active" : ""}`}
                title={p.description}
                onClick={() =>
                  goals.preset === p.key
                    ? applyGoalPreset(null)
                    : applyGoalPreset(p.key)
                }
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="goal-cards">
            <GoalCard
              label="Lines"
              current={docStats.nonEmptyLines}
              target={goals.targetLines}
              onSet={(v) => setGoalValue("targetLines", v)}
              soft={goals.softGoals?.includes("targetLines")}
              onToggleSoft={() => toggleGoalSoft("targetLines")}
            />
            <GoalCard
              label="Stanzas"
              current={docStats.stanzaCount}
              target={goals.targetStanzas}
              onSet={(v) => setGoalValue("targetStanzas", v)}
              hint="Stanzas are blocks of lines separated by blank lines"
              soft={goals.softGoals?.includes("targetStanzas")}
              onToggleSoft={() => toggleGoalSoft("targetStanzas")}
            />
            <GoalCard
              label="Words"
              current={docStats.totalWords}
              target={goals.targetWords}
              onSet={(v) => setGoalValue("targetWords", v)}
              soft={goals.softGoals?.includes("targetWords")}
              onToggleSoft={() => toggleGoalSoft("targetWords")}
            />
            <GoalCard
              label="Syllable cap"
              current={goals.maxSyllablesPerLine != null ? goalEvaluation.syllableOverLines.length : null}
              target={goals.maxSyllablesPerLine}
              onSet={(v) => setGoalValue("maxSyllablesPerLine", v)}
              isCap={true}
              hint="Flag lines whose estimated syllable count exceeds this"
              soft={goals.softGoals?.includes("maxSyllablesPerLine")}
              onToggleSoft={() => toggleGoalSoft("maxSyllablesPerLine")}
              extra={
                goalEvaluation.syllableOverLines.length > 0 ? (
                  <p className="goal-card-extra">
                    Lines over cap:{" "}
                    <JumpLineList
                      lineNumbers={goalEvaluation.syllableOverLines}
                      goToLine={goToLine}
                    />
                  </p>
                ) : goals.maxSyllablesPerLine != null ? (
                  <p className="goal-card-extra goal-card-extra--ok">✓ No lines over cap</p>
                ) : null
              }
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
          Object.values(goals).some((v) => v != null) ? (
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
                  <th scope="col">
                    <abbr title="Estimated syllables (heuristic)">Syll.</abbr>
                  </th>
                  <th scope="col">Words</th>
                  <th scope="col">Chars</th>
                </tr>
              </thead>
              <tbody>
                {displayedLineRows.slice(0, LINES_TABLE_MAX).map((row) => (
                  <tr
                    key={row.lineNumber}
                    className="line-table-data-row line-table-row-jump"
                    tabIndex={0}
                    aria-label={`Line ${row.lineNumber}: ${row.syllables} syllables, ${row.words} words. Open in editor.`}
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
                    <td className="line-table-metric">{row.syllables}</td>
                    <td className="line-table-metric">{row.words}</td>
                    <td className="line-table-metric">{row.chars}</td>
                  </tr>
                ))}
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
                  ? "Pick two end-words: same group splits them apart, different groups (or unlinked) links them as a rhyme."
                  : "Lines whose end-words rhyme — click a word to jump to it."}
              </p>
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
              // Start from scheme-derived clusters, drop ignored ones.
              const baseClusters = group.clusters.filter((c) => {
                const words = c.lineNumbers.map((n) => endWordOfLine(poemLines[n - 1]));
                return !isIgnored(words);
              });

              // Defensive merge: even if the scheme didn't fold a manual link
              // into the labels (timing/edge case), enforce it visually here.
              type Cluster = {
                ending: string;
                label: string | null;
                lineNumbers: number[];
                manual?: boolean;
              };
              const working: Cluster[] = baseClusters.map((c) => ({
                ending: c.ending,
                label: c.label ?? null,
                lineNumbers: [...c.lineNumbers],
              }));

              const wordsInStanzaByLine = new Map<number, string>();
              for (let n = group.lineRange[0]; n <= group.lineRange[1]; n++) {
                const w = endWordOfLine(poemLines[n - 1]).toLowerCase();
                if (w) wordsInStanzaByLine.set(n, w);
              }

              const findClusterIdxByLine = (line: number): number => {
                for (let i = 0; i < working.length; i++) if (working[i]!.lineNumbers.includes(line)) return i;
                return -1;
              };

              for (const key of manualRhymeLinks) {
                const parts = key.split("+");
                if (parts.length !== 2) continue;
                const [a, b] = parts as [string, string];
                const linesA: number[] = [];
                const linesB: number[] = [];
                for (const [n, w] of wordsInStanzaByLine) {
                  if (w === a) linesA.push(n);
                  else if (w === b) linesB.push(n);
                }
                if (linesA.length === 0 || linesB.length === 0) continue;

                const involved = [...linesA, ...linesB];
                const targetIdxs = new Set<number>();
                let firstIdx = -1;
                for (const n of involved) {
                  const idx = findClusterIdxByLine(n);
                  if (idx >= 0) {
                    if (firstIdx < 0) firstIdx = idx;
                    targetIdxs.add(idx);
                  }
                }
                if (firstIdx < 0) {
                  working.push({
                    ending: key,
                    label: null,
                    lineNumbers: [...new Set(involved)].sort((x, y) => x - y),
                    manual: true,
                  });
                  continue;
                }
                const target = working[firstIdx]!;
                for (const idx of targetIdxs) {
                  if (idx === firstIdx) continue;
                  for (const n of working[idx]!.lineNumbers) target.lineNumbers.push(n);
                }
                for (const n of involved) if (!target.lineNumbers.includes(n)) target.lineNumbers.push(n);
                target.lineNumbers = [...new Set(target.lineNumbers)].sort((x, y) => x - y);
                target.manual = target.manual || target.label === null;
                // Remove merged clusters (in reverse order to keep indices stable).
                const removeIdxs = [...targetIdxs].filter((i) => i !== firstIdx).sort((x, y) => y - x);
                for (const i of removeIdxs) working.splice(i, 1);
              }

              // Assign synthetic letters to any clusters left without one (rare —
              // happens when a manual link involves words whose original
              // ending didn't match anything in the scheme).
              const usedLabels = new Set(working.map((c) => c.label).filter(Boolean) as string[]);
              const cycle = "ABCDEFGHIJKLMN";
              let nextIdx = 0;
              for (const c of working) {
                if (c.label) continue;
                while (usedLabels.has(cycle[nextIdx % cycle.length]!)) nextIdx++;
                c.label = cycle[nextIdx % cycle.length]!;
                usedLabels.add(c.label);
                nextIdx++;
              }

              const visibleClusters = working;

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
              <div className="rhyme-manual-links">
                <div className="rhyme-manual-links-head">
                  <span className="rhyme-stanza-label">Linked as rhymes</span>
                  <span className="muted small">{manualRhymeLinks.length} pair{manualRhymeLinks.length === 1 ? "" : "s"}</span>
                </div>
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
              </div>
            ) : null}

            {manualRhymeUnlinks.length > 0 ? (
              <div className="rhyme-manual-links rhyme-manual-unlinks">
                <div className="rhyme-manual-links-head">
                  <span className="rhyme-stanza-label">Split apart</span>
                  <span className="muted small">{manualRhymeUnlinks.length} pair{manualRhymeUnlinks.length === 1 ? "" : "s"}</span>
                </div>
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
          <LiveSectionTitle>Repeated words</LiveSectionTitle>
          {docStats.nonEmptyLines === 0 ? <NoLinesYetHint /> : null}
          {heavyToolsStale ? (
            <p
              className="tools-stale-hint muted small"
              role="status"
              aria-live="polite"
            >
              Tools updating… (repeats match your text in a moment)
            </p>
          ) : null}
          <label className="tool-filter-field">
            <span className="tool-filter-label">Filter words</span>
            <input
              type="search"
              value={repeatWordFilter}
              onChange={(e) => setRepeatWordFilter(e.target.value)}
              placeholder="Substring"
              aria-label="Filter repeated words"
            />
          </label>
          {repeated.length === 0 ? (
            <EmptyState title="No repeats detected">
              <p className="muted small">
                Nice—this list stays empty unless a non-stopword repeats.
              </p>
            </EmptyState>
          ) : filteredRepeated.length === 0 ? (
            <p className="muted small">No words match this filter.</p>
          ) : (
            <ul className="hint-list hint-list-draft">
              {filteredRepeated.map((r) => (
                <li key={r.word}>
                  <span className="mono">{r.word}</span> ×{r.count} — lines{" "}
                  <JumpLineList lineNumbers={r.lines} goToLine={goToLine} />
                </li>
              ))}
            </ul>
          )}
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
          {heavyToolsStale ? (
            <p
              className="tools-stale-hint muted small"
              role="status"
              aria-live="polite"
            >
              Updating…
            </p>
          ) : null}
          <div
            className="spell-strategy-toggle"
            role="group"
            aria-label="How strictly to flag unknown words"
          >
            <button
              type="button"
              className={`segment-btn spell-strategy-btn ${spellMode === "permissive" ? "active" : ""}`}
              aria-pressed={spellMode === "permissive"}
              onClick={() => onSpellModeChange("permissive")}
            >
              <span className="spell-strategy-title">Poetry-friendly</span>
              <span className="spell-strategy-sub">Fewer flags</span>
            </button>
            <button
              type="button"
              className={`segment-btn spell-strategy-btn ${spellMode === "strict" ? "active" : ""}`}
              aria-pressed={spellMode === "strict"}
              onClick={() => onSpellModeChange("strict")}
            >
              <span className="spell-strategy-title">Strict</span>
              <span className="spell-strategy-sub">More flags</span>
            </button>
          </div>
          {wordlistErr ? (
            <p className="error compact" role="alert">
              {wordlistErr}
            </p>
          ) : !wordlist ? (
            <div
              className="spell-loading-skeleton"
              aria-busy="true"
              aria-label="Loading dictionary"
            >
              <div className="spell-skeleton-line spell-skeleton-line-long" />
              <div className="spell-skeleton-line spell-skeleton-line-mid" />
              <div className="spell-skeleton-line spell-skeleton-line-short" />
            </div>
          ) : (
            <>
              <details className="tool-hint-details personal-dict-details">
                <summary className="tool-hint-summary">
                  Personal dictionary ({personalWords.length})
                </summary>
                <p className="muted small tool-hint-body">
                  Words you add with <strong>Add word</strong> are saved in this
                  browser only.
                </p>
                {personalWords.length === 0 ? (
                  <p className="muted small">No words yet.</p>
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
                      Export JSON
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
                    Import JSON
                  </button>
                </div>
              </details>
              {spellHits.length === 0 ? (
                <EmptyState title="No spelling flags">
                  <p className="muted small">
                    Looks clean under your current mode. Switch modes if you want a
                    stricter scan.
                  </p>
                </EmptyState>
              ) : (
                <>
                  <div className="spell-hit-nav" role="group" aria-label="Step through spelling flags">
                    <button
                      type="button"
                      className="small-btn"
                      onClick={() => cycleSpellHit(-1)}
                    >
                      ← Previous
                    </button>
                    <span className="spell-hit-nav-pos" aria-live="polite">
                      {spellNavIndex + 1} / {spellHits.length}
                    </span>
                    <button
                      type="button"
                      className="small-btn"
                      onClick={() => cycleSpellHit(1)}
                    >
                      Next →
                    </button>
                  </div>
                  <p className="muted small spell-hotkey-hint">
                    <kbd className="kbd-hint">Ctrl</kbd> +{" "}
                    <kbd className="kbd-hint">Alt</kbd> +{" "}
                    <kbd className="kbd-hint">,</kbd> /{" "}
                    <kbd className="kbd-hint">.</kbd> cycles flags whenever there
                    are any (not while typing in the poem or another field).
                  </p>
                  {spellReplaceErr ? (
                    <p className="error compact" role="alert">
                      {spellReplaceErr}
                    </p>
                  ) : null}
                <ul className="spell-hits spell-hits-draft">
                  {spellHits.slice(0, spellListCap).map((h) => (
                    <li key={`${h.docFrom}-${h.docTo}`}>
                      <div className="spell-hit-head">
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => goToSpellHitAt(h)}
                        >
                          Line {h.lineNumber}
                        </button>
                        <span className="mono">{h.word}</span>
                      </div>
                      {h.suggestions.length > 0 ? (
                        <div className="spell-suggestion-actions">
                          {h.suggestions.slice(0, 3).map((sug) => (
                            <button
                              key={sug}
                              type="button"
                              className="small-btn"
                              disabled={heavyToolsStale}
                              title={
                                heavyToolsStale
                                  ? "Pause typing so the list matches the editor"
                                  : `Replace with “${sug}”`
                              }
                              onClick={() => {
                                setSpellReplaceErr(null);
                                if (!applySpellSuggestion(h, sug)) {
                                  setSpellReplaceErr(
                                    "Could not replace — wait until tools match your draft (pause typing), then try again.",
                                  );
                                  return;
                                }
                                refreshSpell();
                              }}
                            >
                              Use “{sug}”
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div className="spell-actions">
                        <button
                          type="button"
                          className="small-btn"
                          onClick={() => {
                            if (!addToPersonalDictionary(h.normalized)) {
                              onSpellPersistenceError(
                                "Could not save that word to your dictionary (browser storage blocked or full).",
                              );
                              return;
                            }
                            refreshSpell();
                          }}
                        >
                          Add word
                        </button>
                        <button
                          type="button"
                          className="small-btn"
                          onClick={() => {
                            if (!ignoreWordForSession(h.normalized)) {
                              onSpellPersistenceError(
                                "Could not update session spelling skips.",
                              );
                              return;
                            }
                            refreshSpell();
                          }}
                        >
                          Skip (session)
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {spellHits.length > spellListCap ? (
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
