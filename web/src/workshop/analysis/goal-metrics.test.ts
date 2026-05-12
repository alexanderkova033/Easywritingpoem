import { describe, expect, it } from "vitest";
import { evaluateGoals } from "@/workshop/goals/metrics";
import type { DocumentStats } from "./line-stats";

function stats(partial: Partial<DocumentStats> & Pick<DocumentStats, "lines">): DocumentStats {
  return {
    totalLines: 0,
    nonEmptyLines: 0,
    totalSyllables: 0,
    totalWords: 0,
    totalChars: 0,
    stanzaCount: 0,
    estimatedReadingMinutes: 0,
    stanzaStats: [],
    avgWordsPerNonEmptyLine: 0,
    longestLineByWords: null,
    longestLineByChars: null,
    ...partial,
  };
}

describe("evaluateGoals", () => {
  it("warns when lines below minimum", () => {
    const out = evaluateGoals(
      stats({
        lines: [],
        totalLines: 2,
        nonEmptyLines: 2,
        totalWords: 10,
      }),
      { minLines: 5 },
    );
    expect(out.warnings.some((w) => w.includes("below your minimum"))).toBe(true);
  });

  it("flags syllable cap per line", () => {
    const out = evaluateGoals(
      stats({
        lines: [
          {
            lineNumber: 1,
            text: "hello",
            syllables: 10,
            words: 1,
            chars: 5,
          },
        ],
        totalLines: 1,
        nonEmptyLines: 1,
        totalWords: 1,
        totalChars: 5,
        totalSyllables: 10,
      }),
      { maxSyllablesPerLine: 2 },
    );
    expect(out.syllableOverLines).toContain(1);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("warns when stanza count is outside range", () => {
    const low = evaluateGoals(
      stats({
        lines: [],
        stanzaCount: 1,
        stanzaStats: [
          {
            stanzaIndex: 1,
            startLine: 1,
            endLine: 1,
            lineCountInStanza: 1,
            nonEmptyLines: 1,
            words: 1,
            syllables: 1,
            avgSyllablesPerNonEmptyLine: 1,
          },
        ],
      }),
      { minStanzas: 3 },
    );
    expect(low.warnings.some((w) => w.includes("Stanza count"))).toBe(true);

    const high = evaluateGoals(
      stats({
        lines: [],
        stanzaCount: 4,
        stanzaStats: [],
      }),
      { maxStanzas: 2 },
    );
    expect(high.warnings.some((w) => w.includes("above your maximum"))).toBe(
      true,
    );
  });
});
