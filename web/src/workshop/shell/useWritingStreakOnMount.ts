import { useEffect, useRef } from "react";
import { recordWriteToday } from "./writing-streak";

const MIN_BODY_CHARS = 15;

/**
 * Records today's writing streak entry once per mount, the first time the
 * poem body crosses a small substantive-content threshold. Idempotent within
 * the calendar day; cheap when already recorded.
 */
export function useWritingStreakOnMount(body: string): void {
  const recordedRef = useRef(false);
  useEffect(() => {
    if (recordedRef.current) return;
    if (body.trim().length < MIN_BODY_CHARS) return;
    recordedRef.current = true;
    recordWriteToday();
  }, [body]);
}
