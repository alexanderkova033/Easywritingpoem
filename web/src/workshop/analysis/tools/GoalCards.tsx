import { useEffect, useState } from "react";
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
            aria-label={`Clear ${label} goal`}
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
          <span className="goal-card-of goal-card-of--unset">no goal</span>
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
        <div className="goal-card-mode" role="group" aria-label="Goal mode">
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
            aria-label="Clear syllable cap goal"
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
  perStanza?: boolean;
}

const RHYME_SCHEME_PRESETS: RhymeSchemePreset[] = [
  { label: "None", value: "", hint: "No rhyme-scheme goal" },
  { label: "AABB", value: "AABB", hint: "Couplets (per stanza)", perStanza: true },
  { label: "ABAB", value: "ABAB", hint: "Alternating quatrain (per stanza)", perStanza: true },
  { label: "ABBA", value: "ABBA", hint: "Enclosed rhyme (per stanza)", perStanza: true },
  { label: "AABBA", value: "AABBA", hint: "Limerick" },
  { label: "Ballad", value: "ABCB", hint: "Ballad stanza (per stanza)", perStanza: true },
  {
    label: "Sonnet",
    value: "ABABCDCDEFEFGG",
    hint: "Shakespearean sonnet (full)",
  },
];

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
  const [custom, setCustom] = useState(target);
  useEffect(() => {
    setCustom(target);
  }, [target]);

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

  return (
    <div className={`goal-card goal-card--scheme ${statusClass}`}>
      <div className="goal-card-header">
        <span className="goal-card-label">Rhyme scheme</span>
        {hasGoal ? (
          <button
            type="button"
            className="goal-card-clear"
            onClick={() => onSet(undefined)}
            aria-label="Clear rhyme scheme goal"
            title="Clear"
          >
            ×
          </button>
        ) : null}
      </div>

      <div className="goal-scheme-chips" role="group" aria-label="Rhyme scheme presets">
        {RHYME_SCHEME_PRESETS.map((p) => {
          const active =
            target === p.value && (!!p.perStanza === perStanza || p.value === "");
          return (
            <button
              key={p.label}
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
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="goal-scheme-custom">
        <input
          type="text"
          className="goal-scheme-input"
          value={custom}
          placeholder="Custom pattern (e.g. ABBA)"
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

      {hasGoal ? (
        <label className="goal-scheme-perstanza" title="Repeat pattern within each stanza independently">
          <input
            type="checkbox"
            checked={perStanza}
            onChange={(e) => onSetPerStanza(e.target.checked)}
          />
          <span>Apply per stanza</span>
        </label>
      ) : null}

      {hasGoal && schemePerLine.length > 0 ? (
        <ul className="goal-scheme-lines" aria-label="Line-by-line rhyme comparison">
          {schemePerLine.map((row) => (
            <li
              key={row.line}
              className={`goal-scheme-line${row.matches ? " is-match" : " is-miss"}`}
            >
              <span className="goal-scheme-line-num">{row.line}</span>
              <span className="goal-scheme-line-detected">
                {row.detected || "·"}
              </span>
              <span className="goal-scheme-line-arrow" aria-hidden>
                →
              </span>
              <span className="goal-scheme-line-expected">
                {row.expected || "·"}
              </span>
            </li>
          ))}
        </ul>
      ) : hasGoal ? (
        <p className="muted small goal-scheme-empty">
          Write a few lines to see how they line up against {target}.
        </p>
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
    </div>
  );
}
