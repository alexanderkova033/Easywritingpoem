import { describe, expect, it } from "vitest";
import {
  lightAssonanceClusters,
  lightConsonanceClusters,
} from "@/workshop/rhyme/hints";

describe("lightAssonanceClusters", () => {
  it("groups lines with the same vowel-letter sequence in the last word", () => {
    const lines = ["The pale moon", "A dusty spoon", "No match here"];
    const c = lightAssonanceClusters(lines);
    const hit = c.find((x) => x.ending === "oo");
    expect(hit?.lineNumbers.sort()).toEqual([1, 2]);
  });
});

describe("lightConsonanceClusters", () => {
  it("groups lines sharing a consonant coda after the last vowel", () => {
    const lines = ["a test", "the mist", "x"];
    const c = lightConsonanceClusters(lines);
    const hit = c.find((x) => x.ending === "st");
    expect(hit?.lineNumbers.sort()).toEqual([1, 2]);
  });
});
