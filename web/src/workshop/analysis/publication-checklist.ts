import type { DocumentStats } from "./line-stats";
import type { GoalEvaluation } from "@/workshop/goals/metrics";
import type { ToolTab } from "@/workshop/shell/workshop-helpers";

export type ChecklistIcon = "lines" | "title" | "spell" | "goals";

export interface ChecklistItem {
  done: boolean;
  text: string;
  detail?: string;
  icon: ChecklistIcon;
  /** When set, show a control that opens this tool tab (or title field). */
  openToolTab?: ToolTab;
  /** Focus the title field instead of switching tools. */
  focusTitleField?: true;
}

export function buildPublicationChecklist(args: {
  title: string;
  docStats: DocumentStats;
  spellingFlagCount: number;
  wordlistReady: boolean;
  goalEvaluation: GoalEvaluation;
}): { items: ChecklistItem[]; tips: string[] } {
  const { title, docStats, spellingFlagCount, wordlistReady, goalEvaluation } =
    args;

  const items: ChecklistItem[] = [];

  items.push({
    done: docStats.nonEmptyLines > 0,
    text: "At least one non-empty line",
    icon: "lines",
    detail:
      docStats.nonEmptyLines === 0
        ? "Add your poem before publishing."
        : undefined,
    openToolTab: docStats.nonEmptyLines === 0 ? "lines" : undefined,
  });

  items.push({
    done: title.trim().length > 0,
    text: "Title set",
    icon: "title",
    detail:
      title.trim().length === 0
        ? "Optional for some venues; still useful when sharing."
        : undefined,
    focusTitleField: title.trim().length === 0 ? true : undefined,
  });

  items.push({
    done: wordlistReady && spellingFlagCount === 0,
    text: "No spelling flags (local dictionary)",
    icon: "spell",
    detail: !wordlistReady
      ? "Dictionary still loading."
      : spellingFlagCount > 0
        ? `${spellingFlagCount} unknown token(s) — may be names or intentional.`
        : undefined,
    openToolTab:
      !wordlistReady || spellingFlagCount > 0 ? "spell" : undefined,
  });

  items.push({
    done: goalEvaluation.warnings.length === 0,
    text: "Draft meets your line / word / syllable goals",
    icon: "goals",
    detail:
      goalEvaluation.warnings.length > 0
        ? goalEvaluation.warnings[0]
        : undefined,
    openToolTab:
      goalEvaluation.warnings.length > 0 ? "goals" : undefined,
  });

  const tips: string[] = [
    "Read the whole poem aloud once before you share it — your ear will catch clunky rhythm.",
    "Rough read-aloud minutes (and stanza blocks) live in Totals.",
  ];

  return { items, tips };
}
