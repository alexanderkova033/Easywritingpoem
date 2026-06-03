import { describe, expect, it } from "vitest";
import { scanLinesForSpelling, spellErrorRangesFromText, spellHitsFromText } from "./scan";

describe("scanLinesForSpelling", () => {
  it("flags unknown words", () => {
    const dict = new Set(["hello", "world"]);
    const hits = scanLinesForSpelling(
      ["Hello zzzunknown"],
      dict,
      new Set(),
      new Set(),
    );
    expect(hits.some((h) => h.normalized.includes("zzzunknown"))).toBe(true);
  });

  it("respects personal dictionary", () => {
    const dict = new Set(["hello"]);
    const hits = scanLinesForSpelling(
      ["Hello coinage"],
      dict,
      new Set(["coinage"]),
      new Set(),
    );
    expect(hits).toHaveLength(0);
  });
});

describe("spellHitsFromText", () => {
  it("aligns with spellErrorRangesFromText", () => {
    const text = "one twxoo\nthree";
    const dict = new Set(["one", "two", "three"]);
    const personal = new Set<string>();
    const session = new Set<string>();
    const ranges = spellErrorRangesFromText(text, dict, personal, session);
    const hits = spellHitsFromText(text, dict, personal, session);
    expect(hits).toHaveLength(ranges.length);
    for (let i = 0; i < hits.length; i++) {
      expect(hits[i]!.docFrom).toBe(ranges[i]!.from);
      expect(hits[i]!.docTo).toBe(ranges[i]!.to);
    }
  });

  it("accepts contractions whose base is in the dictionary", () => {
    const dict = new Set([
      "could", "would", "should", "is", "are", "was", "were", "has", "have", "had", "do", "does", "did",
      "you", "we", "they", "he", "she", "it",
      // intentionally no "i" — single-letter words aren't in the wordlist; the contraction check handles it
    ]);
    const contractions = [
      "couldn't", "wouldn't", "shouldn't", "isn't", "aren't", "wasn't", "weren't",
      "hasn't", "haven't", "hadn't", "don't", "doesn't", "didn't",
      "you're", "we're", "they're", "i'm", "he's", "she's", "it's",
      "you've", "we've", "they've", "i've",
      "you'll", "we'll", "they'll", "i'll", "he'll", "she'll",
      "you'd", "we'd", "they'd", "i'd", "he'd", "she'd",
    ];
    const hits = spellHitsFromText(contractions.join(" "), dict, new Set(), new Set());
    expect(hits.map((h) => h.word)).toEqual([]);
  });

  it("accepts contractions written with a typographic apostrophe", () => {
    const dict = new Set(["could", "do", "does", "is", "are", "you", "we"]);
    // U+2019 right single quotation mark — what most editors autocorrect to.
    const contractions = ["couldn’t", "don’t", "doesn’t", "isn’t", "aren’t", "you’re", "we’ve"];
    const hits = spellHitsFromText(contractions.join(" "), dict, new Set(), new Set());
    expect(hits.map((h) => h.word)).toEqual([]);
  });

  it("reports correct line numbers for second line", () => {
    const text = "okayy\nbadwordx";
    const dict = new Set(["okay"]);
    const hits = spellHitsFromText(text, dict, new Set(), new Set());
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const last = hits[hits.length - 1]!;
    expect(last.lineNumber).toBe(2);
    expect(text.slice(last.docFrom, last.docTo)).toBe("badwordx");
  });
});
