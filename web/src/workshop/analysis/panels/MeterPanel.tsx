import { useMemo, useState, type KeyboardEvent } from "react";
import type { DocumentStats } from "@/workshop/analysis/line-stats";
import type { LineMeterHint } from "@/workshop/meter/meter-hints";
import {
  METER_TABLE_MAX,
  meterStressSourceHint,
  meterStressSourceMark,
} from "@/workshop/analysis/tools/helpers";
import { NoLinesYetHint } from "@/workshop/analysis/tools/shared";
import { LiveSectionTitle } from "../ToolTabBar";

export interface MeterPanelProps {
  docStats: DocumentStats;
  meterHints: LineMeterHint[];
  stressLexiconReady: boolean;
  stressLexiconErr: string | null;
  heavyToolsStale: boolean;
  goToLine: (line1Based: number) => void;
}

export function MeterPanel({
  docStats,
  meterHints,
  stressLexiconReady,
  stressLexiconErr,
  heavyToolsStale,
  goToLine,
}: MeterPanelProps) {
  const [meterHideBlank, setMeterHideBlank] = useState(true);
  const [meterOnlyLowFit, setMeterOnlyLowFit] = useState(false);
  const [meterLowFitThreshold, setMeterLowFitThreshold] = useState(60);
  const [meterOnlyHeuristic, setMeterOnlyHeuristic] = useState(false);

  const displayedMeterHints = useMemo(() => {
    const rows = meterHints.slice(0, METER_TABLE_MAX);
    return rows.filter((r) => {
      if (meterHideBlank && !r.stressPattern) return false;
      if (meterOnlyHeuristic && r.stressSource !== "heuristic") return false;
      if (!meterOnlyLowFit) return true;
      if (r.iambicFitPercent == null) return false;
      return r.iambicFitPercent < meterLowFitThreshold;
    });
  }, [
    meterHideBlank,
    meterHints,
    meterLowFitThreshold,
    meterOnlyHeuristic,
    meterOnlyLowFit,
  ]);

  return (
    <div
      className="tool-block tool-block-live tool-block-meter"
      id="tool-panel-meter"
      role="tabpanel"
      aria-labelledby="tool-tab-meter"
    >
      <LiveSectionTitle>Stress &amp; meter</LiveSectionTitle>
      {docStats.nonEmptyLines === 0 ? <NoLinesYetHint /> : null}
      {stressLexiconErr ? (
        <p className="error compact" role="alert">{stressLexiconErr}</p>
      ) : !stressLexiconReady ? (
        <p className="muted small meter-lexicon-status" aria-busy="true">Loading stress dictionary…</p>
      ) : null}
      {heavyToolsStale ? (
        <p className="tools-stale-hint muted small" role="status" aria-live="polite">Updating…</p>
      ) : null}

      <div className="meter-controls" role="group" aria-label="Meter filters">
        <label className="meter-toggle">
          <input type="checkbox" checked={meterHideBlank} onChange={(e) => setMeterHideBlank(e.target.checked)} />
          Hide blanks
        </label>
        <label className="meter-toggle">
          <input type="checkbox" checked={meterOnlyLowFit} onChange={(e) => setMeterOnlyLowFit(e.target.checked)} />
          Low fit only
        </label>
        <label className="meter-toggle">
          <input type="checkbox" checked={meterOnlyHeuristic} onChange={(e) => setMeterOnlyHeuristic(e.target.checked)} />
          Guessed only
        </label>
        {meterOnlyLowFit ? (
          <label className="meter-threshold">
            Below <input type="number" min={0} max={100} step={5} value={meterLowFitThreshold}
              onChange={(e) => setMeterLowFitThreshold(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 60)} /> %
          </label>
        ) : null}
      </div>

      {/* Visual stress bars — one row per line */}
      <ul className="meter-bar-list" aria-label="Stress patterns by line">
        {displayedMeterHints.map((row) => {
          const fit = row.iambicFitPercent;
          const fitClass = fit == null ? "" : fit >= 70 ? "meter-fit-high" : fit >= 40 ? "meter-fit-mid" : "meter-fit-low";
          return (
            <li
              key={row.lineNumber}
              className="meter-bar-row"
              tabIndex={0}
              role="button"
              aria-label={`Line ${row.lineNumber}: ${row.stressPattern || "no pattern"}. Click to jump.`}
              onClick={() => goToLine(row.lineNumber)}
              onKeyDown={(e: KeyboardEvent<HTMLLIElement>) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goToLine(row.lineNumber); }
              }}
              title={meterStressSourceHint(row.stressSource)}
            >
              <span className="meter-bar-line-num">{row.lineNumber}</span>
              <span className="meter-bar-beats" aria-hidden>
                {row.stressPattern
                  ? row.stressPattern.split("").map((ch, i) =>
                      ch === "/" ? <span key={i} className="meter-beat meter-beat-s" /> :
                      ch === "x" ? <span key={i} className="meter-beat meter-beat-u" /> :
                      <span key={i} className="meter-beat-gap" />
                    )
                  : <span className="meter-bar-empty">—</span>
                }
              </span>
              {fit != null ? (
                <span className={`meter-bar-fit ${fitClass}`}>{fit}%</span>
              ) : (
                <span className="meter-bar-fit meter-fit-none">—</span>
              )}
              <span className="meter-bar-src" title={meterStressSourceHint(row.stressSource)}>
                {meterStressSourceMark(row.stressSource)}
              </span>
            </li>
          );
        })}
      </ul>

      {meterHints.length > METER_TABLE_MAX ? (
        <p className="muted small">Showing first {METER_TABLE_MAX} of {meterHints.length} lines.</p>
      ) : null}
    </div>
  );
}
