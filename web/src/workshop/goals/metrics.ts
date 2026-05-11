import type { DocumentStats } from "@/workshop/analysis/line-stats";
import { canonicaliseRhymeScheme, type WorkshopGoals } from "./types";

export interface SchemeLineCompare {
  /** 1-based line number. */
  line: number;
  /** Canonical detected letter for this line (single uppercase letter, possibly empty if no rhyme info). */
  detected: string;
  /** Canonical expected letter for this line (empty if pattern length doesn't cover it). */
  expected: string;
  matches: boolean;
}

export interface GoalEvaluation {
  /** Warnings for required goals — shown in the issues panel. */
  warnings: string[];
  /** Hints for soft/aspirational goals — shown only in the goals panel. */
  softHints: string[];
  syllableOverLines: number[];
  /** True when target scheme is set and detected scheme matches structurally. */
  rhymeSchemeMatches: boolean | null;
  /** Canonical form of the user's currently-detected scheme (first non-empty line labels joined). */
  detectedSchemeCanonical: string;
  /** Canonical form of the user's target scheme (full-poem expansion when per-stanza). */
  targetSchemeCanonical: string;
  /** Per-line comparison for visualization. Only includes non-empty (rhyme-bearing) lines. */
  schemePerLine: SchemeLineCompare[];
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
    add(bag.key, `${labels.cap} ${current} below your minimum of ${bag.min}.`);
  }
  if (bag.max != null && current > bag.max) {
    add(bag.key, `${labels.cap} ${current} above your maximum of ${bag.max}.`);
  }
}

/**
 * Build a flat per-line expected-letter sequence aligned with the rhyme-bearing
 * lines. In per-stanza mode the pattern is replayed across each stanza's
 * rhyme-bearing line count; in full mode the pattern is taken verbatim and
 * truncated/padded to fit.
 */
function buildExpectedSequence(
  pattern: string,
  detectedLabels: string[],
  stats: DocumentStats,
  perStanza: boolean,
): { expectedPerNonEmptyLine: string[]; expectedFlat: string } {
  // Indices (0-based) of lines that have a detected end-rhyme label.
  const rhymeBearingIdx: number[] = [];
  detectedLabels.forEach((label, i) => {
    if (label) rhymeBearingIdx.push(i);
  });

  const expectedPerNonEmptyLine: string[] = new Array(rhymeBearingIdx.length).fill("");

  if (!perStanza) {
    for (let i = 0; i < rhymeBearingIdx.length; i++) {
      expectedPerNonEmptyLine[i] = pattern[i] ?? "";
    }
    return {
      expectedPerNonEmptyLine,
      expectedFlat: expectedPerNonEmptyLine.join(""),
    };
  }

  // Per-stanza: walk each stanza, replay pattern within it.
  // Use canonical relabel per stanza so different stanzas get distinct letter
  // pools — keeps the full-poem canonical comparison meaningful.
  let letterOffset = 0;
  for (const stanza of stats.stanzaStats) {
    const linesInStanza: number[] = [];
    for (let i = 0; i < rhymeBearingIdx.length; i++) {
      const lineNum = rhymeBearingIdx[i]! + 1;
      if (lineNum >= stanza.startLine && lineNum <= stanza.endLine) {
        linesInStanza.push(i);
      }
    }
    if (linesInStanza.length === 0) continue;
    // Build a relabelled pattern for this stanza using a fresh letter pool.
    const localMap = new Map<string, string>();
    const base = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let used = 0;
    for (let p = 0; p < linesInStanza.length; p++) {
      const ch = pattern[p];
      if (!ch) break;
      let mapped = localMap.get(ch);
      if (!mapped) {
        const target = base[letterOffset + used] ?? ch;
        mapped = target;
        localMap.set(ch, mapped);
        used += 1;
      }
      expectedPerNonEmptyLine[linesInStanza[p]!] = mapped;
    }
    letterOffset += used;
  }

  return {
    expectedPerNonEmptyLine,
    expectedFlat: expectedPerNonEmptyLine.join(""),
  };
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

  const rawPattern = goals.targetRhymeScheme ?? "";
  const targetCanon = canonicaliseRhymeScheme(rawPattern);
  const perStanza = !!goals.targetRhymeSchemePerStanza;

  const rhymeBearingIdx: number[] = [];
  detectedScheme.forEach((lab, i) => {
    if (lab) rhymeBearingIdx.push(i);
  });
  const detectedJoined = rhymeBearingIdx.map((i) => detectedScheme[i]!).join("");
  const detectedCanon = canonicaliseRhymeScheme(detectedJoined);

  let rhymeSchemeMatches: boolean | null = null;
  let targetSchemeCanonical = targetCanon;
  let schemePerLine: SchemeLineCompare[] = [];

  if (targetCanon) {
    const { expectedPerNonEmptyLine, expectedFlat } = buildExpectedSequence(
      targetCanon,
      detectedScheme,
      stats,
      perStanza,
    );
    const expectedCanon = canonicaliseRhymeScheme(expectedFlat);
    targetSchemeCanonical = expectedCanon || targetCanon;

    schemePerLine = rhymeBearingIdx.map((origIdx, i) => {
      const det = detectedCanon[i] ?? "";
      const exp = canonicaliseRhymeScheme(
        expectedPerNonEmptyLine.slice(0, i + 1).join(""),
      ).slice(-1);
      // Use position-wise canonical letters from the canonicalised full strings
      // to make comparison consistent.
      const detLetter = detectedCanon[i] ?? "";
      const expLetter = expectedCanon[i] ?? "";
      return {
        line: origIdx + 1,
        detected: detLetter || det,
        expected: expLetter || exp,
        matches: detLetter === expLetter && detLetter !== "",
      };
    });

    if (!detectedCanon) {
      rhymeSchemeMatches = false;
      addMessage(
        "targetRhymeScheme",
        `Rhyme scheme — write a few lines so we can match against ${targetCanon}.`,
      );
    } else if (perStanza) {
      // Per-stanza: each stanza must match the pattern's structure.
      const expectedLen = expectedPerNonEmptyLine.filter((c) => c).length;
      if (detectedCanon.length < expectedLen) {
        rhymeSchemeMatches = false;
        addMessage(
          "targetRhymeScheme",
          `Per-stanza rhyme: only ${detectedCanon.length} of ${expectedLen} rhyme-bearing lines so far.`,
        );
      } else {
        const mismatchLines = schemePerLine
          .filter((r) => !r.matches)
          .map((r) => r.line);
        rhymeSchemeMatches = mismatchLines.length === 0;
        if (!rhymeSchemeMatches) {
          const preview = mismatchLines.slice(0, 5).join(", ");
          const more =
            mismatchLines.length > 5 ? ` (+${mismatchLines.length - 5} more)` : "";
          addMessage(
            "targetRhymeScheme",
            `Per-stanza rhyme breaks on line(s): ${preview}${more}.`,
          );
        }
      }
    } else if (detectedCanon.length !== expectedCanon.length) {
      rhymeSchemeMatches = false;
      addMessage(
        "targetRhymeScheme",
        `Rhyme scheme: have ${detectedCanon} (${detectedCanon.length} lines), want ${expectedCanon} (${expectedCanon.length} lines).`,
      );
    } else if (detectedCanon !== expectedCanon) {
      rhymeSchemeMatches = false;
      addMessage(
        "targetRhymeScheme",
        `Rhyme scheme: have ${detectedCanon}, want ${expectedCanon}.`,
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
    detectedSchemeCanonical: detectedCanon,
    targetSchemeCanonical,
    schemePerLine,
  };
}
