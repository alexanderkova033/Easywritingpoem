import { useEffect, useState } from "react";
import "./RhymeTooltip.css";

const SHOWN_KEY = "easy-poems:rhyme-tooltip-shown";

function alreadyShown(): boolean {
  try { return !!localStorage.getItem(SHOWN_KEY); } catch { return false; }
}

export function RhymeTooltip({ sampleActive }: { sampleActive: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!sampleActive) return;
    if (alreadyShown()) return;
    const t = setTimeout(() => setVisible(true), 1800);
    return () => clearTimeout(t);
  }, [sampleActive]);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(SHOWN_KEY, "1"); } catch { /* ignore */ }
  };

  // Auto-dismiss after 7 seconds
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(dismiss, 7000);
    return () => clearTimeout(t);
  }, [visible]);

  // Mark as shown whenever sample is dismissed
  useEffect(() => {
    if (sampleActive) return;
    try { localStorage.setItem(SHOWN_KEY, "1"); } catch { /* ignore */ }
    // also watch for the sample-dismissed key being set
  }, [sampleActive]);

  if (!visible) return null;

  return (
    <div className="rhyme-tooltip" role="status" aria-live="polite">
      <button className="rhyme-tooltip-close" type="button" onClick={dismiss} aria-label="Dismiss">✕</button>
      <p className="rhyme-tooltip-text">
        <strong>← Those are your end rhymes.</strong>{" "}
        A matches A, B matches B — the labels update as you type.
      </p>
    </div>
  );
}
