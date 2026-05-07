import type { DocumentStats } from "./line-stats";
import type { WorkshopGoals } from "@/workshop/library/workshop-goals";

export interface GoalEvaluation {
  warnings: string[];
  syllableOverLines: number[];
}

export function evaluateGoals(
  stats: DocumentStats,
  goals: WorkshopGoals,
): GoalEvaluation {
  const warnings: string[] = [];
  const syllableOverLines: number[] = [];

  const lines = stats.nonEmptyLines;
  const stanzas = stats.stanzaCount;
  const avgLPS = stanzas > 0 ? Math.round(lines / stanzas) : 0;

  if (goals.targetLines != null) {
    if (lines < goals.targetLines)
      warnings.push(`${lines} of ${goals.targetLines} lines written.`);
    else if (lines > goals.targetLines)
      warnings.push(`${lines} lines — ${lines - goals.targetLines} over target of ${goals.targetLines}.`);
  }

  if (goals.targetStanzas != null) {
    if (stanzas < goals.targetStanzas)
      warnings.push(`${stanzas} of ${goals.targetStanzas} stanzas written.`);
    else if (stanzas > goals.targetStanzas)
      warnings.push(`${stanzas} stanzas — ${stanzas - goals.targetStanzas} over target of ${goals.targetStanzas}.`);
  }

  if (goals.targetLinesPerStanza != null && stanzas > 0) {
    if (avgLPS !== goals.targetLinesPerStanza)
      warnings.push(`Averaging ${avgLPS} lines per stanza — target is ${goals.targetLinesPerStanza}.`);
  }

  if (goals.maxSyllablesPerLine != null) {
    const cap = goals.maxSyllablesPerLine;
    for (const row of stats.lines) {
      if (row.text.trim().length === 0) continue;
      if (row.syllables > cap) syllableOverLines.push(row.lineNumber);
    }
    if (syllableOverLines.length > 0) {
      const preview = syllableOverLines.slice(0, 6).join(", ");
      const more =
        syllableOverLines.length > 6
          ? ` (+${syllableOverLines.length - 6} more)`
          : "";
      warnings.push(
        `Syllables exceed ${cap} on line(s): ${preview}${more}.`,
      );
    }
  }

  return { warnings, syllableOverLines };
}
