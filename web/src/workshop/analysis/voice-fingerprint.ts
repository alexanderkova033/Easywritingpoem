/**
 * Voice fingerprint — fully local heuristic over the writer's saved poems.
 * Zero AI tokens. Returns up to 3 short tags describing recurring tendencies
 * (imagery cluster, line-length tendency, end-stop vs enjambment).
 *
 * Used as a subtle "Your voice often: …" hint in the AI Overview tab.
 */

import { loadOrCreateLibrary, type PoemRecord } from "@/workshop/library/local-draft-library";
import { countSyllablesInLine } from "@/workshop/meter/syllables";

const IMAGERY_BUCKETS: Array<{ label: string; words: string[] }> = [
  { label: "water imagery",   words: ["river", "sea", "ocean", "wave", "tide", "rain", "lake", "pond", "shore", "stream", "salt", "drowning", "current", "harbor"] },
  { label: "sky & light",     words: ["sun", "moon", "star", "sky", "dawn", "dusk", "shadow", "light", "dark", "shine", "glow", "cloud", "horizon", "burn"] },
  { label: "nature & growth", words: ["tree", "leaf", "leaves", "flower", "root", "branch", "garden", "field", "grass", "seed", "bloom", "forest", "moss", "stone"] },
  { label: "the body",        words: ["skin", "hand", "breath", "eye", "eyes", "heart", "blood", "tongue", "bone", "mouth", "voice", "throat", "lungs"] },
  { label: "time & memory",   words: ["year", "day", "night", "hour", "season", "winter", "summer", "memory", "remember", "past", "before", "after", "always", "never"] },
  { label: "rooms & objects", words: ["window", "door", "table", "glass", "wall", "house", "room", "chair", "kitchen", "bed", "letter", "photo", "mirror"] },
  { label: "fire & warmth",   words: ["fire", "flame", "smoke", "ash", "ember", "burn", "candle", "warm", "cold", "ice", "frost", "kindle"] },
];

const STOP_PUNCT = /[.!?,:;—–]\s*"?$/;

export interface VoiceFingerprint {
  poemCount: number;
  tags: string[];
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

function tally(records: PoemRecord[]): VoiceFingerprint {
  const tags: string[] = [];
  if (records.length === 0) return { poemCount: 0, tags };

  // Bucket counts.
  const bucketCounts = new Array<number>(IMAGERY_BUCKETS.length).fill(0);
  let totalSylSamples = 0;
  let totalSyl = 0;
  let endStopHits = 0;
  let endLineSamples = 0;
  let totalLines = 0;

  for (const p of records) {
    const body = (p.body ?? "").trim();
    if (!body) continue;
    const lines = body.split(/\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      totalLines++;
      const tokens = tokenize(trimmed);
      for (let i = 0; i < IMAGERY_BUCKETS.length; i++) {
        const bucket = IMAGERY_BUCKETS[i]!;
        for (const t of tokens) {
          if (bucket.words.includes(t)) { bucketCounts[i]!++; break; }
        }
      }
      const syl = countSyllablesInLine(trimmed);
      if (typeof syl === "number" && syl > 0) {
        totalSyl += syl;
        totalSylSamples++;
      }
      endLineSamples++;
      if (STOP_PUNCT.test(trimmed)) endStopHits++;
    }
  }

  // Imagery: top bucket if it covers ≥15% of non-empty lines.
  if (totalLines > 0) {
    let topIdx = -1;
    let topVal = 0;
    for (let i = 0; i < bucketCounts.length; i++) {
      if (bucketCounts[i]! > topVal) { topVal = bucketCounts[i]!; topIdx = i; }
    }
    if (topIdx >= 0 && topVal / totalLines >= 0.15) {
      tags.push(IMAGERY_BUCKETS[topIdx]!.label);
    }
  }

  // Line length tendency.
  if (totalSylSamples >= 6) {
    const avg = totalSyl / totalSylSamples;
    if (avg <= 6.5) tags.push("short lines");
    else if (avg >= 11.5) tags.push("long lines");
  }

  // End-stop vs enjambment.
  if (endLineSamples >= 6) {
    const stopRatio = endStopHits / endLineSamples;
    if (stopRatio >= 0.7) tags.push("end-stopped lines");
    else if (stopRatio <= 0.25) tags.push("enjambed lines");
  }

  return { poemCount: records.length, tags: tags.slice(0, 3) };
}

/** Top-level: read library and compute. Returns null if not enough data. */
export function computeVoiceFingerprint(): VoiceFingerprint | null {
  try {
    const lib = loadOrCreateLibrary();
    const meaningful = lib.poems.filter((p) => (p.body ?? "").trim().split(/\s+/).length >= 5);
    if (meaningful.length < 3) return null;
    const fp = tally(meaningful);
    if (fp.tags.length === 0) return null;
    return fp;
  } catch {
    return null;
  }
}
