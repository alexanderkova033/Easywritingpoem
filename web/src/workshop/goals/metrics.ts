import type { DocumentStats } from "@/workshop/analysis/line-stats";
import type { WorkshopGoals } from "./types";

export interface SyllablePatternMismatch {
  lineNumber: number;
  actual: number;
  expected: number;
}

export interface GoalEvaluation {
  /** Warnings for required goals — shown in the issues panel. */
  warnings: string[];
  /** Hints for soft/aspirational goals — shown only in the goals panel. */
  softHints: string[];
  syllableOverLines: number[];
  syllablePatternMismatches: SyllablePatternMismatch[];
}

function isSoft(goals: WorkshopGoals, key: string): boolean {
  return goals.softGoals?.includes(key) ?? false;
}

export function evaluateGoals(
  stats: DocumentStats,
  goals: WorkshopGoals,
): GoalEvaluation {
  const warnings: string[] = [];
  const softHints: string[] = [];
  const syllableOverLines: number[] = [];
  const syllablePatternMismatches: SyllablePatternMismatch[] = [];

  const addMessage = (key: string, msg: string) => {
    if (isSoft(goals, key)) softHints.push(msg);
    else warnings.push(msg);
  };

  const lines = stats.nonEmptyLines;
  const stanzas = stats.stanzaCount;
  const avgLPS = stanzas > 0 ? Math.round(lines / stanzas) : 0;

  if (goals.targetLines != null) {
    if (lines < goals.targetLines)
      addMessage("targetLines", `${lines} of ${goals.targetLines} lines written.`);
    else if (lines > goals.targetLines)
      addMessage("targetLines", `${lines} lines — ${lines - goals.targetLines} over target of ${goals.targetLines}.`);
  }

  if (goals.targetStanzas != null) {
    if (stanzas < goals.targetStanzas)
      addMessage("targetStanzas", `${stanzas} of ${goals.targetStanzas} stanzas written.`);
    else if (stanzas > goals.targetStanzas)
      addMessage("targetStanzas", `${stanzas} stanzas — ${stanzas - goals.targetStanzas} over target of ${goals.targetStanzas}.`);
  }

  if (goals.targetLinesPerStanza != null && stanzas > 0) {
    if (avgLPS !== goals.targetLinesPerStanza)
      addMessage("targetLinesPerStanza", `Averaging ${avgLPS} lines per stanza — target is ${goals.targetLinesPerStanza}.`);
  }

  if (goals.maxSyllablesPerLine != null) {
    const cap = goals.maxSyllablesPerLine;
    for (const row of stats.lines) {
      if (row.text.trim().length === 0) continue;
      if (row.syllables > cap) syllableOverLines.push(row.lineNumber);
    }
    if (syllableOverLines.length > 0) {
      const preview = syllableOverLines.slice(0, 6).join(", ");
      const more = syllableOverLines.length > 6 ? ` (+${syllableOverLines.length - 6} more)` : "";
      addMessage("maxSyllablesPerLine", `Syllables exceed ${cap} on line(s): ${preview}${more}.`);
    }
  }

  if (goals.syllablePattern && goals.syllablePattern.length > 0) {
    const pattern = goals.syllablePattern;
    const nonEmptyLines = stats.lines.filter((l) => l.text.trim().length > 0);
    for (let i = 0; i < pattern.length; i++) {
      const expected = pattern[i];
      const row = nonEmptyLines[i];
      if (!row) continue;
      if (row.syllables !== expected) {
        syllablePatternMismatches.push({
          lineNumber: row.lineNumber,
          actual: row.syllables,
          expected,
        });
      }
    }
    if (syllablePatternMismatches.length > 0) {
      const summary = pattern.join("–");
      addMessage(
        "syllablePattern",
        `Syllable pattern ${summary}: ${syllablePatternMismatches.length} line(s) off target.`,
      );
    }
  }

  return { warnings, softHints, syllableOverLines, syllablePatternMismatches };
}
