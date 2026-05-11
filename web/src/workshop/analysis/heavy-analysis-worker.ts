/**
 * Web Worker: heavy poem analyses.
 *
 * Runs the heaviest pure analysis functions off the main thread so typing in
 * the editor doesn't compete with them for CPU. The main thread posts a
 * snapshot of the parsed lines + breadth; the worker posts the bundled result
 * back. Each request carries an id; the consuming hook ignores any result
 * whose id is older than the most recent request.
 *
 * Currently bundles: repetition analysis. Other heavy analyses (rhyme
 * clusters, cliché scan, internal rhymes) can be added to the same request
 * without changing the wire protocol — extend the `Result` type.
 */
import { analyzeRepetition } from "@/workshop/analysis/repeated-words";
import type { RepetitionAnalysis } from "@/workshop/analysis/repeated-words";

export interface HeavyAnalysisRequest {
  id: number;
  heavyLines: string[];
}

export interface HeavyAnalysisResult {
  id: number;
  repetition: RepetitionAnalysis;
}

self.onmessage = (e: MessageEvent<HeavyAnalysisRequest>) => {
  const { id, heavyLines } = e.data;
  const repetition = analyzeRepetition(heavyLines);
  const result: HeavyAnalysisResult = { id, repetition };
  (self as unknown as { postMessage: (m: HeavyAnalysisResult) => void }).postMessage(result);
};
