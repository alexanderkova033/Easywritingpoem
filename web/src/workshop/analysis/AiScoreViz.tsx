import { scoreColor } from "./ai-analysis-helpers";

export function ScoreSparkline({ history }: { history: number[] }) {
  if (history.length < 2) return null;
  const w = 120;
  const h = 28;
  const pad = 2;
  const xs = history.length;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = Math.max(1, max - min);
  const dx = (w - pad * 2) / (xs - 1);
  const points = history.map((v, i) => {
    const x = pad + i * dx;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${path} L${points[points.length - 1]![0].toFixed(1)},${h - pad} L${pad},${h - pad} Z`;
  const last = history[history.length - 1]!;
  const prev = history[history.length - 2]!;
  const delta = last - prev;
  const trendColor = delta > 0
    ? "var(--ai-score-high, #5fba7d)"
    : delta < 0
      ? "var(--ai-score-low, #d95f5f)"
      : "var(--muted)";
  return (
    <div className="ai-score-spark" title={`Score history: ${history.join(" → ")}`}>
      <svg className="ai-score-spark-svg" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <path d={area} fill={trendColor} fillOpacity="0.18" />
        <path d={path} fill="none" stroke={trendColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === points.length - 1 ? 2.4 : 1.4} fill={trendColor} />
        ))}
      </svg>
      <span className="ai-score-spark-delta" style={{ color: trendColor }}>
        {delta > 0 ? `↑ ${delta}` : delta < 0 ? `↓ ${Math.abs(delta)}` : "·"}
      </span>
    </div>
  );
}

export function ScoreRing({ score }: { score: number }) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const color = scoreColor(score);
  const offset = circ - (score / 100) * circ;
  return (
    <svg className="ai-score-ring" viewBox="0 0 76 76" aria-hidden>
      <circle cx="38" cy="38" r={r} fill="none"
        stroke="color-mix(in srgb, currentColor 10%, transparent)" strokeWidth="6" />
      <circle cx="38" cy="38" r={r} fill="none"
        stroke={color} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 38 38)"
        className="ai-score-arc"
      />
    </svg>
  );
}
