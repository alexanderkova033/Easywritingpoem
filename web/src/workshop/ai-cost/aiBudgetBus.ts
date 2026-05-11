/**
 * Lightweight event bus for AI-cost banner messages.
 *
 * The browser-side fetch helpers post events here when the server rejects a
 * call because of the per-user monthly cap, the global daily kill switch, or
 * the cooldown. <AiBudgetBanner /> subscribes and renders an appropriate
 * notice. Kept as a CustomEvent target so any component can subscribe without
 * threading state through React context.
 */

export type AiBudgetReason =
  | "user-monthly-cap"
  | "global-daily-cap"
  | "kill-switch"
  | "cooldown";

export interface AiBudgetEvent {
  reason: AiBudgetReason;
  message: string;
  retryAfterSec?: number;
  endpoint?: string;
  at: number;
}

const EVENT_NAME = "ai-budget-event";
const bus = typeof window === "undefined" ? null : new EventTarget();

export function emitAiBudgetEvent(detail: Omit<AiBudgetEvent, "at">): void {
  if (!bus) return;
  const event: AiBudgetEvent = { ...detail, at: Date.now() };
  bus.dispatchEvent(new CustomEvent<AiBudgetEvent>(EVENT_NAME, { detail: event }));
}

export function subscribeAiBudgetEvent(
  handler: (event: AiBudgetEvent) => void,
): () => void {
  if (!bus) return () => {};
  const listener = (e: Event) => {
    const ce = e as CustomEvent<AiBudgetEvent>;
    handler(ce.detail);
  };
  bus.addEventListener(EVENT_NAME, listener);
  return () => bus.removeEventListener(EVENT_NAME, listener);
}

/**
 * Parse an unsuccessful /api/* response. Always returns the human-readable
 * error string; additionally fires a budget event if the server signalled a
 * structured reason (cap / cooldown / kill switch).
 */
export async function parseAiErrorAndNotify(
  response: Response,
  endpoint: string,
): Promise<{ message: string; retryAfterSec?: number; reason?: AiBudgetReason }> {
  let message = `HTTP ${response.status}`;
  let retryAfterSec: number | undefined;
  let reason: AiBudgetReason | undefined;

  try {
    const body = (await response.json()) as {
      error?: string;
      retryAfterSec?: number;
      reason?: string;
    };
    if (body?.error) message = body.error;
    if (typeof body.retryAfterSec === "number") retryAfterSec = body.retryAfterSec;
    if (
      body.reason === "user-monthly-cap" ||
      body.reason === "global-daily-cap" ||
      body.reason === "kill-switch" ||
      body.reason === "cooldown"
    ) {
      reason = body.reason;
    }
  } catch {
    /* ignore — fall through with the default message */
  }

  if (reason) {
    emitAiBudgetEvent({ reason, message, retryAfterSec, endpoint });
  }

  return { message, retryAfterSec, reason };
}
