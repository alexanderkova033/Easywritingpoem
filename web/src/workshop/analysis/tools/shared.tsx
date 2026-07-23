import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

export function NoLinesYetHint() {
  return (
    <p className="tool-no-lines-hint muted small" role="status">
      Add a line with text in the poem body to see live stats and pattern tools
      here. Blank-only lines don&apos;t count.
    </p>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="tool-empty" role="status" aria-live="polite">
      <p className="tool-empty-title">{title}</p>
      <div className="tool-empty-body">{children}</div>
    </div>
  );
}

export function SoftPill({
  soft,
  onToggle,
  label,
}: {
  soft: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`goal-card-soft-pill${soft ? " goal-card-soft-pill--soft" : ""}`}
      onClick={onToggle}
      title={
        soft
          ? "Stretch plan — won't trigger issues. Click to make required."
          : "Required — counts as an issue when unmet. Click to make a stretch plan."
      }
      aria-label={`${label}: ${soft ? "stretch plan" : "required"}`}
    >
      {soft ? "Stretch" : "Required"}
    </button>
  );
}

export function NumberInput({
  value,
  onCommit,
  ariaLabel,
  placeholder,
  withSteppers = false,
}: {
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  ariaLabel: string;
  placeholder?: string;
  withSteppers?: boolean;
}) {
  const [text, setText] = useState(value != null ? String(value) : "");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setText(value != null ? String(value) : "");
  }, [value]);

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      onCommit(undefined);
      return;
    }
    const n = parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 1) {
      setText(value != null ? String(value) : "");
      return;
    }
    onCommit(n);
  }

  function step(delta: number) {
    const base = value ?? 1;
    onCommit(Math.max(1, base + delta));
  }

  const input = (
    <input
      ref={ref}
      type="number"
      className="goal-card-input"
      min={1}
      inputMode="numeric"
      value={text}
      placeholder={placeholder ?? "—"}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit(text);
          ref.current?.blur();
        }
      }}
      aria-label={ariaLabel}
    />
  );

  if (!withSteppers) return input;

  return (
    <div className="goal-card-stepper">
      <button
        type="button"
        className="goal-card-step"
        onClick={() => step(-1)}
        disabled={value != null && value <= 1}
        aria-label={`Decrease ${ariaLabel}`}
      >
        −
      </button>
      {input}
      <button
        type="button"
        className="goal-card-step"
        onClick={() => step(1)}
        aria-label={`Increase ${ariaLabel}`}
      >
        +
      </button>
    </div>
  );
}

export function JumpLineList({
  lineNumbers,
  goToLine,
}: {
  lineNumbers: number[];
  goToLine: (line1Based: number) => void;
}) {
  return (
    <>
      {lineNumbers.map((n, i) => (
        <span key={`${n}-${i}`}>
          {i > 0 ? ", " : null}
          <button
            type="button"
            className="linkish line-jump-inline"
            onClick={() => goToLine(n)}
          >
            {n}
          </button>
        </span>
      ))}
    </>
  );
}
