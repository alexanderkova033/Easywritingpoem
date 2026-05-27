import type { ChangeEvent } from "react";
import type { SpellMode } from "@/workshop/library/local-draft-storage";
import type { SpellHit } from "@/spellcheck/scan";
import type { WorkshopGoals } from "@/workshop/goals/types";
import type { GoalEvaluation } from "@/workshop/goals/metrics";
import type { DocumentStats } from "@/workshop/analysis/line-stats";
import type { ChecklistItem } from "@/workshop/analysis/publication-checklist";
import type { RhymeCluster } from "@/workshop/rhyme/hints";
import type { StanzaClusterGroup } from "@/workshop/rhyme/hints";
import type {
  RepeatedWord,
  RepetitionAnalysis,
} from "@/workshop/analysis/repeated-words";
import type { RevisionSnapshot } from "@/workshop/library/revision-snapshots";
import type { LineDiffRow } from "@/workshop/library/diff-lines";
import type { LineMeterHint, ManualStressOverrides } from "@/workshop/meter/meter-hints";
import { StuckHelper } from "./StuckHelper";
import type { ClicheHit } from "@/workshop/analysis/cliche-scan";
import {
  RevisionCompareSection,
  type CompareSnapshotOption,
} from "./RevisionCompareSection";
import type { ToolTab } from "@/workshop/shell/workshop-helpers";
import type { RhymeBreadth } from "@/workshop/rhyme/scheme";
import { IssuesPanel } from "./panels/IssuesPanel";
import { GoalsPanel } from "./panels/GoalsPanel";
import { LinesPanel } from "./panels/LinesPanel";
import { MeterPanel } from "./panels/MeterPanel";
import { RhymePanel } from "./panels/RhymePanel";
import { RepeatPanel } from "./panels/RepeatPanel";
import { SpellPanel } from "./panels/SpellPanel";
import { StarredPanel } from "./panels/StarredPanel";
import { SoundMapPanel } from "./panels/SoundMapPanel";
import "./panels/StarredPanel.css";
import "./panels/SoundMapPanel.css";


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
  onInsertSuggestionAtCursor?: (text: string) => void;
  onInsertWord?: (text: string) => void;
  onReplaceLine?: (lineNum: number, text: string) => void;
  selectedText?: string | null;
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
  stressLexicon: ReadonlyMap<string, string> | null;
  manualStressOverrides: ManualStressOverrides;
  onSetStressOverride: (word: string, pattern: string) => void;
  onRemoveStressOverride: (word: string) => void;
  onEchoHighlightsChange?: (
    highlights: { line: number; start: number; end: number; colorKey: string }[] | null,
  ) => void;
}

export function WorkshopToolPanels(props: WorkshopToolPanelsProps) {
  const { toolTab } = props;

  return (
    <div className="tool-tab-panel" key={toolTab}>
      {toolTab === "issues" ? (
        <IssuesPanel
          wordlist={props.wordlist}
          goalEvaluation={props.goalEvaluation}
          publication={props.publication}
          spellHits={props.spellHits}
          clicheHits={props.clicheHits}
          heavyToolsStale={props.heavyToolsStale}
          goToLine={props.goToLine}
          goToSpellHitAt={props.goToSpellHitAt}
          applySpellSuggestion={props.applySpellSuggestion}
          applySpellSuggestionAll={props.applySpellSuggestionAll}
          refreshSpell={props.refreshSpell}
          onOpenToolTab={props.onOpenToolTab}
          focusPoemTitle={props.focusPoemTitle}
        />
      ) : null}

      {toolTab === "goals" ? (
        <GoalsPanel
          goals={props.goals}
          goalEvaluation={props.goalEvaluation}
          docStats={props.docStats}
          goToLine={props.goToLine}
          setGoalValue={props.setGoalValue}
          setRhymeSchemeGoal={props.setRhymeSchemeGoal}
          setRhymeSchemePerStanza={props.setRhymeSchemePerStanza}
          resetGoals={props.resetGoals}
          toggleGoalSoft={props.toggleGoalSoft}
          applyGoalPreset={props.applyGoalPreset}
        />
      ) : null}

      {toolTab === "lines" ? (
        <LinesPanel
          docStats={props.docStats}
          heavyToolsStale={props.heavyToolsStale}
          goToLine={props.goToLine}
        />
      ) : null}

      {toolTab === "meter" ? (
        <MeterPanel
          docStats={props.docStats}
          meterHints={props.meterHints}
          stressLexiconReady={props.stressLexiconReady}
          stressLexiconErr={props.stressLexiconErr}
          heavyToolsStale={props.heavyToolsStale}
          goToLine={props.goToLine}
          poemLines={props.poemLines}
          stressLexicon={props.stressLexicon}
          manualStressOverrides={props.manualStressOverrides}
          onSetStressOverride={props.onSetStressOverride}
          onRemoveStressOverride={props.onRemoveStressOverride}
        />
      ) : null}

      {toolTab === "rhyme" ? (
        <RhymePanel
          docStats={props.docStats}
          stanzaRhymeGroups={props.stanzaRhymeGroups}
          poemLines={props.poemLines}
          goToLineEnd={props.goToLineEnd}
          onInsertWord={props.onInsertWord}
          rhymeBreadth={props.rhymeBreadth}
          onRhymeBreadthChange={props.onRhymeBreadthChange}
          rhymeFinderQuery={props.rhymeFinderQuery}
          onRhymeSuggestionHover={props.onRhymeSuggestionHover}
          manualRhymeLinks={props.manualRhymeLinks}
          onAddManualRhymeLink={props.onAddManualRhymeLink}
          onRemoveManualRhymeLink={props.onRemoveManualRhymeLink}
          manualRhymeUnlinks={props.manualRhymeUnlinks}
          onAddManualRhymeUnlink={props.onAddManualRhymeUnlink}
          onRemoveManualRhymeUnlink={props.onRemoveManualRhymeUnlink}
          heavyToolsStale={props.heavyToolsStale}
        />
      ) : null}

      {toolTab === "repeat" ? (
        <RepeatPanel
          docStats={props.docStats}
          repeated={props.repeated}
          repetition={props.repetition}
          heavyToolsStale={props.heavyToolsStale}
          goToLine={props.goToLine}
        />
      ) : null}

      {toolTab === "spell" ? (
        <SpellPanel
          docStats={props.docStats}
          spellHits={props.spellHits}
          wordlist={props.wordlist}
          wordlistErr={props.wordlistErr}
          spellMode={props.spellMode}
          onSpellModeChange={props.onSpellModeChange}
          goToSpellHitAt={props.goToSpellHitAt}
          applySpellSuggestion={props.applySpellSuggestion}
          applySpellSuggestionAll={props.applySpellSuggestionAll}
          spellBump={props.spellBump}
          refreshSpell={props.refreshSpell}
          onSpellPersistenceError={props.onSpellPersistenceError}
          heavyToolsStale={props.heavyToolsStale}
        />
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
            revisions={props.revisions}
            snapshotLabel={props.snapshotLabel}
            onSnapshotLabelChange={props.onSnapshotLabelChange}
            onSaveSnapshot={props.onSaveSnapshot}
            snapshotFlash={props.snapshotFlash}
            onRestoreRevision={props.onRestoreRevision}
            onDeleteRevision={props.onDeleteRevision}
            onDeleteDuplicates={props.onDeleteDuplicateRevisions}
            duplicateCount={props.duplicateRevisionCount}
            onDiffSnapshot={props.onDiffSnapshot}
            activeDiffSnapshotId={props.activeDiffSnapshotId}
            compareLeftId={props.compareLeftId}
            compareRightId={props.compareRightId}
            onCompareLeftChange={props.onCompareLeftChange}
            onCompareRightChange={props.onCompareRightChange}
            compareViewMode={props.compareViewMode}
            onCompareViewModeChange={props.onCompareViewModeChange}
            compareSnapshotOptions={props.compareSnapshotOptions}
            compareLeftBody={props.compareLeftBody}
            compareRightBody={props.compareRightBody}
            compareDiffRows={props.compareDiffRows}
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
          <StuckHelper
            title={props.poemTitle}
            lines={props.poemLines}
            onInsert={props.onInsertSuggestion}
            onInsertAtCursor={props.onInsertSuggestionAtCursor}
            cursorLine={props.cursorLine}
            selectedText={props.selectedText}
          />
        </div>
      ) : null}

      {toolTab === "starred" ? (
        <StarredPanel onInsertWord={props.onInsertWord} />
      ) : null}

      {toolTab === "echoes" ? (
        <SoundMapPanel
          poemLines={props.poemLines}
          stressLexicon={props.stressLexicon}
          stressLexiconReady={props.stressLexiconReady}
          heavyToolsStale={props.heavyToolsStale}
          goToLine={props.goToLine}
          onEchoHighlightsChange={props.onEchoHighlightsChange}
        />
      ) : null}

    </div>
  );
}
