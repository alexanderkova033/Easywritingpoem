/**
 * React hook that wraps the heavy-analysis Web Worker.
 *
 * Owns one Worker instance for the component's lifetime. Each input change
 * fires a new request with a monotonically increasing id; results with an
 * older id than the most recent request are discarded (race protection).
 *
 * Falls back to a synchronous analysis on the main thread if Worker isn't
 * supported (older browsers, SSR, test environments).
 */
import { useEffect, useRef, useState } from "react";
import { analyzeRepetition } from "@/workshop/analysis/repeated-words";
import type { RepetitionAnalysis } from "@/workshop/analysis/repeated-words";
import type {
  HeavyAnalysisRequest,
  HeavyAnalysisResult,
} from "@/workshop/analysis/heavy-analysis-worker";

const EMPTY_REPETITION: RepetitionAnalysis = {
  words: [],
  phrases: [],
  anaphora: [],
  epistrophe: [],
};

export interface HeavyAnalysisOutput {
  repetition: RepetitionAnalysis;
}

const WORKER_SUPPORTED = typeof Worker !== "undefined";

export function useHeavyAnalysis(heavyLines: string[]): HeavyAnalysisOutput {
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);
  const lastSeenIdRef = useRef(-1);
  const [output, setOutput] = useState<HeavyAnalysisOutput>({
    repetition: EMPTY_REPETITION,
  });

  // Lazily create the worker once on mount; tear it down on unmount.
  useEffect(() => {
    if (!WORKER_SUPPORTED) return;
    const worker = new Worker(
      new URL("./heavy-analysis-worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    const onMessage = (e: MessageEvent<HeavyAnalysisResult>) => {
      const { id, repetition } = e.data;
      // Drop stale results — only commit the most recent request.
      if (id < lastSeenIdRef.current) return;
      lastSeenIdRef.current = id;
      setOutput({ repetition });
    };
    worker.addEventListener("message", onMessage);
    return () => {
      worker.removeEventListener("message", onMessage);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Fire a new request whenever the input lines change. The worker handles
  // the work in the background; the hook commits the latest result.
  useEffect(() => {
    if (!WORKER_SUPPORTED || !workerRef.current) {
      // Fallback: run synchronously on the main thread. Same behavior as
      // before the worker existed; covers older browsers and test envs.
      setOutput({ repetition: analyzeRepetition(heavyLines) });
      return;
    }
    const id = ++reqIdRef.current;
    const req: HeavyAnalysisRequest = { id, heavyLines };
    workerRef.current.postMessage(req);
  }, [heavyLines]);

  return output;
}
