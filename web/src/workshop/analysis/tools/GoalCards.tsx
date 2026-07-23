import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canonicaliseRhymeScheme } from "@/workshop/goals/types";
import { JumpLineList, NumberInput, SoftPill } from "./shared";

export function MetricGoalCard({
  label,
  current,
  hint,
  isSoft,
  onToggleSoft,
  targetValue,
  rangeMin,
  rangeMax,
  onSetTarget,
  onSetRange,
}: {
  label: string;
  current: number;
  hint?: string;
  isSoft: boolean;
  onToggleSoft: () => void;
  targetValue: number | undefined;
  rangeMin: number | undefined;
  rangeMax: number | undefined;
  onSetTarget: (v: number | undefined) => void;
  onSetRange: (min: number | undefined, max: number | undefined) => void;
}) {
  const hasTarget = targetValue != null;
  const hasRange = rangeMin != null || rangeMax != null;
  const hasGoal = hasTarget || hasRange;

  const [mode, setMode] = useState<"exact" | "range">(
    hasRange && !hasTarget ? "range" : "exact",
  );
  useEffect(() => {
    if (hasRange && !hasTarget) setMode("range");
    else if (hasTarget) setMode("exact");
  }, [hasRange, hasTarget]);

  const met = hasTarget
    ? current === targetValue
    : hasRange
      ? (rangeMin == null || current >= rangeMin) &&
        (rangeMax == null || current <= rangeMax)
      : false;
  const over = hasTarget
    ? current > (targetValue as number)
    : rangeMax != null && current > rangeMax;
  const under = hasTarget
    ? current < (targetValue as number)
    : rangeMin != null && current < rangeMin;

  const statusClass = !hasGoal
    ? "goal-card--unset"
    : met
      ? "goal-card--met"
      : over
        ? "goal-card--over"
        : under
          ? "goal-card--under"
          : "";

  let pct: number | null = null;
  if (hasTarget && (targetValue as number) > 0) {
    pct = Math.min(1, current / (targetValue as number));
  } else if (hasRange) {
    const ref = rangeMax ?? rangeMin;
    if (ref && ref > 0) pct = Math.min(1, current / ref);
  }

  const toggleMode = () => {
    if (mode === "exact") {
      if (hasTarget) {
        onSetRange(targetValue, targetValue);
        onSetTarget(undefined);
      }
      setMode("range");
    } else {
      const seed = rangeMin ?? rangeMax;
      if (seed != null) onSetTarget(seed);
      onSetRange(undefined, undefined);
      setMode("exact");
    }
  };

  const clearGoal = () => {
    onSetTarget(undefined);
    onSetRange(undefined, undefined);
  };

  return (
    <div className={`goal-card ${statusClass}`} title={hint}>
      <div className="goal-card-header">
        <span className="goal-card-label">{label}</span>
        {hasGoal ? (
          <button
            type="button"
            className="goal-card-clear"
            onClick={clearGoal}
            aria-label={`Clear ${label} plan`}
            title="Clear"
          >
            ×
          </button>
        ) : null}
      </div>

      <div className="goal-card-value-row">
        <span className="goal-card-current">{current}</span>
        {hasTarget ? (
          <span
            className={`goal-card-of${met ? " goal-card-of--met" : over ? " goal-card-of--over" : ""}`}
          >
            / {targetValue}
          </span>
        ) : hasRange ? (
          <span className={`goal-card-of${met ? " goal-card-of--met" : ""}`}>
            in {rangeMin ?? "·"}–{rangeMax ?? "·"}
          </span>
        ) : (
          <span className="goal-card-of goal-card-of--unset">no plan</span>
        )}
      </div>

      {mode === "exact" ? (
        <NumberInput
          value={targetValue}
          onCommit={onSetTarget}
          ariaLabel={`${label} target`}
          withSteppers
        />
      ) : (
        <div className="goal-card-range">
          <NumberInput
            value={rangeMin}
            onCommit={(v) => onSetRange(v, rangeMax)}
            ariaLabel={`${label} minimum`}
            placeholder="min"
          />
          <span className="goal-card-range-sep" aria-hidden>
            –
          </span>
          <NumberInput
            value={rangeMax}
            onCommit={(v) => onSetRange(rangeMin, v)}
            ariaLabel={`${label} maximum`}
            placeholder="max"
          />
        </div>
      )}

      <div className="goal-card-footer">
        <div className="goal-card-mode" role="group" aria-label="Plan mode">
          <button
            type="button"
            className={`goal-card-mode-btn${mode === "exact" ? " is-active" : ""}`}
            onClick={() => mode !== "exact" && toggleMode()}
            aria-pressed={mode === "exact"}
          >
            Exact
          </button>
          <button
            type="button"
            className={`goal-card-mode-btn${mode === "range" ? " is-active" : ""}`}
            onClick={() => mode !== "range" && toggleMode()}
            aria-pressed={mode === "range"}
          >
            Range
          </button>
        </div>
        {hasGoal ? (
          <SoftPill soft={isSoft} onToggle={onToggleSoft} label={label} />
        ) : null}
      </div>

      {pct !== null ? (
        <div className="goal-card-bar" aria-hidden>
          <div
            className={`goal-card-bar-fill${met ? " goal-card-bar--met" : over ? " goal-card-bar--over" : ""}`}
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function SyllableCapCard({
  cap,
  overLines,
  goToLine,
  isSoft,
  onToggleSoft,
  onSet,
}: {
  cap: number | undefined;
  overLines: number[];
  goToLine: (n: number) => void;
  isSoft: boolean;
  onToggleSoft: () => void;
  onSet: (v: number | undefined) => void;
}) {
  const hasGoal = cap != null;
  const overCount = overLines.length;
  const met = hasGoal && overCount === 0;
  const over = hasGoal && overCount > 0;
  const statusClass = !hasGoal
    ? "goal-card--unset"
    : met
      ? "goal-card--met"
      : over
        ? "goal-card--over"
        : "";

  return (
    <div
      className={`goal-card goal-card--cap ${statusClass}`}
      title="Flag lines whose estimated syllable count exceeds this"
    >
      <div className="goal-card-header">
        <span className="goal-card-label">Syllable cap</span>
        {hasGoal ? (
          <button
            type="button"
            className="goal-card-clear"
            onClick={() => onSet(undefined)}
            aria-label="Clear syllable cap plan"
            title="Clear"
          >
            ×
          </button>
        ) : null}
      </div>

      <div className="goal-card-value-row">
        <span className="goal-card-current">{cap ?? "—"}</span>
        <span className="goal-card-of goal-card-of--cap">
          max syllables/line
        </span>
      </div>

      <NumberInput
        value={cap}
        onCommit={onSet}
        ariaLabel="Syllable cap"
        withSteppers
      />

      <div className="goal-card-footer">
        <span className="goal-card-footer-spacer" />
        {hasGoal ? (
          <SoftPill soft={isSoft} onToggle={onToggleSoft} label="syllable cap" />
        ) : null}
      </div>

      {hasGoal && overCount > 0 ? (
        <p className="goal-card-extra">
          {overCount} line{overCount === 1 ? "" : "s"} over cap:{" "}
          <JumpLineList lineNumbers={overLines} goToLine={goToLine} />
        </p>
      ) : hasGoal ? (
        <p className="goal-card-extra goal-card-extra--ok">
          ✓ No lines over cap
        </p>
      ) : null}
    </div>
  );
}

interface RhymeSchemePreset {
  label: string;
  value: string;
  hint: string;
  example: string[];
  perStanza?: boolean;
}

const RHYME_SCHEME_PRESETS: RhymeSchemePreset[] = [
  {
    label: "None",
    value: "",
    hint: "No rhyme-scheme plan",
    example: [],
  },
  {
    label: "AABB",
    value: "AABB",
    hint: "Couplets — pairs rhyme in turn",
    example: ["roses are red (A)", "violets are blue (A)", "sugar is sweet (B)", "and so are you (B)"],
    perStanza: true,
  },
  {
    label: "ABAB",
    value: "ABAB",
    hint: "Alternating — odd lines rhyme, even lines rhyme",
    example: ["the silver moon (A)", "in soft night air (B)", "rose high in June (A)", "without a care (B)"],
    perStanza: true,
  },
  {
    label: "ABBA",
    value: "ABBA",
    hint: "Enclosed — outer pair frames inner pair",
    example: ["the cat sat down (A)", "beside the dog (B)", "atop a log (B)", "in sleepy town (A)"],
    perStanza: true,
  },
  {
    label: "AABBA",
    value: "AABBA",
    hint: "Limerick — two long, two short, one long",
    example: ["a poet who lived in Peru (A)", "wrote poems that rarely were true (A)", "he scribbled all night (B)", "by candle and light (B)", "and laughed at his odd point of view (A)"],
  },
  {
    label: "Ballad",
    value: "ABCB",
    hint: "Ballad — lines 2 and 4 rhyme; 1 and 3 free",
    example: ["the wind came down (A)", "across the moor (B)", "she stood alone (C)", "beside the door (B)"],
    perStanza: true,
  },
  {
    label: "Sonnet",
    value: "ABABCDCDEFEFGG",
    hint: "Shakespearean sonnet — 3 quatrains + couplet",
    example: [
      "quatrain 1 (A)",
      "quatrain 1 (B)",
      "quatrain 1 (A)",
      "quatrain 1 (B)",
      "quatrains 2-3 follow CDCD, EFEF",
      "final couplet (G)",
      "final couplet (G)",
    ],
  },
];

const LETTER_HUES = [200, 30, 320, 140, 260, 0, 180, 60, 280, 100];
function letterColor(letter: string, alpha = 1): string {
  if (!letter) return "transparent";
  const idx = (letter.charCodeAt(0) - 65 + 26) % 26;
  const hue = LETTER_HUES[idx % LETTER_HUES.length]!;
  return `hsla(${hue}, 65%, 55%, ${alpha})`;
}

function nextLetter(current: string, pattern: string[]): string {
  const used = new Set(pattern.filter(Boolean));
  let maxCode = 64;
  for (const c of used) {
    const code = c.charCodeAt(0);
    if (code > maxCode) maxCode = code;
  }
  const palette: string[] = [];
  for (let c = 65; c <= maxCode + 1 && c <= 90; c++) {
    palette.push(String.fromCharCode(c));
  }
  if (palette.length === 0) palette.push("A");
  if (!current) return palette[0]!;
  const idx = palette.indexOf(current);
  if (idx < 0) return palette[0]!;
  return palette[(idx + 1) % palette.length]!;
}

export function RhymeSchemeCard({
  target,
  perStanza,
  matches,
  schemePerLine,
  onSet,
  onSetPerStanza,
  isSoft,
  onToggleSoft,
}: {
  target: string;
  perStanza: boolean;
  matches: boolean | null;
  schemePerLine: import("@/workshop/goals/metrics").SchemeLineCompare[];
  onSet: (scheme: string | undefined) => void;
  onSetPerStanza: (v: boolean) => void;
  isSoft: boolean;
  onToggleSoft: () => void;
}) {
  const slots = useMemo(() => {
    const canon = canonicaliseRhymeScheme(target);
    return canon ? canon.split("") : [];
  }, [target]);

  const [exampleFor, setExampleFor] = useState<string | null>(null);
  const [examplePos, setExamplePos] = useState<{ left: number; top: number } | null>(null);
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [paletteSlot, setPaletteSlot] = useState<number | null>(null);
  const [palettePos, setPalettePos] = useState<{ left: number; top: number } | null>(null);
  const slotRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const openExample = (label: string) => {
    const el = chipRefs.current[label];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setExamplePos({ left: rect.left, top: rect.bottom + 6 });
    setExampleFor(label);
  };
  const closeExample = (label: string) => {
    setExampleFor((s) => (s === label ? null : s));
  };
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState(target);
  useEffect(() => {
    setCustom(target);
  }, [target]);

  const commitSlots = (next: string[]) => {
    const joined = next.join("");
    const canon = canonicaliseRhymeScheme(joined);
    onSet(canon || undefined);
  };
  const setSlotLetter = (i: number, letter: string) => {
    const next = slots.slice();
    next[i] = letter;
    commitSlots(next);
  };
  const openPalette = (i: number) => {
    const el = slotRefs.current[i];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPalettePos({ left: rect.left, top: rect.bottom + 6 });
    setPaletteSlot(i);
  };
  const closePalette = () => {
    setPaletteSlot(null);
    setPalettePos(null);
  };
  const addSlot = () => {
    const cur = slots[slots.length - 1] ?? "";
    const nl = cur ? nextLetter(cur, slots) : "A";
    commitSlots([...slots, nl]);
  };
  const removeSlot = () => {
    if (slots.length === 0) return;
    commitSlots(slots.slice(0, -1));
  };
  const setLineCount = (n: number) => {
    if (!Number.isFinite(n) || n < 0) return;
    const capped = Math.min(40, Math.max(0, Math.floor(n)));
    if (capped === slots.length) return;
    if (capped < slots.length) {
      commitSlots(slots.slice(0, capped));
      return;
    }
    const next = slots.slice();
    while (next.length < capped) {
      const cur = next[next.length - 1] ?? "";
      next.push(cur ? nextLetter(cur, next) : "A");
    }
    commitSlots(next);
  };

  const usedLetters = useMemo(() => {
    const set = new Set<string>();
    for (const l of slots) if (l) set.add(l);
    return Array.from(set).sort();
  }, [slots]);

  useEffect(() => {
    if (paletteSlot === null) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      const slotEl = slotRefs.current[paletteSlot];
      if (slotEl && target && slotEl.contains(target)) return;
      const pal = document.getElementById("goal-scheme-palette");
      if (pal && target && pal.contains(target)) return;
      closePalette();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [paletteSlot]);

  const canonCustom = canonicaliseRhymeScheme(custom);
  const commitCustom = () => {
    const canon = canonicaliseRhymeScheme(custom);
    onSet(canon || undefined);
  };

  const hasGoal = target.length > 0;
  const statusClass = !hasGoal
    ? "goal-card--unset"
    : matches === true
      ? "goal-card--met"
      : matches === false
        ? "goal-card--over"
        : "";

  const activePreset = RHYME_SCHEME_PRESETS.find(
    (p) =>
      p.value &&
      target === p.value &&
      !!p.perStanza === perStanza,
  );

  return (
    <div className={`goal-card goal-card--scheme ${statusClass}`}>
      <div className="goal-card-header">
        <span className="goal-card-label">Rhyme scheme</span>
        {hasGoal ? (
          <button
            type="button"
            className="goal-card-clear"
            onClick={() => onSet(undefined)}
            aria-label="Clear rhyme scheme plan"
            title="Clear"
          >
            ×
          </button>
        ) : null}
      </div>

      <p className="goal-scheme-blurb muted small">
        Each letter is a rhyme group. Lines sharing a letter rhyme together.
      </p>

      <div className="goal-scheme-chips" role="group" aria-label="Rhyme scheme presets">
        {RHYME_SCHEME_PRESETS.map((p) => {
          const active =
            target === p.value && (!!p.perStanza === perStanza || p.value === "");
          const hasExample = p.example.length > 0;
          return (
            <button
              key={p.label}
              ref={(el) => {
                chipRefs.current[p.label] = el;
              }}
              type="button"
              className={`goal-scheme-chip${active ? " is-active" : ""}`}
              title={p.hint}
              onClick={() => {
                if (!p.value) {
                  onSet(undefined);
                  onSetPerStanza(false);
                  return;
                }
                onSet(p.value);
                onSetPerStanza(!!p.perStanza);
              }}
              onMouseEnter={() => hasExample && openExample(p.label)}
              onMouseLeave={() => closeExample(p.label)}
              onFocus={() => hasExample && openExample(p.label)}
              onBlur={() => closeExample(p.label)}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="goal-scheme-builder">
        <div className="goal-scheme-builder-label">
          <span>{activePreset?.label ?? "Pattern"}</span>
          <span className="goal-scheme-linecount">
            <span className="muted small">Lines</span>
            <button
              type="button"
              className="goal-scheme-linecount-btn"
              onClick={() => setLineCount(slots.length - 1)}
              disabled={slots.length === 0}
              aria-label="One fewer line"
            >
              −
            </button>
            <input
              type="number"
              className="goal-scheme-linecount-input"
              min={0}
              max={40}
              value={slots.length}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) setLineCount(v);
              }}
              aria-label="Number of lines"
            />
            <button
              type="button"
              className="goal-scheme-linecount-btn"
              onClick={() => setLineCount(slots.length + 1)}
              aria-label="One more line"
            >
              +
            </button>
          </span>
        </div>
        {slots.length > 0 ? (
          <p className="goal-scheme-builder-hint muted small">
            Click a slot to pick its rhyme group. Same letter = same rhyme.
          </p>
        ) : null}
        <div className="goal-scheme-slots" role="group" aria-label="Rhyme pattern slots">
          {slots.length === 0 ? (
            <span className="goal-scheme-slots-empty muted small">
              Set a line count or pick a preset above.
            </span>
          ) : (
            slots.map((letter, i) => (
              <button
                key={i}
                ref={(el) => {
                  slotRefs.current[i] = el;
                }}
                type="button"
                className={`goal-scheme-slot${paletteSlot === i ? " is-open" : ""}`}
                onClick={() => (paletteSlot === i ? closePalette() : openPalette(i))}
                style={{
                  background: letterColor(letter, 0.16),
                  borderColor: letterColor(letter, 0.55),
                  color: letterColor(letter, 1),
                }}
                title={`Line ${i + 1} · group ${letter || "—"} — click to choose`}
                aria-label={`Slot ${i + 1}: ${letter || "blank"}`}
                aria-haspopup="true"
                aria-expanded={paletteSlot === i}
              >
                <span className="goal-scheme-slot-num">{i + 1}</span>
                <span className="goal-scheme-slot-letter">{letter || "·"}</span>
              </button>
            ))
          )}
          <button
            type="button"
            className="goal-scheme-slot-btn"
            onClick={addSlot}
            title="Add a line slot"
            aria-label="Add slot"
          >
            +
          </button>
          {slots.length > 0 ? (
            <button
              type="button"
              className="goal-scheme-slot-btn goal-scheme-slot-btn--minus"
              onClick={removeSlot}
              title="Remove last slot"
              aria-label="Remove last slot"
            >
              −
            </button>
          ) : null}
        </div>
      </div>

      {hasGoal ? (
        <div
          className="goal-scheme-scope"
          role="radiogroup"
          aria-label="How the pattern applies"
        >
          <button
            type="button"
            role="radio"
            aria-checked={!perStanza}
            className={`goal-scheme-scope-btn${!perStanza ? " is-active" : ""}`}
            onClick={() => onSetPerStanza(false)}
            title="Pattern spans the whole poem"
          >
            Whole poem
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={perStanza}
            className={`goal-scheme-scope-btn${perStanza ? " is-active" : ""}`}
            onClick={() => onSetPerStanza(true)}
            title="Pattern repeats inside each stanza"
          >
            Each stanza
          </button>
        </div>
      ) : null}

      {hasGoal && schemePerLine.length > 0 ? (
        <div className="goal-scheme-preview">
          <div className="goal-scheme-preview-head muted small">
            Your end-words · colour = rhyme group
          </div>
          <ul className="goal-scheme-preview-list" aria-label="Detected end-words by rhyme group">
            {schemePerLine.map((row) => {
              const detLetter = row.detected || "";
              const expLetter = row.expected || "";
              return (
                <li
                  key={row.line}
                  className={`goal-scheme-preview-row${row.matches ? " is-match" : " is-miss"}`}
                  style={{
                    borderLeftColor: letterColor(detLetter, 0.7),
                  }}
                >
                  <span className="goal-scheme-preview-num">{row.line}</span>
                  <span
                    className="goal-scheme-preview-word"
                    style={{ color: letterColor(detLetter, 1) }}
                  >
                    {row.endWord || "—"}
                  </span>
                  <span
                    className="goal-scheme-preview-tag"
                    style={{
                      background: letterColor(detLetter, 0.18),
                      borderColor: letterColor(detLetter, 0.5),
                      color: letterColor(detLetter, 1),
                    }}
                    title={`Detected group ${detLetter || "—"}`}
                  >
                    {detLetter || "·"}
                  </span>
                  {expLetter ? (
                    <>
                      <span className="goal-scheme-preview-arrow" aria-hidden>
                        →
                      </span>
                      <span
                        className={`goal-scheme-preview-tag goal-scheme-preview-tag--target${row.matches ? " is-match" : " is-miss"}`}
                        style={{
                          background: letterColor(expLetter, 0.12),
                          borderColor: letterColor(expLetter, 0.5),
                          color: letterColor(expLetter, 1),
                        }}
                        title={`Wanted group ${expLetter}`}
                      >
                        {expLetter}
                      </span>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : hasGoal ? (
        <p className="muted small goal-scheme-empty">
          Write a few lines — they'll appear here colour-coded.
        </p>
      ) : null}

      <div className="goal-scheme-custom-toggle">
        <button
          type="button"
          className="linkish goal-scheme-custom-toggle-btn"
          onClick={() => setShowCustom((s) => !s)}
        >
          {showCustom ? "Hide" : "Type custom pattern"}
        </button>
      </div>
      {showCustom ? (
        <div className="goal-scheme-custom">
          <input
            type="text"
            className="goal-scheme-input"
            value={custom}
            placeholder="e.g. ABBA"
            spellCheck={false}
            onChange={(e) => setCustom(e.target.value.toUpperCase())}
            onBlur={commitCustom}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitCustom();
              }
            }}
            aria-label="Custom rhyme scheme"
          />
          {canonCustom && canonCustom !== target ? (
            <button
              type="button"
              className="linkish goal-scheme-apply"
              onClick={commitCustom}
            >
              Apply
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="goal-card-footer">
        <span className="goal-card-footer-spacer" />
        {hasGoal ? (
          <SoftPill
            soft={isSoft}
            onToggle={onToggleSoft}
            label="rhyme scheme"
          />
        ) : null}
      </div>

      {hasGoal && matches === true ? (
        <p className="goal-card-extra goal-card-extra--ok">✓ Scheme matches</p>
      ) : null}

      {paletteSlot !== null && palettePos
        ? (() => {
            const i = paletteSlot;
            const current = slots[i] ?? "";
            const newLetter = nextLetter(
              usedLetters[usedLetters.length - 1] ?? "",
              slots,
            );
            const maxLeft = Math.max(
              8,
              Math.min(palettePos.left, window.innerWidth - 260),
            );
            return createPortal(
              <div
                id="goal-scheme-palette"
                className="goal-scheme-palette"
                role="dialog"
                aria-label={`Choose rhyme group for line ${i + 1}`}
                style={{ left: maxLeft, top: palettePos.top }}
              >
                <div className="goal-scheme-palette-title muted small">
                  Line {i + 1} — rhymes with:
                </div>
                <div className="goal-scheme-palette-grid">
                  {usedLetters.map((L) => {
                    const linesWith = slots
                      .map((l, idx) => (l === L ? idx + 1 : 0))
                      .filter(Boolean);
                    const active = L === current;
                    return (
                      <button
                        key={L}
                        type="button"
                        className={`goal-scheme-palette-btn${active ? " is-active" : ""}`}
                        onClick={() => {
                          setSlotLetter(i, L);
                          closePalette();
                        }}
                        style={{
                          background: letterColor(L, 0.16),
                          borderColor: letterColor(L, 0.6),
                          color: letterColor(L, 1),
                        }}
                        title={`Group ${L} — line(s) ${linesWith.join(", ") || "none yet"}`}
                      >
                        <span className="goal-scheme-palette-letter">{L}</span>
                        <span className="goal-scheme-palette-lines">
                          {linesWith.length > 0
                            ? `L${linesWith.join(",")}`
                            : "—"}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="goal-scheme-palette-btn goal-scheme-palette-btn--new"
                    onClick={() => {
                      setSlotLetter(i, newLetter);
                      closePalette();
                    }}
                    title="Start a new rhyme group"
                    style={{
                      background: letterColor(newLetter, 0.1),
                      borderColor: letterColor(newLetter, 0.5),
                      color: letterColor(newLetter, 1),
                    }}
                  >
                    <span className="goal-scheme-palette-letter">+{newLetter}</span>
                    <span className="goal-scheme-palette-lines">new</span>
                  </button>
                </div>
              </div>,
              document.body,
            );
          })()
        : null}

      {exampleFor && examplePos
        ? (() => {
            const preset = RHYME_SCHEME_PRESETS.find((x) => x.label === exampleFor);
            if (!preset || preset.example.length === 0) return null;
            const maxLeft = Math.max(
              8,
              Math.min(examplePos.left, window.innerWidth - 340),
            );
            return createPortal(
              <div
                className="goal-scheme-example"
                role="tooltip"
                style={{ left: maxLeft, top: examplePos.top }}
              >
                <div className="goal-scheme-example-title">{preset.hint}</div>
                <ol className="goal-scheme-example-lines">
                  {preset.example.map((ln, idx) => {
                    const m = ln.match(/\(([A-Z](?:,\s*[A-Z])*)\)$/);
                    const letter = m?.[1]?.split(",")[0]?.trim() ?? "";
                    const text = ln.replace(/\s*\([A-Z,\s]+\)$/, "");
                    return (
                      <li key={idx}>
                        <span className="goal-scheme-example-text">{text}</span>
                        {letter ? (
                          <span
                            className="goal-scheme-example-tag"
                            style={{
                              background: letterColor(letter, 0.18),
                              color: letterColor(letter, 1),
                              borderColor: letterColor(letter, 0.45),
                            }}
                          >
                            {m?.[1] ?? letter}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </div>,
              document.body,
            );
          })()
        : null}
    </div>
  );
}
