import { useEffect, useRef, useState } from "react";

/**
 * Loading indicator for AI analysis that *moves* the whole time.
 *
 * The model spends most of the wait on hidden reasoning tokens that emit no
 * streamed content, so a static "Reading…" label sits dead for many seconds.
 * This component drives perceived progress two ways:
 *   1. An elapsed-time phase stepper — the label advances on its own, so there
 *      is always movement even while the reasoning phase streams nothing. Works
 *      for both the streaming analyze path and the non-streaming compare path.
 *   2. The real streamed-char signal (analyze only) — once actual output tokens
 *      arrive, the label honestly flips to "Writing the feedback…" and the bar
 *      jumps forward, because the model is now producing visible text.
 *
 * The bar is an asymptotic fill (the NProgress / YouTube pattern): it eases
 * toward ~92% but never claims completion, so it never lies about being done.
 */

const TICK_MS = 250;

function phaseLabel(mode: "fresh" | "compare", elapsedMs: number, streaming: boolean): string {
  // Real output tokens are arriving — the model is past reasoning and composing.
  if (streaming) return "Writing the feedback…";
  if (elapsedMs < 2500) return "Reading the lines…";
  if (elapsedMs < 7000) {
    return mode === "compare" ? "Re-weighing your changes…" : "Weighing craft, spark & echo…";
  }
  if (elapsedMs < 14000) return "Scoring the four pillars…";
  return "Almost there — composing the notes…";
}

export function AiLoadingIndicator({
  mode,
  streamedChars,
}: {
  mode: "fresh" | "compare";
  /** Characters of model output received so far (0 until tokens start streaming). */
  streamedChars: number;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    startRef.current = performance.now();
    setElapsedMs(0);
    const id = setInterval(() => {
      if (startRef.current != null) setElapsedMs(performance.now() - startRef.current);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const streaming = streamedChars > 0;

  // Asymptotic ease toward 92% from elapsed time, so the bar always creeps
  // forward. Once real tokens arrive, floor it at 70% and let the char count
  // push it the rest of the way — visible text means we're genuinely close.
  const timePct = 92 * (1 - Math.exp(-elapsedMs / 9000));
  const charPct = streaming ? Math.min(96, 70 + streamedChars / 60) : 0;
  const pct = Math.max(timePct, charPct);

  return (
    <div className="ai-loading" role="status" aria-live="polite">
      <span className="ai-loading-pulse" aria-hidden />
      <span className="ai-loading-dot" aria-hidden />
      <span className="ai-loading-dot" aria-hidden />
      <span className="ai-loading-dot" aria-hidden />
      <span className="ai-loading-label">{phaseLabel(mode, elapsedMs, streaming)}</span>
      <span className="ai-loading-bar" aria-hidden>
        <span className="ai-loading-bar-fill" style={{ width: `${pct.toFixed(1)}%` }} />
      </span>
    </div>
  );
}
