/**
 * Web Worker: heavy poem analyses.
 *
 * Runs the heaviest pure analysis functions off the main thread so typing in
 * the editor doesn't compete with them for CPU. The main thread posts a
 * snapshot of the parsed lines + breadth + manual rhyme overrides; the worker
 * posts the bundled result back. Each request carries an id; the consuming
 * hook ignores any result whose id is older than the most recent request.
 *
 * Analyses bundled here all take pure data in and return pure data out — no
 * DOM, no React, no localStorage. Meter (needs the CMU lexicon) and document
 * stats stay on the main thread.
 */
import { analyzeRepetition } from "@/workshop/analysis/repeated-words";
import type { RepetitionAnalysis } from "@/workshop/analysis/repeated-words";
import { scanCliches } from "@/workshop/analysis/cliche-scan";
import type { ClicheHit } from "@/workshop/analysis/cliche-scan";
import {
  lightAssonanceClusters,
  lightConsonanceClusters,
  lightVowelTailClusters,
  roughRhymeClusters,
  stanzaGroupsFromScheme,
} from "@/workshop/rhyme/hints";
import type { RhymeCluster, StanzaClusterGroup } from "@/workshop/rhyme/hints";
import { detectRhymeScheme, type RhymeBreadth } from "@/workshop/rhyme/scheme";
import { detectInternalRhymes } from "@/workshop/rhyme/internal-rhymes";
import type { InternalRhymeMark } from "@/workshop/rhyme/internal-rhymes";

export interface HeavyAnalysisRequest {
  id: number;
  heavyLines: string[];
  rhymeBreadth: RhymeBreadth;
  manualRhymeLinks: string[];
  manualRhymeUnlinks: string[];
}

export interface HeavyAnalysisResult {
  id: number;
  repetition: RepetitionAnalysis;
  clicheHits: ClicheHit[];
  rhymeClusters: RhymeCluster[];
  vowelTailClusters: RhymeCluster[];
  assonanceClusters: RhymeCluster[];
  consonanceClusters: RhymeCluster[];
  heavyRhymeScheme: string[];
  stanzaRhymeGroups: StanzaClusterGroup[];
  internalRhymes: InternalRhymeMark[];
}

self.onmessage = (e: MessageEvent<HeavyAnalysisRequest>) => {
  const { id, heavyLines, rhymeBreadth, manualRhymeLinks, manualRhymeUnlinks } = e.data;

  const heavyRhymeScheme = detectRhymeScheme(
    heavyLines,
    rhymeBreadth,
    manualRhymeLinks,
    manualRhymeUnlinks,
  );

  const result: HeavyAnalysisResult = {
    id,
    repetition: analyzeRepetition(heavyLines),
    clicheHits: scanCliches(heavyLines),
    rhymeClusters: roughRhymeClusters(heavyLines),
    vowelTailClusters: lightVowelTailClusters(heavyLines),
    assonanceClusters: lightAssonanceClusters(heavyLines),
    consonanceClusters: lightConsonanceClusters(heavyLines),
    heavyRhymeScheme,
    stanzaRhymeGroups: stanzaGroupsFromScheme(heavyLines, heavyRhymeScheme),
    internalRhymes: detectInternalRhymes(heavyLines, rhymeBreadth),
  };

  (self as unknown as { postMessage: (m: HeavyAnalysisResult) => void }).postMessage(result);
};
