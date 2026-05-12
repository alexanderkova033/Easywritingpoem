import type { QuickDocumentStats } from "@/workshop/analysis/line-stats";
import type { GoalEvaluation } from "@/workshop/goals/metrics";
import type { MeterCoverageSummary } from "@/workshop/meter/meter-hints";
import type { ToolTab } from "@/workshop/shell/workshop-helpers";
import { useHoverHintBinder } from "@/workshop/hints/HoverHintsContext";

export interface ToolsOverviewStripProps {
  /** Open checklist rows + goal warnings + spelling flags (Issues tab). */
  issuesQueueCount: number;
  quickDocStats: QuickDocumentStats;
  spellHitCount: number;
  wordlistReady: boolean;
  /** Count of rhyme / ending-pattern clusters (Sound tab). */
  rhymeClusterCount: number;
  goalEvaluation: GoalEvaluation;
  repeatCount: number;
  checklistOpenCount: number;
  meterCoverage: MeterCoverageSummary;
  stressLexiconReady: boolean;
  heavyToolsStale: boolean;
  activeTab: ToolTab;
  onOpenTab: (tab: ToolTab) => void;
  onOpenExport?: () => void;
}

export function ToolsOverviewStrip(props: ToolsOverviewStripProps) {
  const hint = useHoverHintBinder();
  const {
    issuesQueueCount,
    quickDocStats: docStats,
    spellHitCount,
    wordlistReady,
    rhymeClusterCount,
    goalEvaluation,
    repeatCount,
    checklistOpenCount,
    meterCoverage,
    stressLexiconReady,
    heavyToolsStale,
    activeTab,
    onOpenTab,
    onOpenExport,
  } = props;

  const goalIssue = goalEvaluation.warnings.length > 0;
  const spellIssue = wordlistReady && spellHitCount > 0;
  const checklistIssue = checklistOpenCount > 0;
  const nonEmptyMeter = meterCoverage.nonEmptyLines;
  const heuristicFrac =
    nonEmptyMeter > 0 ? meterCoverage.heuristicLines / nonEmptyMeter : 0;
  const meterIssue =
    stressLexiconReady &&
    nonEmptyMeter > 0 &&
    heuristicFrac >= 0.35;

  const linesTitle =
    docStats.totalLines !== docStats.nonEmptyLines
      ? `${docStats.nonEmptyLines} lines with text · ${docStats.totalLines} total in editor (includes blanks)`
      : `${docStats.nonEmptyLines} lines with text`;

  const issuesIssue = issuesQueueCount > 0;

  const issuesPillHint = issuesIssue
    ? `${issuesQueueCount} item(s) in revision queue (checklist, goals, spelling)`
    : "Revision queue clear — open Issues tab";

  return (
    <div className="tools-overview-wrap">
    <div
      className="tools-overview-strip tools-overview-strip-minimal"
      role="toolbar"
      aria-label="Quick open: jump to a tool by stat"
    >
      <button
        type="button"
        className={`tools-overview-pill ${activeTab === "issues" ? "is-current" : ""} ${issuesIssue ? "has-attn" : ""}`}
        onClick={() => onOpenTab("issues")}
        {...hint(issuesPillHint)}
      >
        <span className="tools-overview-pill-k">
          {issuesIssue ? issuesQueueCount : "✓"}
        </span>
        <span className="tools-overview-pill-l">issues</span>
      </button>
      <button
        type="button"
        className={`tools-overview-pill ${activeTab === "lines" ? "is-current" : ""}`}
        onClick={() => onOpenTab("lines")}
        {...hint("Open Lines — per-line syllable and word counts")}
      >
        <span className="tools-overview-pill-k">{docStats.totalWords}</span>
        <span className="tools-overview-pill-l">words</span>
      </button>
      <button
        type="button"
        className={`tools-overview-pill ${activeTab === "lines" ? "is-current" : ""}`}
        onClick={() => onOpenTab("lines")}
        {...hint(`${linesTitle} — jump to line tools`)}
      >
        <span className="tools-overview-pill-k">{docStats.nonEmptyLines}</span>
        <span className="tools-overview-pill-l">lines</span>
      </button>
      <button
        type="button"
        className={`tools-overview-pill ${activeTab === "spell" ? "is-current" : ""} ${spellIssue ? "has-attn" : ""}`}
        onClick={() => onOpenTab("spell")}
        {...hint(
          !wordlistReady
            ? "Dictionary loading…"
            : spellHitCount > 0
              ? `${spellHitCount} spelling flags — open Spell tab`
              : "No spelling flags — open Spell tab",
        )}
      >
        <span className="tools-overview-pill-k">
          {!wordlistReady ? "…" : spellHitCount}
        </span>
        <span className="tools-overview-pill-l">spell</span>
      </button>
      <button
        type="button"
        className={`tools-overview-pill ${activeTab === "meter" ? "is-current" : ""} ${meterIssue ? "has-attn" : ""}`}
        onClick={() => onOpenTab("meter")}
        {...hint(
          heavyToolsStale
            ? "Meter updating…"
            : meterIssue
              ? "Many lines use heuristic stress — see Meter tab for detail"
              : "Stress and meter hints — open Meter tab",
        )}
      >
        <span className="tools-overview-pill-k">
          {heavyToolsStale
            ? "…"
            : docStats.nonEmptyLines === 0
              ? "—"
              : `${Math.round(100 - heuristicFrac * 100)}%`}
        </span>
        <span className="tools-overview-pill-l">meter</span>
      </button>
      <button
        type="button"
        className={`tools-overview-pill ${activeTab === "rhyme" ? "is-current" : ""}`}
        onClick={() => onOpenTab("rhyme")}
        {...hint(
          rhymeClusterCount > 0
            ? `${rhymeClusterCount} shared ending pattern(s) — open Rhyme tab`
            : "Rhyme and sound-pattern hints — open Rhyme tab",
        )}
      >
        <span className="tools-overview-pill-k">{rhymeClusterCount}</span>
        <span className="tools-overview-pill-l">rhyme</span>
      </button>
      <button
        type="button"
        className={`tools-overview-pill ${activeTab === "repeat" ? "is-current" : ""} ${repeatCount > 0 ? "has-attn is-muted-attn" : ""}`}
        onClick={() => onOpenTab("repeat")}
        {...hint(
          repeatCount > 0
            ? `${repeatCount} repeated words (top list) — open Repeats tab`
            : "No repeats flagged — open Repeats tab",
        )}
      >
        <span className="tools-overview-pill-k">{repeatCount}</span>
        <span className="tools-overview-pill-l">repeats</span>
      </button>
      <button
        type="button"
        className={`tools-overview-pill ${activeTab === "goals" ? "is-current" : ""} ${goalIssue ? "has-attn" : ""}`}
        onClick={() => onOpenTab("goals")}
        {...hint(
          goalIssue
            ? `${goalEvaluation.warnings.length} goal warning(s) — open Goals tab`
            : "Goals on target — open Goals tab",
        )}
      >
        <span className="tools-overview-pill-k">
          {goalIssue ? goalEvaluation.warnings.length : "OK"}
        </span>
        <span className="tools-overview-pill-l">goals</span>
      </button>
      <button
        type="button"
        className={`tools-overview-pill ${checklistIssue ? "has-attn" : ""}`}
        onClick={() => onOpenExport?.()}
        {...hint(
          checklistIssue
            ? `${checklistOpenCount} checklist item(s) open — review before export`
            : "Publication checklist clear — open Export",
        )}
      >
        <span className="tools-overview-pill-k">
          {checklistIssue ? checklistOpenCount : "✓"}
        </span>
        <span className="tools-overview-pill-l">ready</span>
      </button>
    </div>
</div>
  );
}
