import { describe, expect, it } from "vitest";
import { computeDocumentStats } from "./line-stats";
import {
  iambicFitPercentForPattern,
  meterHintsForBody,
  stressPatternForWord,
  stressPatternForWordHeuristic,
  summarizeMeterCoverage,
} from "@/workshop/meter/meter-hints";

describe("meter-hints", () => {
  it("marks single-syllable function words weak (heuristic)", () => {
    expect(stressPatternForWordHeuristic("the")).toBe("x");
  });

  it("marks single-syllable content words stressed (heuristic)", () => {
    expect(stressPatternForWordHeuristic("cat")).toBe("/");
  });

  it("uses first-syllable stress for polysyllables (heuristic)", () => {
    const p = stressPatternForWordHeuristic("beautiful");
    expect(p.length).toBeGreaterThan(1);
    expect(p[0]).toBe("/");
  });

  it("uses CMU pattern when lexicon matches", () => {
    const lex = new Map([["hello", "/x"]]);
    expect(stressPatternForWord("hello", lex)).toBe("/x");
  });

  it("computes iambic fit for alternating pattern", () => {
    expect(iambicFitPercentForPattern("x/x/")).toBe(100);
    expect(iambicFitPercentForPattern("/x/x")).toBe(0);
  });

  it("builds per-line hints for body", () => {
    const rows = meterHintsForBody("The cat\n\nruns", null);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.stressPattern).toContain("x");
    expect(rows[0]!.stressPattern).toContain("/");
    expect(rows[0]!.stressSource).toBe("heuristic");
  });

  it("marks lexicon-backed lines", () => {
    const lex = new Map([
      ["the", "x"],
      ["cat", "/"],
    ]);
    const rows = meterHintsForBody("the cat", lex);
    expect(rows[0]!.lineNumber).toBe(1);
    expect(rows[0]!.stressSource).toBe("lexicon");
    expect(rows[0]!.stressPattern).toBe("x/");
  });

  it("summarizes coverage over non-empty lines only", () => {
    const body = "the cat\n\n";
    const doc = computeDocumentStats(body);
    const hints = meterHintsForBody(
      body,
      new Map([
        ["the", "x"],
        ["cat", "/"],
      ]),
    );
    const sum = summarizeMeterCoverage(hints, doc);
    expect(sum.nonEmptyLines).toBe(1);
    expect(sum.lexiconLines).toBe(1);
    expect(sum.mixedLines).toBe(0);
    expect(sum.heuristicLines).toBe(0);
  });
});
