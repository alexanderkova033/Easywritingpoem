import { useMemo, useState, type KeyboardEvent } from "react";
import type { DocumentStats } from "@/workshop/analysis/line-stats";
import type { LineMeterHint, ManualStressOverrides, WordPatternSegment } from "@/workshop/meter/meter-hints";
import { wordPatternsForLine } from "@/workshop/meter/meter-hints";
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
  poemLines: string[];
  stressLexicon: ReadonlyMap<string, string> | null;
  manualStressOverrides: ManualStressOverrides;
  onSetStressOverride: (word: string, pattern: string) => void;
  onRemoveStressOverride: (word: string) => void;
}

function flipMark(ch: string): string {
  return ch === "/" ? "x" : "/";
}

export function MeterPanel({
  docStats,
  meterHints,
  stressLexiconReady,
  stressLexiconErr,
  heavyToolsStale,
  goToLine,
  poemLines,
  stressLexicon,
  manualStressOverrides,
  onSetStressOverride,
  onRemoveStressOverride,
}: MeterPanelProps) {
  const [meterHideBlank, setMeterHideBlank] = useState(true);
  const [meterOnlyLowFit, setMeterOnlyLowFit] = useState(false);
  const [meterLowFitThreshold, setMeterLowFitThreshold] = useState(60);
  const [meterEditMode, setMeterEditMode] = useState(false);

  const displayedMeterHints = useMemo(() => {
    const rows = meterHints.slice(0, METER_TABLE_MAX);
    return rows.filter((r) => {
      if (meterHideBlank && !r.stressPattern) return false;
      if (!meterOnlyLowFit) return true;
      if (r.iambicFitPercent == null) return false;
      return r.iambicFitPercent < meterLowFitThreshold;
    });
  }, [
    meterHideBlank,
    meterHints,
    meterLowFitThreshold,
    meterOnlyLowFit,
  ]);

  const wordSegmentsByLine = useMemo(() => {
    const map = new Map<number, WordPatternSegment[]>();
    for (const r of displayedMeterHints) {
      const text = poemLines[r.lineNumber - 1] ?? "";
      map.set(r.lineNumber, wordPatternsForLine(text, stressLexicon, manualStressOverrides));
    }
    return map;
  }, [displayedMeterHints, poemLines, stressLexicon, manualStressOverrides]);

  const overrideEntries = useMemo(
    () => Object.entries(manualStressOverrides).sort(([a], [b]) => a.localeCompare(b)),
    [manualStressOverrides],
  );

  const flipSyllable = (segment: WordPatternSegment, syllableIndex: number) => {
    if (!segment.normalized || !segment.pattern || syllableIndex >= segment.pattern.length) return;
    const chars = segment.pattern.split("");
    chars[syllableIndex] = flipMark(chars[syllableIndex] || "x");
    onSetStressOverride(segment.normalized, chars.join(""));
  };

  return (
    <div
      className={`tool-block tool-block-live tool-block-meter${meterEditMode ? " is-editing" : ""}`}
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
        {meterOnlyLowFit ? (
          <label className="meter-threshold">
            Below <input type="number" min={0} max={100} step={5} value={meterLowFitThreshold}
              onChange={(e) => setMeterLowFitThreshold(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 60)} /> %
          </label>
        ) : null}
        <button
          type="button"
          className={`meter-edit-toggle${meterEditMode ? " is-active" : ""}`}
          onClick={() => setMeterEditMode((v) => !v)}
          aria-pressed={meterEditMode}
          title={meterEditMode
            ? "Done editing — back to normal view"
            : "Manually flip stress marks the detector got wrong"}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          <span>{meterEditMode ? "Done" : "Fix meter"}</span>
        </button>
      </div>

      {meterEditMode ? (
        <p className="meter-edit-hint muted small">
          Click any syllable mark to flip stressed (◆) ↔ unstressed (·). Overrides apply to that word everywhere in the poem.
        </p>
      ) : null}

      {/* Visual stress bars — one row per line */}
      <ul className="meter-bar-list" aria-label="Stress patterns by line">
        {displayedMeterHints.map((row) => {
          const fit = row.iambicFitPercent;
          const fitClass = fit == null ? "" : fit >= 70 ? "meter-fit-high" : fit >= 40 ? "meter-fit-mid" : "meter-fit-low";
          const segments = wordSegmentsByLine.get(row.lineNumber) ?? [];
          return (
            <li
              key={row.lineNumber}
              className="meter-bar-row"
              tabIndex={meterEditMode ? -1 : 0}
              role={meterEditMode ? undefined : "button"}
              aria-label={meterEditMode
                ? `Line ${row.lineNumber}: edit stress`
                : `Line ${row.lineNumber}: ${row.stressPattern || "no pattern"}. Click to jump.`}
              onClick={meterEditMode ? undefined : () => goToLine(row.lineNumber)}
              onKeyDown={meterEditMode ? undefined : (e: KeyboardEvent<HTMLLIElement>) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goToLine(row.lineNumber); }
              }}
              title={meterStressSourceHint(row.stressSource)}
            >
              <span className="meter-bar-line-num">{row.lineNumber}</span>
              <span className="meter-bar-beats" aria-hidden>
                {meterEditMode ? (
                  segments.length === 0 ? <span className="meter-bar-empty">—</span> :
                  segments.map((seg, segIdx) => (
                    <span key={`${row.lineNumber}-${segIdx}`} className={`meter-word-group${seg.manual ? " is-manual" : ""}`} title={seg.word}>
                      {seg.pattern.split("").map((ch, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`meter-beat-btn ${ch === "/" ? "meter-beat-s" : "meter-beat-u"}`}
                          onClick={(e) => { e.stopPropagation(); flipSyllable(seg, i); }}
                          title={`${seg.word}: syllable ${i + 1} (${ch === "/" ? "stressed" : "unstressed"}) — click to flip`}
                          aria-label={`Flip stress for ${seg.word} syllable ${i + 1}`}
                        />
                      ))}
                    </span>
                  ))
                ) : (
                  row.stressPattern
                    ? row.stressPattern.split("").map((ch, i) =>
                        ch === "/" ? <span key={i} className="meter-beat meter-beat-s" /> :
                        ch === "x" ? <span key={i} className="meter-beat meter-beat-u" /> :
                        <span key={i} className="meter-beat-gap" />
                      )
                    : <span className="meter-bar-empty">—</span>
                )}
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

      {overrideEntries.length > 0 ? (
        <div className="meter-overrides">
          <div className="meter-overrides-head">
            <span className="rhyme-stanza-label">Stress overrides</span>
            <span className="muted small">{overrideEntries.length} word{overrideEntries.length === 1 ? "" : "s"}</span>
          </div>
          <ul className="meter-overrides-list">
            {overrideEntries.map(([word, pattern]) => (
              <li key={word} className="meter-override-row">
                <span className="meter-override-word">{word}</span>
                <span className="meter-override-pattern" aria-hidden>
                  {pattern.split("").map((ch, i) => (
                    <span
                      key={i}
                      className={`meter-beat ${ch === "/" ? "meter-beat-s" : "meter-beat-u"}`}
                    />
                  ))}
                </span>
                <button
                  type="button"
                  className="rhyme-cluster-reject"
                  onClick={() => onRemoveStressOverride(word)}
                  title={`Reset ${word} to dictionary stress`}
                  aria-label={`Reset stress for ${word}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
