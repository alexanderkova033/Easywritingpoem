import { useMemo, useState } from "react";
import type { LineDiffRow } from "@/workshop/library/diff-lines";
import type { RevisionSnapshot } from "@/workshop/library/revision-snapshots";
import {
  COMPARE_CURRENT_ID,
  formatRelativeSnapshotWhen,
  formatSnapshotWhen,
} from "@/workshop/shell/workshop-helpers";

export interface CompareSnapshotOption {
  id: string;
  label: string;
  optionTitle?: string;
}

export interface RevisionCompareSectionProps {
  embedInTools?: boolean;
  revisions: RevisionSnapshot[];
  snapshotLabel: string;
  onSnapshotLabelChange: (v: string) => void;
  onSaveSnapshot: () => void;
  snapshotFlash?: "saved" | "duplicate" | null | boolean;
  onRestoreRevision: (snap: RevisionSnapshot) => void;
  onDeleteRevision: (id: string) => void;
  onDiffSnapshot?: (snap: RevisionSnapshot) => void;
  activeDiffSnapshotId?: string | null;
  compareLeftId: string;
  compareRightId: string;
  onCompareLeftChange: (id: string) => void;
  onCompareRightChange: (id: string) => void;
  compareViewMode: "side" | "diff";
  onCompareViewModeChange: (mode: "side" | "diff") => void;
  compareSnapshotOptions: CompareSnapshotOption[];
  compareLeftBody: string;
  compareRightBody: string;
  compareDiffRows: LineDiffRow[];
}

interface RowMeta {
  snap: RevisionSnapshot;
  snippet: string;
  deltaLines: number | null;
  deltaWords: number | null;
  datePill: string;
  dateTone: "today" | "yesterday" | "older";
}

function lineCount(body: string): number {
  if (!body) return 0;
  return body.split("\n").filter((l) => l.trim().length > 0).length;
}

function wordCount(body: string): number {
  if (!body) return 0;
  const m = body.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu);
  return m ? m.length : 0;
}

function buildSnippet(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (!flat) return "(empty)";
  return flat.length > 32 ? flat.slice(0, 32).trimEnd() + "…" : flat;
}

function datePillFor(iso: string): {
  label: string;
  tone: "today" | "yesterday" | "older";
} {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: "", tone: "older" };
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return { label: "Today", tone: "today" };
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const isYesterday =
    d.getFullYear() === y.getFullYear() &&
    d.getMonth() === y.getMonth() &&
    d.getDate() === y.getDate();
  if (isYesterday) return { label: "Yesterday", tone: "yesterday" };
  const sameYear = d.getFullYear() === now.getFullYear();
  const label = sameYear
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
  return { label, tone: "older" };
}

function fmtSignedCount(n: number, singular: string, plural: string): string {
  const sign = n > 0 ? "+" : "−";
  const abs = Math.abs(n);
  return `${sign}${abs} ${abs === 1 ? singular : plural}`;
}

function deltaPhrase(
  deltaLines: number | null,
  deltaWords: number | null,
): string | null {
  if (deltaLines == null && deltaWords == null) return null;
  const parts: string[] = [];
  if (deltaLines != null && deltaLines !== 0) {
    parts.push(fmtSignedCount(deltaLines, "line", "lines"));
  }
  if (deltaWords != null && deltaWords !== 0) {
    parts.push(fmtSignedCount(deltaWords, "word", "words"));
  }
  if (parts.length === 0) return "no change";
  return parts.join(" · ");
}

export function RevisionCompareSection(props: RevisionCompareSectionProps) {
  const {
    embedInTools = false,
    revisions,
    snapshotLabel,
    onSnapshotLabelChange,
    onSaveSnapshot,
    snapshotFlash = null,
    onRestoreRevision,
    onDeleteRevision,
    onDiffSnapshot,
    activeDiffSnapshotId,
    compareLeftId,
    compareRightId,
    onCompareLeftChange,
    onCompareRightChange,
    compareViewMode,
    onCompareViewModeChange,
    compareLeftBody,
    compareRightBody,
    compareDiffRows,
  } = props;

  const [pendingRestore, setPendingRestore] = useState<RevisionSnapshot | null>(
    null,
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const rowsMeta = useMemo<RowMeta[]>(() => {
    return revisions.map((s, i) => {
      const older = revisions[i + 1];
      const deltaLines = older
        ? lineCount(s.body) - lineCount(older.body)
        : null;
      const deltaWords = older
        ? wordCount(s.body) - wordCount(older.body)
        : null;
      const pill = datePillFor(s.createdAt);
      return {
        snap: s,
        snippet: buildSnippet(s.body),
        deltaLines,
        deltaWords,
        datePill: pill.label,
        dateTone: pill.tone,
      };
    });
  }, [revisions]);

  const flashStatus =
    snapshotFlash === true || snapshotFlash === "saved"
      ? "saved"
      : snapshotFlash === "duplicate"
        ? "duplicate"
        : null;

  const pickAs = (id: string, side: "from" | "to") => {
    if (side === "from") {
      if (compareLeftId === id) {
        onCompareLeftChange(COMPARE_CURRENT_ID);
        return;
      }
      onCompareLeftChange(id);
      if (compareRightId === id) {
        const fallback = revisions.find((r) => r.id !== id);
        onCompareRightChange(fallback ? fallback.id : COMPARE_CURRENT_ID);
      }
    } else {
      if (compareRightId === id) {
        onCompareRightChange(COMPARE_CURRENT_ID);
        return;
      }
      onCompareRightChange(id);
      if (compareLeftId === id) {
        const fallback = revisions.find((r) => r.id !== id);
        onCompareLeftChange(fallback ? fallback.id : COMPARE_CURRENT_ID);
      }
    }
  };

  const renderRowControls = (snap: RevisionSnapshot) => {
    const isFrom = compareLeftId === snap.id;
    const isTo = compareRightId === snap.id;
    return (
      <div className="revision-pick-row">
        <button
          type="button"
          className={`revision-pick-chip${isFrom ? " is-active" : ""}`}
          aria-pressed={isFrom}
          title={isFrom ? "Currently the From version" : "Use as From"}
          onClick={() => pickAs(snap.id, "from")}
        >
          From
        </button>
        <button
          type="button"
          className={`revision-pick-chip${isTo ? " is-active" : ""}`}
          aria-pressed={isTo}
          title={isTo ? "Currently the To version" : "Use as To"}
          onClick={() => pickAs(snap.id, "to")}
        >
          To
        </button>
      </div>
    );
  };

  const renderSnapItem = (row: RowMeta) => {
    const s = row.snap;
    const phrase = deltaPhrase(row.deltaLines, row.deltaWords);
    const netSign =
      (row.deltaLines ?? 0) + (row.deltaWords ?? 0) > 0
        ? "pos"
        : (row.deltaLines ?? 0) + (row.deltaWords ?? 0) < 0
          ? "neg"
          : "zero";
    return (
      <li key={s.id} className="revision-list-item revision-list-item-compact">
        <div className="revision-row-main">
          {renderRowControls(s)}
          {row.datePill ? (
            <span
              className={`revision-date-pill revision-date-pill-${row.dateTone}`}
              title={formatSnapshotWhen(s.createdAt)}
            >
              {row.datePill}
            </span>
          ) : null}
          <span
            className="revision-when"
            title={formatSnapshotWhen(s.createdAt)}
          >
            {formatRelativeSnapshotWhen(s.createdAt)}
          </span>
          {s.label ? (
            <span className="revision-label">{s.label}</span>
          ) : null}
          <span
            className="revision-snippet revision-snippet-inline"
            title={s.body || "(empty)"}
          >
            {row.snippet}
          </span>
          {phrase ? (
            <span
              className={`revision-change-note revision-change-${netSign}`}
              title="Change since previous snapshot"
            >
              {phrase}
            </span>
          ) : null}
        </div>
        <div className="revision-actions revision-actions-compact">
          {onDiffSnapshot && (
            <button
              type="button"
              className={`linkish revision-diff-inline-link${activeDiffSnapshotId === s.id ? " is-active" : ""}`}
              title={
                activeDiffSnapshotId === s.id
                  ? "Currently shown as inline diff in the editor — click to exit"
                  : "Show word-level diff inline in the editor"
              }
              onClick={() => onDiffSnapshot(s)}
            >
              {activeDiffSnapshotId === s.id ? "Exit diff" : "Editor"}
            </button>
          )}
          <button
            type="button"
            className="linkish"
            onClick={() => {
              setPendingDeleteId(null);
              setPendingRestore((cur) => (cur?.id === s.id ? null : s));
            }}
          >
            Restore
          </button>
          <button
            type="button"
            className="linkish danger-link"
            onClick={() => {
              setPendingRestore(null);
              setPendingDeleteId((cur) => (cur === s.id ? null : s.id));
            }}
          >
            Delete
          </button>
        </div>
        {pendingRestore?.id === s.id ? (
          <div
            className="revision-inline-confirm"
            role="group"
            aria-label="Confirm restore snapshot"
          >
            <p className="revision-inline-confirm-text">
              Replace current draft with this snapshot? Save a snapshot first
              if today&apos;s text matters.
            </p>
            <div className="revision-inline-confirm-actions">
              <button
                type="button"
                className="small-btn"
                onClick={() => setPendingRestore(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="small-btn small-btn-primary"
                onClick={() => {
                  onRestoreRevision(pendingRestore);
                  setPendingRestore(null);
                }}
              >
                Replace draft
              </button>
            </div>
          </div>
        ) : null}
        {pendingDeleteId === s.id ? (
          <div
            className="revision-inline-confirm revision-inline-confirm-danger"
            role="group"
            aria-label="Confirm delete snapshot"
          >
            <p className="revision-inline-confirm-text">
              Delete this snapshot permanently?
            </p>
            <div className="revision-inline-confirm-actions">
              <button
                type="button"
                className="small-btn"
                onClick={() => setPendingDeleteId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="small-btn danger-btn"
                onClick={() => {
                  onDeleteRevision(s.id);
                  setPendingDeleteId(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ) : null}
      </li>
    );
  };

  const isDraftFrom = compareLeftId === COMPARE_CURRENT_ID;
  const isDraftTo = compareRightId === COMPARE_CURRENT_ID;
  const sameSelection = compareLeftId === compareRightId;
  const fromLabel =
    compareLeftId === COMPARE_CURRENT_ID
      ? "Current draft"
      : (() => {
          const s = revisions.find((r) => r.id === compareLeftId);
          return s
            ? s.label || formatRelativeSnapshotWhen(s.createdAt)
            : "Current draft";
        })();
  const toLabel =
    compareRightId === COMPARE_CURRENT_ID
      ? "Current draft"
      : (() => {
          const s = revisions.find((r) => r.id === compareRightId);
          return s
            ? s.label || formatRelativeSnapshotWhen(s.createdAt)
            : "Current draft";
        })();

  return (
    <div
      className="revision-section"
      aria-label="Revision history"
      id="revision-compare"
    >
      <h3
        className={embedInTools ? "sr-only" : "revision-section-title"}
      >
        Snapshots
      </h3>
      <p className="muted small">This device only · {revisions.length}/50</p>
      <div className="snapshot-save-row">
        <input
          type="text"
          className="snapshot-label-input"
          value={snapshotLabel}
          onChange={(e) => onSnapshotLabelChange(e.target.value)}
          placeholder="Label (optional)"
          autoComplete="off"
          aria-label="Snapshot label"
          spellCheck={false}
        />
        <button type="button" className="small-btn" onClick={onSaveSnapshot}>
          Save snapshot
        </button>
      </div>
      {flashStatus === "saved" ? (
        <p className="snapshot-saved-flash" role="status" aria-live="polite">
          Snapshot saved
        </p>
      ) : flashStatus === "duplicate" ? (
        <p className="snapshot-saved-flash snapshot-saved-flash-duplicate" role="status" aria-live="polite">
          No changes since last snapshot — nothing new to save
        </p>
      ) : null}

      <div className="revision-draft-row">
        <div className="revision-draft-row-label">
          <span className="revision-when">Current draft</span>
          <span className="revision-label revision-label-live">live</span>
        </div>
        <div className="revision-pick-row">
          <button
            type="button"
            className={`revision-pick-chip${isDraftFrom ? " is-active" : ""}`}
            aria-pressed={isDraftFrom}
            onClick={() => {
              if (isDraftFrom) return;
              onCompareLeftChange(COMPARE_CURRENT_ID);
              if (compareRightId === COMPARE_CURRENT_ID) {
                const first = revisions[0];
                onCompareRightChange(first ? first.id : COMPARE_CURRENT_ID);
              }
            }}
          >
            From
          </button>
          <button
            type="button"
            className={`revision-pick-chip${isDraftTo ? " is-active" : ""}`}
            aria-pressed={isDraftTo}
            onClick={() => {
              if (isDraftTo) return;
              onCompareRightChange(COMPARE_CURRENT_ID);
              if (compareLeftId === COMPARE_CURRENT_ID) {
                const first = revisions[0];
                onCompareLeftChange(first ? first.id : COMPARE_CURRENT_ID);
              }
            }}
          >
            To
          </button>
        </div>
      </div>

      {revisions.length === 0 ? (
        <p className="muted small">No snapshots yet.</p>
      ) : (
        <div className="revision-list-scroll">
          <ul className="revision-list">{rowsMeta.map(renderSnapItem)}</ul>
        </div>
      )}

      <details className="revision-compare-details" open={!sameSelection && revisions.length > 0}>
        <summary className="revision-compare-summary-row">
          <span className="revision-compare-summary-label">Compare</span>
          {revisions.length > 0 && !sameSelection ? (
            <span className="revision-compare-summary-pair muted small">
              <strong>{fromLabel}</strong> → <strong>{toLabel}</strong>
            </span>
          ) : (
            <span className="muted small">
              {revisions.length === 0
                ? "Save a snapshot first."
                : "Pick From / To above."}
            </span>
          )}
        </summary>
        {revisions.length === 0 || sameSelection ? null : (
          <>
          <div
            className="compare-mode-toggle"
            role="group"
            aria-label="Compare view mode"
          >
            <button
              type="button"
              className={`segment-btn ${compareViewMode === "side" ? "active" : ""}`}
              onClick={() => onCompareViewModeChange("side")}
            >
              Side by side
            </button>
            <button
              type="button"
              className={`segment-btn ${compareViewMode === "diff" ? "active" : ""}`}
              onClick={() => onCompareViewModeChange("diff")}
            >
              Changes
            </button>
          </div>
          {compareViewMode === "side" ? (
            <div className="compare-panels" aria-label="Compared poem text">
              <div className="compare-panel">
                <div className="compare-panel-head">From</div>
                <pre className="compare-pre">{compareLeftBody}</pre>
              </div>
              <div className="compare-panel">
                <div className="compare-panel-head">To</div>
                <pre className="compare-pre">{compareRightBody}</pre>
              </div>
            </div>
          ) : (
            <div className="compare-diff-wrap" aria-label="Line diff">
              <table className="compare-diff-table">
                <thead>
                  <tr>
                    <th scope="col" className="diff-th-tag"></th>
                    <th scope="col" className="diff-th-from">From</th>
                    <th scope="col" className="diff-th-to">To</th>
                  </tr>
                </thead>
                <tbody>
                  {compareDiffRows.map((row, idx) => {
                    if (row.kind === "same") {
                      return (
                        <tr key={`s-${idx}`} className="diff-same">
                          <td colSpan={3} className="diff-cell">
                            {row.text || " "}
                          </td>
                        </tr>
                      );
                    }
                    if (row.kind === "change") {
                      return (
                        <tr key={`c-${idx}`} className="diff-change">
                          <td className="diff-tag">~</td>
                          <td className="diff-cell diff-removed">
                            {row.left || " "}
                          </td>
                          <td className="diff-cell diff-added">
                            {row.right || " "}
                          </td>
                        </tr>
                      );
                    }
                    if (row.kind === "left") {
                      return (
                        <tr key={`l-${idx}`} className="diff-remove-row">
                          <td className="diff-tag">−</td>
                          <td
                            className="diff-cell diff-removed"
                            colSpan={2}
                          >
                            {row.text || " "}
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={`r-${idx}`} className="diff-add-row">
                        <td className="diff-tag">+</td>
                        <td className="diff-cell diff-added" colSpan={2}>
                          {row.text || " "}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </>
        )}
      </details>
    </div>
  );
}
