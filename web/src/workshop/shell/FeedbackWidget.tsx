import "./FeedbackWidget.css";
import { useCallback, useEffect, useRef, useState } from "react";

// Change this to your preferred feedback destination:
// - A mailto address: "mailto:you@example.com"
// - A Google Form, Tally, or Typeform URL: "https://tally.so/r/yourform"
const FEEDBACK_HREF = "mailto:easywritingpoem@gmail.com";

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const openModal = useCallback(() => {
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  // Focus textarea when modal opens
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => textareaRef.current?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const submit = useCallback(() => {
    if (!text.trim()) return;
    if (FEEDBACK_HREF.startsWith("mailto:")) {
      const subject = encodeURIComponent("easywriting-poem — feedback");
      const body = encodeURIComponent(text.trim());
      window.open(`${FEEDBACK_HREF}?subject=${subject}&body=${body}`, "_blank");
    } else {
      window.open(FEEDBACK_HREF, "_blank");
    }
    setText("");
    setOpen(false);
  }, [text]);

  return (
    <>
      <button
        type="button"
        className="feedback-inline-btn"
        onClick={openModal}
        aria-label="Share feedback about easywriting-poem"
      >
        <span className="feedback-inline-btn-icon" aria-hidden="true">💬</span>
        Send feedback
      </button>

      {open ? (
        <div
          className="feedback-overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            className="feedback-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Share feedback"
          >
            <div className="feedback-modal-head">
              <h2 className="feedback-modal-title">Share feedback</h2>
              <button type="button" className="small-btn" onClick={close}>
                Close
              </button>
            </div>
            <p className="muted small feedback-modal-hint">
              Spotted a bug, missing a feature, or something that felt off? All reports welcome.
            </p>
            <textarea
              ref={textareaRef}
              className="feedback-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Your thoughts…"
              rows={5}
            />
            <div className="feedback-modal-actions">
              <button
                type="button"
                className="small-btn small-btn-primary"
                onClick={submit}
                disabled={!text.trim()}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
