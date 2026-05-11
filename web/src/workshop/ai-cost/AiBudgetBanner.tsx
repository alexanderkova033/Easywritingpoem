import { useEffect, useRef, useState } from "react";
import { subscribeAiBudgetEvent, type AiBudgetEvent, type AiBudgetReason } from "./aiBudgetBus";
import "./AiBudgetBanner.css";

interface DisplayState extends AiBudgetEvent {
  // a stable id so React reconciles dismissals correctly
  id: number;
}

let nextId = 1;

const TITLES: Record<AiBudgetReason, string> = {
  "user-monthly-cap": "Monthly AI limit reached",
  "global-daily-cap": "AI temporarily paused",
  "kill-switch":      "AI features disabled",
  "cooldown":         "Slow down for a moment",
};

const DETAIL: Record<AiBudgetReason, string> = {
  "user-monthly-cap":
    "You have used this month's free AI allowance ($2). It resets at the start of next month.",
  "global-daily-cap":
    "Total AI spending across all users hit today's safety cap. Service will resume after midnight UTC.",
  "kill-switch":
    "An administrator disabled AI features. Try again later.",
  "cooldown":
    "Please wait briefly before retrying — too many requests in a short time.",
};

function reasonClass(reason: AiBudgetReason): string {
  if (reason === "user-monthly-cap" || reason === "global-daily-cap" || reason === "kill-switch") {
    return "is-hard-cap";
  }
  return "is-warn";
}

function formatRetry(retryAfterSec?: number): string | null {
  if (!retryAfterSec || retryAfterSec <= 0) return null;
  if (retryAfterSec < 60) return `Retry in ${retryAfterSec}s.`;
  if (retryAfterSec < 3600) return `Retry in about ${Math.ceil(retryAfterSec / 60)} min.`;
  if (retryAfterSec < 86_400) return `Retry in about ${Math.ceil(retryAfterSec / 3600)} h.`;
  return `Retry in about ${Math.ceil(retryAfterSec / 86_400)} day(s).`;
}

const COOLDOWN_AUTO_DISMISS_MS = 6_000;

export function AiBudgetBanner() {
  const [current, setCurrent] = useState<DisplayState | null>(null);
  const dismissTimer = useRef<number | null>(null);

  useEffect(() => {
    return subscribeAiBudgetEvent((event) => {
      setCurrent((prev) => {
        // Prefer the most severe live message: hard caps outrank cooldowns.
        if (
          prev &&
          (prev.reason === "user-monthly-cap" ||
            prev.reason === "global-daily-cap" ||
            prev.reason === "kill-switch") &&
          event.reason === "cooldown"
        ) {
          return prev;
        }
        return { ...event, id: nextId++ };
      });
    });
  }, []);

  useEffect(() => {
    if (dismissTimer.current !== null) {
      window.clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    if (current?.reason === "cooldown") {
      dismissTimer.current = window.setTimeout(() => {
        setCurrent((c) => (c && c.reason === "cooldown" ? null : c));
      }, COOLDOWN_AUTO_DISMISS_MS);
    }
    return () => {
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };
  }, [current?.id, current?.reason]);

  if (!current) return null;

  const retryText = formatRetry(current.retryAfterSec);

  return (
    <div
      className={`ai-budget-banner ${reasonClass(current.reason)}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="ai-budget-banner-body">
        <p className="ai-budget-banner-title">{TITLES[current.reason]}</p>
        <p className="ai-budget-banner-text">{DETAIL[current.reason]}</p>
        {retryText ? <p className="ai-budget-banner-meta">{retryText}</p> : null}
      </div>
      <button
        type="button"
        className="small-btn ai-budget-banner-dismiss"
        onClick={() => setCurrent(null)}
      >
        Dismiss
      </button>
    </div>
  );
}
