import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SpellMode } from "@/workshop/library/local-draft-storage";
import type { SpellHit } from "@/spellcheck/scan";
import type { WorkshopGoals } from "@/workshop/library/workshop-goals";
import type { GoalEvaluation } from "@/workshop/analysis/goal-metrics";
import type { DocumentStats } from "@/workshop/analysis/line-stats";
import type { ChecklistItem } from "@/workshop/analysis/publication-checklist";
import type { RhymeCluster } from "@/workshop/analysis/rhyme-hints";
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
import { StuckHelper } from "./StuckHelper";
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

const ARC_R = 36;
const ARC_CX = 50;
const ARC_CY = 54;
const ARC_C = 2 * Math.PI * ARC_R;
const ARC_SPAN = 0.75 * ARC_C; // 270°

function GoalCard({
  label,
  icon,
  current,
  target,
  onSet,
  hint,
  extra,
  variant = "arc",
}: {
  label: string;
  icon: string;
  current: number | null;
  target: number | undefined;
  onSet: (v: number | undefined) => void;
  hint?: string;
  extra?: ReactNode;
  variant?: "arc" | "cap";
}) {
  const [inputVal, setInputVal] = useState(target != null ? String(target) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputVal(target != null ? String(target) : "");
  }, [target]);

  const hasGoal = target != null;
  const hasCurrent = current !== null && current >= 0;

  const met = hasGoal && hasCurrent && current === target;
  const over = hasGoal && hasCurrent && current > target;
  const under = hasGoal && hasCurrent && current < target;
  const pct =
    hasGoal && hasCurrent && target > 0 ? Math.min(1, current / target) : null;

  let statusClass =
    met ? "goal-card--met" : over ? "goal-card--over" : under ? "goal-card--under" : "";

  if (variant === "cap") {
    statusClass =
      hasGoal && hasCurrent
        ? current === 0
          ? "goal-card--met"
          : "goal-card--over"
        : "";
  }

  function commitInput(raw: string) {
    const n = parseInt(raw, 10);
    onSet(Number.isFinite(n) && n >= 1 ? n : undefined);
  }

  function step(delta: number) {
    const base = target ?? (hasCurrent && current! > 0 ? current! : 1);
    const next = Math.max(1, base + delta);
    onSet(next);
  }

  const controls = (
    <div className="goal-card-controls">
      <button
        type="button"
        className="goal-card-step"
        onClick={() => step(-1)}
        aria-label={`Decrease ${label} target`}
      >
        −
      </button>
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
          if (e.key === "Enter") {
            commitInput(inputVal);
            inputRef.current?.blur();
          }
        }}
        aria-label={`${label} target`}
      />
      <button
        type="button"
        className="goal-card-step"
        onClick={() => step(1)}
        aria-label={`Increase ${label} target`}
      >
        +
      </button>
    </div>
  );

  if (variant === "cap") {
    return (
      <div
        className={`goal-card goal-card--cap ${statusClass}${hasGoal ? "" : " goal-card--unset"}`}
        title={hint}
      >
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
        <span className="goal-card-icon" aria-hidden>
          {icon}
        </span>
        <div className="goal-card-cap-info">
          <span className="goal-card-label">{label}</span>
          <span className="goal-card-cap-value">{hasGoal ? target : "—"}</span>
        </div>
        {extra && <div className="goal-card-extra-wrap">{extra}</div>}
        {controls}
      </div>
    );
  }

  const fillArc = pct != null ? Math.min(1, Math.max(0, pct)) * ARC_SPAN : 0;

  return (
    <div
      className={`goal-card ${statusClass}${hasGoal ? "" : " goal-card--unset"}`}
      title={hint}
    >
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
      <svg viewBox="0 0 100 90" className="goal-arc-svg" aria-hidden>
        <circle
          cx={ARC_CX}
          cy={ARC_CY}
          r={ARC_R}
          fill="none"
          className="goal-arc-track"
          strokeDasharray={`${ARC_SPAN} ${ARC_C}`}
          strokeLinecap="round"
        />
        {pct != null && (
          <circle
            cx={ARC_CX}
            cy={ARC_CY}
            r={ARC_R}
            fill="none"
            className={`goal-arc-fill${statusClass ? " " + statusClass : ""}`}
            strokeDasharray={`${fillArc} ${ARC_C}`}
            strokeLinecap="round"
          />
        )}
        <text
          x={ARC_CX}
          y={ARC_CY - 1}
          textAnchor="middle"
          dominantBaseline="central"
          className={`goal-arc-value${!hasCurrent ? " goal-arc-value--empty" : ""}`}
        >
          {hasCurrent ? current : "—"}
        </text>
        <text
          x={ARC_CX}
          y="78"
          textAnchor="middle"
          dominantBaseline="central"
          className="goal-arc-label-text"
        >
          {label}
        </text>
        {hasGoal && (
          <text
            x={ARC_CX}
            y="88"
            textAnchor="middle"
            dominantBaseline="central"
            className={`goal-arc-target-text${met ? " goal-arc--met" : over ? " goal-arc--over" : ""}`}
          >
            {met ? "✓" : over ? "▲" : "/"} {target}
          </text>
        )}
      </svg>
      {controls}
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
  clicheHits: ClicheHit[];
  repeated: RepeatedWord[];
  spellHits: SpellHit[];
  wordlist: Set<string> | null;
  wordlistErr: string | null;
  spellMode: SpellMode;
  onSpellModeChange: (mode: SpellMode) => void;
  goToLine: (line1Based: number) => void;
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
  revisions: RevisionSnapshot[];
  snapshotLabel: string;
  onSnapshotLabelChange: (v: string) => void;
  onSaveSnapshot: () => void;
  snapshotFlash: boolean;
  onRestoreRevision: (snap: RevisionSnapshot) => void;
  onDeleteRevision: (id: string) => void;
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
  onReplaceLine?: (lineNum: number, text: string) => void;
  rhymeBreadth: RhymeBreadth;
  onRhymeBreadthChange: (b: RhymeBreadth) => void;
}

export function WorkshopToolPanels(props: WorkshopToolPanelsProps) {
  const {
    toolTab,
    docStats,
    meterHints,
    goals,
    goalEvaluation,
    publication,
    rhymeClusters,
    vowelTailClusters,
    assonanceClusters,
    consonanceClusters,
    clicheHits,
    repeated,
    spellHits,
    wordlist,
    wordlistErr,
    spellMode,
    onSpellModeChange,
    goToLine,
    goToSpellHitAt,
    cycleSpellHit,
    spellNavIndex,
    applySpellSuggestion,
    spellBump,
    refreshSpell,
    onSpellPersistenceError,
    setGoalValue,
    revisions,
    snapshotLabel,
    onSnapshotLabelChange,
    onSaveSnapshot,
    snapshotFlash,
    onRestoreRevision,
    onDeleteRevision,
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
    onReplaceLine,
    rhymeBreadth,
    onRhymeBreadthChange,
  } = props;

  const [hideEmptyLines, setHideEmptyLines] = useState(false);
  const [rhymeVisibleCap, setRhymeVisibleCap] = useState(10);
  const [spellListCap, setSpellListCap] = useState(50);
  const [spellReplaceErr, setSpellReplaceErr] = useState<string | null>(null);
  const dictImportInputRef = useRef<HTMLInputElement | null>(null);
  const [meterHideBlank, setMeterHideBlank] = useState(true);
  const [meterOnlyLowFit, setMeterOnlyLowFit] = useState(false);
  const [meterLowFitThreshold, setMeterLowFitThreshold] = useState(60);
  const [meterOnlyHeuristic, setMeterOnlyHeuristic] = useState(false);
  const [rhymeEndingFilter, setRhymeEndingFilter] = useState("");
  const [repeatWordFilter, setRepeatWordFilter] = useState("");
  const [goLineField, setGoLineField] = useState("");

  useEffect(() => {
    if (toolTab !== "spell") setSpellReplaceErr(null);
  }, [toolTab]);

  useEffect(() => {
    setRhymeVisibleCap(10);
  }, [
    rhymeClusters,
    vowelTailClusters,
    assonanceClusters,
    consonanceClusters,
    rhymeEndingFilter,
  ]);

  useEffect(() => {
    setSpellListCap(50);
  }, [spellHits, spellMode]);

  const personalWords = useMemo(
    () => listPersonalDictionaryWords(),
    [spellHits, spellBump],
  );

  const filterEndingClusters = useCallback((clusters: RhymeCluster[]) => {
    const t = rhymeEndingFilter.trim().toLowerCase();
    if (!t) return clusters;
    return clusters.filter((c) => c.ending.toLowerCase().includes(t));
  }, [rhymeEndingFilter]);

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

  const rhymeFilteredRhyme = filterEndingClusters(rhymeClusters);
  const rhymeFilteredVowel = filterEndingClusters(vowelTailClusters);
  const rhymeFilteredAsson = filterEndingClusters(assonanceClusters);
  const rhymeFilteredCons = filterEndingClusters(consonanceClusters);
  const rhymeAnyOverCap =
    rhymeFilteredRhyme.length > rhymeVisibleCap ||
    rhymeFilteredVowel.length > rhymeVisibleCap ||
    rhymeFilteredAsson.length > rhymeVisibleCap ||
    rhymeFilteredCons.length > rhymeVisibleCap;

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
            <span className="you-badge">Your targets</span>
          </h3>

          <div className="goal-cards">
            <GoalCard
              label="Lines"
              icon="⌇"
              current={docStats.nonEmptyLines}
              target={goals.targetLines}
              onSet={(v) => setGoalValue("targetLines", v)}
            />
            <GoalCard
              label="Stanzas"
              icon="⋮"
              current={docStats.stanzaCount}
              target={goals.targetStanzas}
              onSet={(v) => setGoalValue("targetStanzas", v)}
              hint="Stanzas are blocks of lines separated by blank lines"
            />
            <GoalCard
              label="Lines / stanza"
              icon="≡"
              current={docStats.stanzaCount > 0 ? Math.round(docStats.nonEmptyLines / docStats.stanzaCount) : null}
              target={goals.targetLinesPerStanza}
              onSet={(v) => setGoalValue("targetLinesPerStanza", v)}
              hint="Average lines per stanza"
            />
            <GoalCard
              label="Syllable cap"
              icon="◌"
              current={goals.maxSyllablesPerLine != null ? goalEvaluation.syllableOverLines.length : null}
              target={goals.maxSyllablesPerLine}
              onSet={(v) => setGoalValue("maxSyllablesPerLine", v)}
              variant="cap"
              hint="Flag lines whose estimated syllable count exceeds this"
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

          {goalEvaluation.warnings.length === 0 &&
          Object.values(goals).some((v) => v != null) ? (
            <p className="goal-on-target">✓ All goals met</p>
          ) : null}
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
          <RhymeFinder />

          {/* Controls: filter + strictness chips in one row */}
          <div className="rhyme-controls-row">
            <input
              type="search"
              className="rhyme-filter-input"
              value={rhymeEndingFilter}
              onChange={(e) => setRhymeEndingFilter(e.target.value)}
              placeholder="Filter endings…"
              aria-label="Filter rhyme clusters by ending"
            />
            <div className="rhyme-breadth-group" role="group" aria-label="Match strictness">
              {(["strict", "near", "broad"] as RhymeBreadth[]).map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`rhyme-breadth-chip${rhymeBreadth === b ? " is-active" : ""}`}
                  aria-pressed={rhymeBreadth === b}
                  onClick={() => onRhymeBreadthChange(b)}
                  title={
                    b === "strict" ? "Last 4 letters must match" :
                    b === "near"   ? "Vowel-tail match (default)" :
                                     "Last 2 letters"
                  }
                >
                  {b === "strict" ? "=" : b === "near" ? "≈" : "~"}
                </button>
              ))}
            </div>
          </div>

          {heavyToolsStale ? (
            <p className="tools-stale-hint muted small" role="status" aria-live="polite">Updating…</p>
          ) : null}

          {/* Four sound sections — only shown when the source has data */}
          {(
            [
              { label: "End rhyme",  clusters: rhymeFilteredRhyme, source: rhymeClusters,      prefix: "…" },
              { label: "Eye rhyme",  clusters: rhymeFilteredVowel, source: vowelTailClusters,  prefix: "…" },
              { label: "Assonance",  clusters: rhymeFilteredAsson, source: assonanceClusters,  prefix: ""  },
              { label: "Consonance", clusters: rhymeFilteredCons,  source: consonanceClusters, prefix: "…" },
            ] as { label: string; clusters: typeof rhymeFilteredRhyme; source: typeof rhymeClusters; prefix: string }[]
          ).map(({ label, clusters, source, prefix }) =>
            source.length === 0 ? null : (
              <div key={label} className="rhyme-section">
                <span className="rhyme-section-label">{label}</span>
                {clusters.length === 0 ? (
                  <p className="muted small rhyme-section-empty">No matches.</p>
                ) : (
                  <ul className="hint-list hint-list-draft">
                    {clusters.slice(0, rhymeVisibleCap).map((c) => (
                      <li key={c.ending}>
                        <span className="mono">{prefix}{c.ending}</span>
                        {" · "}
                        <JumpLineList lineNumbers={c.lineNumbers} goToLine={goToLine} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          )}

          {rhymeClusters.length === 0 && vowelTailClusters.length === 0 &&
           assonanceClusters.length === 0 && consonanceClusters.length === 0 &&
           docStats.nonEmptyLines > 0 ? (
            <p className="muted small">Patterns appear once line endings repeat.</p>
          ) : null}

          {rhymeAnyOverCap ? (
            <p className="rhyme-show-more-wrap">
              <button type="button" className="small-btn" onClick={() => setRhymeVisibleCap((c) => c + 10)}>
                Show 10 more
              </button>
            </p>
          ) : null}
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
