import "./SpotlightTour.css";
import { useCallback, useEffect, useRef, useState } from "react";

// ── Step definitions ────────────────────────────────────────────────────────
interface TourStep {
  /** Matches data-tour-id attribute on the target element. */
  id: string;
  title: string;
  body: string;
  /** Where to place the tooltip relative to the highlighted element. */
  placement: "top" | "bottom" | "left" | "right";
  /** Extra padding around the highlighted element (px). */
  pad?: number;
}

const STEPS: TourStep[] = [
  {
    id: "poem-editor",
    title: "Your writing space",
    body: "Type your poem here. Autosaves to this browser as you type — nothing leaves your device. Press Enter for a new line; blank line between stanzas.",
    placement: "right",
    pad: 10,
  },
  {
    id: "format-toolbar",
    title: "Format & read",
    body: "Bold, italic, or strikethrough any word. The reading-mode button opens a distraction-free parchment view. Marks carry through to .docx export.",
    placement: "bottom",
    pad: 8,
  },
  {
    id: "topbar-actions",
    title: "Top bar",
    body: "Live save indicator, stats popover, templates, snapshots, and .docx export live here. Press Cmd+K (Ctrl+K on Windows) to search every action.",
    placement: "bottom",
    pad: 8,
  },
  {
    id: "rail-library",
    title: "Drafts & snapshots",
    body: "Keep many poems and switch instantly. Save a snapshot to lock a version — compare any two later, line by line, to see what changed.",
    placement: "right",
    pad: 8,
  },
  {
    id: "rail-background",
    title: "Background scenes",
    body: "Pick a backdrop behind the page — parchment, forest, summer, winter, and more. Seasonal themes change the whole mood of the workshop.",
    placement: "right",
    pad: 8,
  },
  {
    id: "rail-focus",
    title: "Focus mode",
    body: "Hide the rail and tools panel for a calm, full-bleed writing space. Toggle anytime — your draft stays open underneath.",
    placement: "right",
    pad: 8,
  },
  {
    id: "tool-buckets",
    title: "Your writing tools",
    body: "Every tool lives in one scrollable list, grouped into Overview, Sound, and Suggest. Tap any tool to expand it — word counts, rhyme, meter, repeats, plans and more all update live.",
    placement: "left",
    pad: 8,
  },
  {
    id: "tools-panel",
    title: "Live analysis",
    body: "Re-analyses on every keystroke. Hover any result for detail. Click a line number to jump there.",
    placement: "left",
    pad: 10,
  },
  {
    id: "ai-analysis",
    title: "AI feedback (optional)",
    body: "Paste an OpenAI or Anthropic API key to unlock scoring across six dimensions. Save a snapshot, edit, then compare — the AI shows what improved.",
    placement: "top",
    pad: 8,
  },
];

// ── Types ────────────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void;
}

interface Viewport { w: number; h: number }

const TOOLTIP_W = 300;
const TOOLTIP_MIN_H = 150;
const MARGIN = 12; // min gap between tooltip and viewport edge

// ── Helper: compute tooltip position ────────────────────────────────────────
function computeTooltipPos(
  rect: DOMRect,
  pad: number,
  placement: TourStep["placement"],
  vp: Viewport,
): { top: number; left: number; finalPlacement: TourStep["placement"] } {
  const rx = rect.left - pad;
  const ry = rect.top - pad;
  const rw = rect.width + pad * 2;
  const rh = rect.height + pad * 2;

  const spaceTop = ry - MARGIN;
  const spaceBottom = vp.h - (ry + rh) - MARGIN;
  const spaceLeft = rx - MARGIN;
  const spaceRight = vp.w - (rx + rw) - MARGIN;

  // Auto-placement fallback based on available space
  let finalPlacement = placement;
  if (placement === "top" && spaceTop < TOOLTIP_MIN_H) {
    finalPlacement = spaceBottom >= TOOLTIP_MIN_H ? "bottom" : "right";
  } else if (placement === "bottom" && spaceBottom < TOOLTIP_MIN_H) {
    finalPlacement = spaceTop >= TOOLTIP_MIN_H ? "top" : "right";
  } else if (placement === "left" && spaceLeft < TOOLTIP_W + MARGIN) {
    finalPlacement = spaceRight >= TOOLTIP_W + MARGIN ? "right" : "bottom";
  } else if (placement === "right" && spaceRight < TOOLTIP_W + MARGIN) {
    finalPlacement = spaceLeft >= TOOLTIP_W + MARGIN ? "left" : "bottom";
  }

  // Center tooltip along the cross-axis
  const cx = rx + rw / 2;
  const cy = ry + rh / 2;
  const GAP = 16;

  let top = 0;
  let left = 0;
  switch (finalPlacement) {
    case "top":
      top = ry - GAP - TOOLTIP_MIN_H;
      left = Math.max(MARGIN, Math.min(cx - TOOLTIP_W / 2, vp.w - TOOLTIP_W - MARGIN));
      break;
    case "bottom":
      top = ry + rh + GAP;
      left = Math.max(MARGIN, Math.min(cx - TOOLTIP_W / 2, vp.w - TOOLTIP_W - MARGIN));
      break;
    case "left":
      top = Math.max(MARGIN, Math.min(cy - TOOLTIP_MIN_H / 2, vp.h - TOOLTIP_MIN_H - MARGIN));
      left = rx - GAP - TOOLTIP_W;
      break;
    case "right":
      top = Math.max(MARGIN, Math.min(cy - TOOLTIP_MIN_H / 2, vp.h - TOOLTIP_MIN_H - MARGIN));
      left = rx + rw + GAP;
      break;
  }

  // Clamp
  top = Math.max(MARGIN, Math.min(top, vp.h - TOOLTIP_MIN_H - MARGIN));
  left = Math.max(MARGIN, Math.min(left, vp.w - TOOLTIP_W - MARGIN));

  return { top, left, finalPlacement };
}

/** Find the nearest scrollable ancestor of a given element. */
function nearestScrollable(el: Element | null): Element | null {
  while (el && el !== document.documentElement) {
    const style = window.getComputedStyle(el);
    const overflow = style.overflowY;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  return document.documentElement;
}

// ── Component ────────────────────────────────────────────────────────────────
export function SpotlightTour({ onClose }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [vp, setVp] = useState<Viewport>({
    w: window.innerWidth,
    h: window.innerHeight,
  });
  const [animDir, setAnimDir] = useState<"next" | "prev">("next");
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<SVGSVGElement | null>(null);

  const step = STEPS[stepIndex]!;
  const pad = step.pad ?? 10;

  // Update target rect when step changes or viewport resizes.
  const updateRect = useCallback(() => {
    setVp({ w: window.innerWidth, h: window.innerHeight });
    const el = document.querySelector(`[data-tour-id="${STEPS[stepIndex]!.id}"]`);
    if (!el) { setRect(null); return; }
    // Scroll element into view so getBoundingClientRect reflects visible coords.
    el.scrollIntoView({ block: "nearest", behavior: "instant" });
    // Measure on the next frame so any triggered layout is settled.
    requestAnimationFrame(() => {
      setRect(el.getBoundingClientRect() as DOMRect);
    });
  }, [stepIndex]);

  useEffect(() => {
    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [updateRect]);

  // Focus the tooltip for keyboard access.
  useEffect(() => {
    tooltipRef.current?.focus();
  }, [stepIndex]);

  // Keyboard navigation.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        if (stepIndex < STEPS.length - 1) {
          setAnimDir("next");
          setStepIndex((i) => i + 1);
        }
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        if (stepIndex > 0) {
          setAnimDir("prev");
          setStepIndex((i) => i - 1);
        }
      }
    },
    [stepIndex, onClose],
  );

  const goNext = () => {
    if (stepIndex < STEPS.length - 1) {
      setAnimDir("next");
      setStepIndex((i) => i + 1);
    } else {
      onClose();
    }
  };
  const goPrev = () => {
    if (stepIndex > 0) {
      setAnimDir("prev");
      setStepIndex((i) => i - 1);
    }
  };
  const restart = () => {
    setAnimDir("prev");
    setStepIndex(0);
  };

  const isLast = stepIndex === STEPS.length - 1;

  /**
   * Forward wheel events from the dim overlay to the underlying scrollable
   * container so users can scroll the page while the tour is active.
   */
  const onOverlayWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    const svg = overlayRef.current;
    if (!svg) return;
    // Temporarily remove pointer events so elementFromPoint sees through
    svg.style.pointerEvents = "none";
    const underneath = document.elementFromPoint(e.clientX, e.clientY);
    svg.style.pointerEvents = "";
    const scrollable = nearestScrollable(underneath);
    if (scrollable) {
      scrollable.scrollBy({ top: e.deltaY, left: e.deltaX, behavior: "auto" });
    }
  }, []);

  // ── Spotlight geometry ──────────────────────────────────────────────────
  const fallbackRect = { x: vp.w / 2 - 80, y: vp.h / 2 - 60, width: 160, height: 120 };
  const r = rect ?? fallbackRect;
  const rx = r.x - pad;
  const ry = r.y - pad;
  const rw = r.width + pad * 2;
  const rh = r.height + pad * 2;
  const cornerR = 12;

  // Tooltip position
  const { top: ttTop, left: ttLeft } = rect
    ? computeTooltipPos(rect, pad, step.placement, vp)
    : { top: vp.h / 2 + 80, left: vp.w / 2 - TOOLTIP_W / 2 };

  return (
    <div
      className="spotlight-tour"
      role="dialog"
      aria-modal="true"
      aria-label={`Tour step ${stepIndex + 1} of ${STEPS.length}: ${step.title}`}
      onKeyDown={onKeyDown}
    >
      {/* ── Dim overlay with SVG spotlight ── */}
      <svg
        ref={overlayRef}
        className="spotlight-overlay"
        viewBox={`0 0 ${vp.w} ${vp.h}`}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        onWheel={onOverlayWheel}
      >
        <defs>
          <mask id="spotlight-mask">
            {/* White = visible (dim colour shows); Black = hole (transparent) */}
            <rect width={vp.w} height={vp.h} fill="white" />
            <rect
              x={rx}
              y={ry}
              width={rw}
              height={rh}
              rx={cornerR}
              ry={cornerR}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width={vp.w}
          height={vp.h}
          fill="rgba(0,0,0,0.72)"
          mask="url(#spotlight-mask)"
        />
        {/* Accent ring around the highlight */}
        <rect
          x={rx - 1.5}
          y={ry - 1.5}
          width={rw + 3}
          height={rh + 3}
          rx={cornerR + 1.5}
          ry={cornerR + 1.5}
          fill="none"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="1.5"
        />
      </svg>

      {/* ── Tooltip card ── */}
      <div
        ref={tooltipRef}
        className={`spotlight-tooltip spotlight-tooltip--${step.placement} spotlight-anim--${animDir}`}
        style={{ top: ttTop, left: ttLeft, width: TOOLTIP_W }}
        tabIndex={-1}
      >
        {/* Step counter */}
        <div className="spotlight-step-row">
          <span className="spotlight-step-count">
            {stepIndex + 1} / {STEPS.length}
          </span>
          <div className="spotlight-step-row-end">
            {!isLast && (
              <button
                type="button"
                className="spotlight-skip"
                onClick={onClose}
              >
                Skip tour
              </button>
            )}
            <button
              type="button"
              className="spotlight-close"
              onClick={onClose}
              aria-label="Close tour"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="spotlight-content-wrap">
          <h3 className="spotlight-title">{step.title}</h3>
          <p className="spotlight-body">{step.body}</p>
        </div>

        {/* Progress dots */}
        <div className="spotlight-dots" role="list" aria-label="Tour steps">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="listitem"
              className={`spotlight-dot${i === stepIndex ? " is-active" : ""}`}
              aria-label={`Go to step ${i + 1}: ${s.title}`}
              aria-current={i === stepIndex ? "step" : undefined}
              onClick={() => {
                setAnimDir(i > stepIndex ? "next" : "prev");
                setStepIndex(i);
              }}
            />
          ))}
        </div>

        {/* Navigation */}
        <div className="spotlight-nav">
          {isLast ? (
            <button
              type="button"
              className="spotlight-btn spotlight-btn-prev"
              onClick={restart}
            >
              ↺ Restart
            </button>
          ) : (
            <button
              type="button"
              className="spotlight-btn spotlight-btn-prev"
              onClick={goPrev}
              disabled={stepIndex === 0}
            >
              ← Back
            </button>
          )}
          <button
            type="button"
            className="spotlight-btn spotlight-btn-next"
            onClick={goNext}
          >
            {isLast ? "Done" : "Next →"}
          </button>
        </div>

        {/* Keyboard hint */}
        <div className="spotlight-kbd-hint" aria-hidden>
          <kbd>←</kbd> <kbd>→</kbd> navigate · <kbd>Esc</kbd> close
        </div>
      </div>
    </div>
  );
}
