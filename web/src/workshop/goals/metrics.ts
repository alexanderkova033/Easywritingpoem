import type { DocumentStats } from "@/workshop/analysis/line-stats";
import { canonicaliseRhymeScheme, type WorkshopGoals } from "./types";

export interface GoalEvaluation {
  /** Warnings for required goals — shown in the issues panel. */
  warnings: string[];
  /** Hints for soft/aspirational goals — shown only in the goals panel. */
  softHints: string[];
  syllableOverLines: number[];
  /** True when target scheme is set and detected scheme matches structurally. */
  rhymeSchemeMatches: boolean | null;
  /** Canonical form of the user's currently-detected scheme (first non-empty line labels). */
  detectedSchemeCanonical: string;
  /** Canonical form of the user's target scheme. */
  targetSchemeCanonical: string;
}

function isSoft(goals: WorkshopGoals, key: string): boolean {
  return goals.softGoals?.includes(key) ?? false;
}

function metricLabel(metric: "lines" | "stanzas" | "words"): {
  singular: string;
  plural: string;
  cap: string;
} {
  if (metric === "lines") return { singular: "line", plural: "lines", cap: "Lines" };
  if (metric === "stanzas") return { singular: "stanza", plural: "stanzas", cap: "Stanza count" };
  return { singular: "word", plural: "words", cap: "Words" };
}

interface MetricBag {
  target: number | undefined;
  min: number | undefined;
  max: number | undefined;
  key: string;
}

function evalMetric(
  current: number,
  metric: "lines" | "stanzas" | "words",
  bag: MetricBag,
  add: (key: string, msg: string) => void,
): void {
  const labels = metricLabel(metric);
  // Exact target wins when present.
  if (bag.target != null) {
    if (current < bag.target) {
      add(bag.key, `${current} of ${bag.target} ${labels.plural} written.`);
    } else if (current > bag.target) {
      add(
        bag.key,
        `${current} ${labels.plural} — ${current - bag.target} over target of ${bag.target}.`,
      );
    }
    return;
  }
  if (bag.min != null && current < bag.min) {
    add(
      bag.key,
      `${labels.cap} ${current} below your minimum of ${bag.min}.`,
    );
  }
  if (bag.max != null && current > bag.max) {
    add(
      bag.key,
      `${labels.cap} ${current} above your maximum of ${bag.max}.`,
    );
  }
}

export function evaluateGoals(
  stats: DocumentStats,
  goals: WorkshopGoals,
  detectedScheme: string[] = [],
): GoalEvaluation {
  const warnings: string[] = [];
  const softHints: string[] = [];
  const syllableOverLines: number[] = [];

  const addMessage = (key: string, msg: string) => {
    if (isSoft(goals, key)) softHints.push(msg);
    else warnings.push(msg);
  };

  evalMetric(
    stats.nonEmptyLines,
    "lines",
    {
      key: "targetLines",
      target: goals.targetLines,
      min: goals.minLines,
      max: goals.maxLines,
    },
    addMessage,
  );

  evalMetric(
    stats.stanzaCount,
    "stanzas",
    {
      key: "targetStanzas",
      target: goals.targetStanzas,
      min: goals.minStanzas,
      max: goals.maxStanzas,
    },
    addMessage,
  );

  evalMetric(
    stats.totalWords,
    "words",
    {
      key: "targetWords",
      target: goals.targetWords,
      min: goals.minWords,
      max: goals.maxWords,
    },
    addMessage,
  );

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
      addMessage(
        "maxSyllablesPerLine",
        `Syllables exceed ${cap} on line(s): ${preview}${more}.`,
      );
    }
  }

  // Rhyme scheme — compare canonical forms over non-empty labels only.
  const targetSchemeCanonical = goals.targetRhymeScheme
    ? canonicaliseRhymeScheme(goals.targetRhymeScheme)
    : "";
  const detectedJoined = detectedScheme.filter((s) => s).join("");
  const detectedSchemeCanonical = canonicaliseRhymeScheme(detectedJoined);
  let rhymeSchemeMatches: boolean | null = null;
  if (targetSchemeCanonical) {
    if (!detectedSchemeCanonical) {
      rhymeSchemeMatches = false;
      addMessage(
        "targetRhymeScheme",
        `Rhyme scheme — write a few lines so we can match against ${targetSchemeCanonical}.`,
      );
    } else if (detectedSchemeCanonical.length !== targetSchemeCanonical.length) {
      rhymeSchemeMatches = false;
      addMessage(
        "targetRhymeScheme",
        `Rhyme scheme: have ${detectedSchemeCanonical} (${detectedSchemeCanonical.length} lines), want ${targetSchemeCanonical} (${targetSchemeCanonical.length} lines).`,
      );
    } else if (detectedSchemeCanonical !== targetSchemeCanonical) {
      rhymeSchemeMatches = false;
      addMessage(
        "targetRhymeScheme",
        `Rhyme scheme: have ${detectedSchemeCanonical}, want ${targetSchemeCanonical}.`,
      );
    } else {
      rhymeSchemeMatches = true;
    }
  }

  return {
    warnings,
    softHints,
    syllableOverLines,
    rhymeSchemeMatches,
    detectedSchemeCanonical,
    targetSchemeCanonical,
  };
}
