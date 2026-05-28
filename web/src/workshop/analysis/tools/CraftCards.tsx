import type { ReactNode } from "react";

export type CraftTone = "warn" | "good" | "info";

function CraftStatIcon({ tone }: { tone: CraftTone }) {
  if (tone === "good") {
    return (
      <svg viewBox="0 0 24 24" className="craft-stat-icon-svg" aria-hidden>
        <path
          d="M5 12.5l4 4 10-10"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (tone === "warn") {
    return (
      <svg viewBox="0 0 24 24" className="craft-stat-icon-svg" aria-hidden>
        <path d="M12 5v9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="12" cy="18" r="1.4" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="craft-stat-icon-svg" aria-hidden>
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </svg>
  );
}

export function CraftStatCard({
  tone = "info",
  title,
  metric,
  metricLabel,
  progress,
  hint,
}: {
  tone?: CraftTone;
  title: ReactNode;
  metric?: ReactNode;
  metricLabel?: ReactNode;
  progress?: number;
  hint?: string;
}) {
  return (
    <div
      className={`craft-stat craft-stat--${tone}`}
      role="status"
      title={hint}
    >
      <span className={`craft-stat-icon craft-stat-icon--${tone}`} aria-hidden>
        <CraftStatIcon tone={tone} />
      </span>
      <p className="craft-stat-title">{title}</p>
      {metric != null ? (
        <span className="craft-stat-metric">
          <span className="craft-stat-metric-num">{metric}</span>
          {metricLabel ? (
            <span className="craft-stat-metric-label">{metricLabel}</span>
          ) : null}
        </span>
      ) : null}
      {progress != null ? (
        <span
          className="craft-stat-progress"
          aria-hidden
          style={{ ["--craft-stat-pct" as never]: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }}
        />
      ) : null}
    </div>
  );
}
