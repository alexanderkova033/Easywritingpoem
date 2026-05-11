import type { FocusEvent, PointerEvent, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  readUiHoverHintsEnabled,
  writeUiHoverHintsEnabled,
} from "./hoverHintsStorage";

/** Wait before showing — feels intentional, not twitchy. */
const HOVER_HINT_DELAY_MS = 550;
/** Brief delay before hiding when the pointer leaves — reduces flicker at control edges. */
const POINTER_LEAVE_GRACE_MS = 160;
/** If `transitionend` does not fire, force unmount. */
const EXIT_FALLBACK_MS = 240;

export const UI_HOVER_HINT_DOM_ID = "easy-poems-ui-hover-hint";
const PREV_DESCRIBEDBY_ATTR = "data-eph-prev-describedby";

type BubbleState = {
  text: string;
  anchorLeft: number;
  anchorRight: number;
  anchorBottom: number;
};

type TipModel =
  | null
  | {
      data: BubbleState;
      phase: "shown" | "hiding";
    };

type HoverHintsContextValue = {
  enabled: boolean;
  setEnabled: (next: boolean | ((prev: boolean) => boolean)) => void;
  arm: (el: HTMLElement, text: string) => void;
  disarm: () => void;
  schedulePointerLeave: () => void;
};

const HoverHintsContext = createContext<HoverHintsContextValue | null>(null);

function useMediaQueryHover(): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(hover: hover)").matches;
  });

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover)");
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return matches;
}

function attachDescribedBy(el: HTMLElement) {
  const prev = el.getAttribute("aria-describedby");
  if (prev && prev !== UI_HOVER_HINT_DOM_ID) {
    el.setAttribute(PREV_DESCRIBEDBY_ATTR, prev);
  }
  el.setAttribute("aria-describedby", UI_HOVER_HINT_DOM_ID);
}

function detachDescribedBy(el: HTMLElement | null) {
  if (!el?.isConnected) return;
  const stored = el.getAttribute(PREV_DESCRIBEDBY_ATTR);
  el.removeAttribute(PREV_DESCRIBEDBY_ATTR);
  if (stored) {
    el.setAttribute("aria-describedby", stored);
  } else {
    const cur = el.getAttribute("aria-describedby");
    if (cur === UI_HOVER_HINT_DOM_ID) {
      el.removeAttribute("aria-describedby");
    }
  }
}

export function HoverHintsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(() => readUiHoverHintsEnabled());
  const [tip, setTipState] = useState<TipModel>(null);
  const tipRef = useRef<TipModel>(null);
  const armTimerRef = useRef<number | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const leaveGraceTimerRef = useRef<number | null>(null);
  const describedTargetRef = useRef<HTMLElement | null>(null);

  const commitTip = useCallback((next: TipModel) => {
    tipRef.current = next;
    setTipState(next);
  }, []);

  const clearArmTimer = useCallback(() => {
    if (armTimerRef.current != null) {
      window.clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
  }, []);

  const clearLeaveGrace = useCallback(() => {
    if (leaveGraceTimerRef.current != null) {
      window.clearTimeout(leaveGraceTimerRef.current);
      leaveGraceTimerRef.current = null;
    }
  }, []);

  const disarmImmediate = useCallback(() => {
    clearLeaveGrace();
    clearArmTimer();
    if (describedTargetRef.current) {
      detachDescribedBy(describedTargetRef.current);
      describedTargetRef.current = null;
    }
    targetRef.current = null;
    commitTip(null);
  }, [clearArmTimer, clearLeaveGrace, commitTip]);

  const beginSoftHide = useCallback(() => {
    const cur = tipRef.current;
    if (cur?.phase === "shown") {
      commitTip({ data: cur.data, phase: "hiding" });
    } else if (!cur) {
      targetRef.current = null;
    }
  }, [commitTip]);

  const schedulePointerLeave = useCallback(() => {
    clearArmTimer();
    clearLeaveGrace();
    if (tipRef.current?.phase === "shown") {
      leaveGraceTimerRef.current = window.setTimeout(() => {
        leaveGraceTimerRef.current = null;
        beginSoftHide();
      }, POINTER_LEAVE_GRACE_MS);
    } else {
      targetRef.current = null;
    }
  }, [clearArmTimer, clearLeaveGrace, beginSoftHide]);

  const onBubbleExitComplete = useCallback(() => {
    if (describedTargetRef.current) {
      detachDescribedBy(describedTargetRef.current);
      describedTargetRef.current = null;
    }
    targetRef.current = null;
    commitTip(null);
  }, [commitTip]);

  const arm = useCallback(
    (el: HTMLElement, text: string) => {
      if (!enabled) return;
      clearLeaveGrace();
      clearArmTimer();

      const prevTarget = targetRef.current;
      targetRef.current = el;
      const sameTarget = prevTarget === el;

      if (tipRef.current?.phase === "shown" && sameTarget) {
        return;
      }

      if (tipRef.current) {
        if (describedTargetRef.current) {
          detachDescribedBy(describedTargetRef.current);
          describedTargetRef.current = null;
        }
        commitTip(null);
      }

      const trimmed = text.trim();
      if (!trimmed) {
        targetRef.current = null;
        return;
      }

      armTimerRef.current = window.setTimeout(() => {
        armTimerRef.current = null;
        if (targetRef.current !== el) return;
        const r = el.getBoundingClientRect();
        const next: BubbleState = {
          text: trimmed,
          anchorLeft: r.left,
          anchorRight: r.right,
          anchorBottom: r.bottom,
        };
        commitTip({ data: next, phase: "shown" });
        describedTargetRef.current = el;
      }, HOVER_HINT_DELAY_MS);
    },
    [enabled, clearArmTimer, clearLeaveGrace, commitTip],
  );

  useEffect(() => {
    if (!enabled) disarmImmediate();
  }, [enabled, disarmImmediate]);

  useEffect(() => {
    if (tip?.phase === "shown" && describedTargetRef.current) {
      attachDescribedBy(describedTargetRef.current);
    } else if (tip?.phase === "hiding" && describedTargetRef.current) {
      detachDescribedBy(describedTargetRef.current);
      describedTargetRef.current = null;
    }
  }, [tip]);

  const setEnabled = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setEnabledState((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        return resolved;
      });
      disarmImmediate();
    },
    [disarmImmediate],
  );

  useEffect(() => {
    writeUiHoverHintsEnabled(enabled);
  }, [enabled]);

  useEffect(() => {
    if (!tip) return;
    const hide = () => disarmImmediate();
    const scrollOpts: AddEventListenerOptions = { passive: true, capture: true };
    window.addEventListener("scroll", hide, scrollOpts);
    window.addEventListener("resize", hide, { passive: true });
    return () => {
      window.removeEventListener("scroll", hide, scrollOpts);
      window.removeEventListener("resize", hide);
    };
  }, [tip, disarmImmediate]);

  const value = useMemo(
    () => ({
      enabled,
      setEnabled,
      arm,
      disarm: disarmImmediate,
      schedulePointerLeave,
    }),
    [enabled, setEnabled, arm, disarmImmediate, schedulePointerLeave],
  );

  return (
    <HoverHintsContext.Provider value={value}>
      {children}
      {tip ? (
        <HoverHintBubble
          data={tip.data}
          phase={tip.phase}
          onExitComplete={onBubbleExitComplete}
        />
      ) : null}
    </HoverHintsContext.Provider>
  );
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function HoverHintBubble({
  data,
  phase,
  onExitComplete,
}: {
  data: BubbleState;
  phase: "shown" | "hiding";
  onExitComplete: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const exitedRef = useRef(false);

  const finishExit = useCallback(() => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    onExitComplete();
  }, [onExitComplete]);

  useLayoutEffect(() => {
    exitedRef.current = false;
  }, [data.text]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const pad = 12;
    const mid = (data.anchorLeft + data.anchorRight) / 2;
    const { width, height } = el.getBoundingClientRect();
    let left = mid - width / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));
    const top = Math.min(
      data.anchorBottom + 10,
      window.innerHeight - height - pad,
    );
    const topClamped = Math.max(pad * 0.75, top);
    el.style.left = `${left}px`;
    el.style.top = `${topClamped}px`;

    if (phase === "hiding") {
      el.classList.remove("is-visible");
    } else {
      el.classList.remove("is-visible");
      const reveal = () => el.classList.add("is-visible");
      if (prefersReducedMotion()) {
        reveal();
      } else {
        requestAnimationFrame(reveal);
      }
    }
  }, [data, phase]);

  useEffect(() => {
    if (phase !== "hiding") return;
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      finishExit();
      return;
    }
    const t = window.setTimeout(finishExit, EXIT_FALLBACK_MS);
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== "opacity") return;
      el.removeEventListener("transitionend", onEnd);
      window.clearTimeout(t);
      finishExit();
    };
    el.addEventListener("transitionend", onEnd);
    return () => {
      el.removeEventListener("transitionend", onEnd);
      window.clearTimeout(t);
    };
  }, [phase, finishExit]);

  return createPortal(
    <div
      ref={ref}
      id={UI_HOVER_HINT_DOM_ID}
      role="tooltip"
      className={`ui-hover-hint-bubble ${phase === "hiding" ? "is-hiding" : ""}`}
    >
      {data.text}
    </div>,
    document.body,
  );
}

export function useHoverHintsSettings() {
  const ctx = useContext(HoverHintsContext);
  if (!ctx) {
    throw new Error("useHoverHintsSettings must be used within HoverHintsProvider");
  }
  return { enabled: ctx.enabled, setEnabled: ctx.setEnabled };
}

type HintBind = {
  title: string | undefined;
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
};

export function useHoverHintBinder() {
  const ctx = useContext(HoverHintsContext);
  const canHover = useMediaQueryHover();

  if (!ctx) {
    throw new Error("useHoverHintBinder must be used within HoverHintsProvider");
  }

  const { enabled, arm, disarm, schedulePointerLeave } = ctx;

  return useCallback(
    (description: string | undefined | null): HintBind => {
      const text = description?.trim() || "";
      if (!text) return { title: undefined };

      const useNativeTitle = !enabled || !canHover;
      if (useNativeTitle) {
        return { title: text };
      }

      return {
        title: undefined,
        onPointerEnter: (e: PointerEvent<HTMLElement>) => {
          arm(e.currentTarget, text);
        },
        onPointerLeave: () => {
          schedulePointerLeave();
        },
        onFocus: (e: FocusEvent<HTMLElement>) => {
          arm(e.currentTarget, text);
        },
        onBlur: () => {
          disarm();
        },
      };
    },
    [enabled, canHover, arm, disarm, schedulePointerLeave],
  );
}
