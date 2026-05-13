import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { DocumentStats } from "@/workshop/analysis/line-stats";
import { LINES_TABLE_MAX } from "@/workshop/analysis/tools/helpers";
import { NoLinesYetHint } from "@/workshop/analysis/tools/shared";
import { LiveSectionTitle } from "../ToolTabBar";

export interface LinesPanelProps {
  docStats: DocumentStats;
  heavyToolsStale: boolean;
  goToLine: (line1Based: number) => void;
}

export function LinesPanel({ docStats, heavyToolsStale, goToLine }: LinesPanelProps) {
  const [hideEmptyLines, setHideEmptyLines] = useState(false);
  const [goLineField, setGoLineField] = useState("");

  const displayedLineRows = useMemo(() => {
    if (!hideEmptyLines) return docStats.lines;
    return docStats.lines.filter((r) => r.text.trim().length > 0);
  }, [docStats.lines, hideEmptyLines]);

  const lineStanzaMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of docStats.stanzaStats) {
      for (let ln = s.startLine; ln <= s.endLine; ln++) {
        m.set(ln, s.stanzaIndex);
      }
    }
    return m;
  }, [docStats.stanzaStats]);

  const maxLineSyllables = useMemo(() => {
    let max = 0;
    for (const r of displayedLineRows) {
      if (r.syllables > max) max = r.syllables;
    }
    return max || 1;
  }, [displayedLineRows]);

  const syllOutlierBounds = useMemo(() => {
    const nums = docStats.lines
      .filter((r) => r.text.trim().length > 0)
      .map((r) => r.syllables)
      .sort((a, b) => a - b);
    if (nums.length < 4) return null;
    const q = (p: number) => {
      const i = (nums.length - 1) * p;
      const lo = Math.floor(i);
      const hi = Math.ceil(i);
      return nums[lo]! + (nums[hi]! - nums[lo]!) * (i - lo);
    };
    const q1 = q(0.25);
    const q3 = q(0.75);
    const iqr = q3 - q1;
    if (iqr < 1) return null;
    return { lo: q1 - 1.5 * iqr, hi: q3 + 1.5 * iqr };
  }, [docStats.lines]);

  return (
    <div
      className="tool-block tool-block-live"
      id="tool-panel-lines"
      role="tabpanel"
      aria-labelledby="tool-tab-lines"
    >
      <LiveSectionTitle>Line table</LiveSectionTitle>
      {docStats.nonEmptyLines === 0 ? <NoLinesYetHint /> : null}
      {heavyToolsStale ? (
        <p
          className="tools-stale-hint muted small"
          role="status"
          aria-live="polite"
        >
          Table syllable estimates match your text in a moment.
        </p>
      ) : null}
      <form
        className="lines-go-form"
        onSubmit={(e) => {
          e.preventDefault();
          const n = parseInt(goLineField.trim(), 10);
          if (!Number.isFinite(n) || n < 1) return;
          goToLine(n);
        }}
      >
        <label className="lines-go-label">
          Go to line
          <input
            id="go-line-input"
            value={goLineField}
            onChange={(e) => setGoLineField(e.target.value)}
            inputMode="numeric"
            placeholder="#"
            aria-label="Go to line number"
          />
        </label>
        <button type="submit" className="small-btn">
          Go
        </button>
      </form>
      <div className="lines-table-toolbar">
        <label className="lines-hide-empty-label">
          <input
            type="checkbox"
            checked={hideEmptyLines}
            onChange={(e) => setHideEmptyLines(e.target.checked)}
          />
          Hide blank lines
        </label>
      </div>
      <div className="table-wrap table-wrap-draft">
        <table
          className="line-table line-table-draft"
          title="Per-line stats; click a row to jump in the editor."
        >
          <caption className="sr-only">
            Per line: line number, estimated syllables, word count,
            and character count. Activate a row to move the cursor
            there.
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <abbr title="Line number">Line</abbr>
              </th>
              <th scope="col" className="line-table-preview-th">Text</th>
              <th scope="col" className="line-table-syll-th">
                <abbr title="Estimated syllables (heuristic) with bar relative to longest line">
                  Syll.
                </abbr>
              </th>
              <th scope="col">Words</th>
              <th scope="col">Chars</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const rows = displayedLineRows.slice(0, LINES_TABLE_MAX);
              const out: ReactNode[] = [];
              let prevStanza: number | null = null;
              for (const row of rows) {
                const stanza = lineStanzaMap.get(row.lineNumber) ?? null;
                if (
                  stanza != null &&
                  prevStanza != null &&
                  stanza !== prevStanza
                ) {
                  out.push(
                    <tr
                      key={`sep-${row.lineNumber}`}
                      className="line-table-stanza-sep"
                      aria-hidden="true"
                    >
                      <td colSpan={5}>
                        <span className="line-table-stanza-sep-bar" />
                      </td>
                    </tr>,
                  );
                }
                prevStanza = stanza ?? prevStanza;
                const trimmed = row.text.trim();
                const preview =
                  trimmed.length > 22
                    ? trimmed.slice(0, 22).trimEnd() + "…"
                    : trimmed;
                const isBlank = trimmed.length === 0;
                const barPct = isBlank
                  ? 0
                  : Math.max(
                      4,
                      Math.round((row.syllables / maxLineSyllables) * 100),
                    );
                const outlier =
                  !isBlank &&
                  syllOutlierBounds != null &&
                  (row.syllables < syllOutlierBounds.lo ||
                    row.syllables > syllOutlierBounds.hi);
                out.push(
                  <tr
                    key={row.lineNumber}
                    className={`line-table-data-row line-table-row-jump${outlier ? " is-syll-outlier" : ""}${isBlank ? " is-blank-line" : ""}`}
                    tabIndex={0}
                    aria-label={`Line ${row.lineNumber}: ${row.syllables} syllables, ${row.words} words${outlier ? " (syllable outlier)" : ""}. Open in editor.`}
                    onClick={() => goToLine(row.lineNumber)}
                    onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        goToLine(row.lineNumber);
                      }
                    }}
                  >
                    <td className="line-table-metric line-table-line-num">
                      {row.lineNumber}
                    </td>
                    <td
                      className="line-table-preview"
                      title={trimmed || "(blank line)"}
                    >
                      {isBlank ? (
                        <span className="line-table-preview-blank">·</span>
                      ) : (
                        preview
                      )}
                    </td>
                    <td className="line-table-metric line-table-syll-cell">
                      <span className="line-table-syll-bar-wrap" aria-hidden>
                        <span
                          className="line-table-syll-bar"
                          style={{ width: `${barPct}%` }}
                        />
                      </span>
                      <span className="line-table-syll-num">
                        {row.syllables}
                        {outlier ? (
                          <span
                            className="line-table-syll-flag"
                            aria-hidden
                            title="Syllable outlier vs. rest of the poem"
                          >
                            !
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="line-table-metric">{row.words}</td>
                    <td className="line-table-metric">{row.chars}</td>
                  </tr>,
                );
              }
              return out;
            })()}
          </tbody>
        </table>
      </div>
      {displayedLineRows.length > LINES_TABLE_MAX ? (
        <p className="muted small">
          Showing first {LINES_TABLE_MAX} of {displayedLineRows.length}{" "}
          rows
          {hideEmptyLines ? " (blank lines hidden)" : ""}.
        </p>
      ) : null}
    </div>
  );
}
