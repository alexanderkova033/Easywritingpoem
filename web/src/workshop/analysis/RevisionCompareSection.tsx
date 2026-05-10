import { useState } from "react";
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
  /** Full timestamp for native tooltip on &lt;option&gt; */
  optionTitle?: string;
}

export interface RevisionCompareSectionProps {
  /** When true, main title is visually hidden (tab already shows “Snapshots”). */
  embedInTools?: boolean;
  revisions: RevisionSnapshot[];
  snapshotLabel: string;
  onSnapshotLabelChange: (v: string) => void;
  onSaveSnapshot: () => void;
  snapshotFlash?: boolean;
  onRestoreRevision: (snap: RevisionSnapshot) => void;
  onDeleteRevision: (id: string) => void;
  /** Open inline word-level diff in the editor against this snapshot. */
  onDiffSnapshot?: (snap: RevisionSnapshot) => void;
  /** Snapshot id currently active as inline diff, or null. */
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

export function RevisionCompareSection(props: RevisionCompareSectionProps) {
  const {
    embedInTools = false,
    revisions,
    snapshotLabel,
    onSnapshotLabelChange,
    onSaveSnapshot,
    snapshotFlash = false,
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
    compareSnapshotOptions,
    compareLeftBody,
    compareRightBody,
    compareDiffRows,
  } = props;

  const [pendingRestore, setPendingRestore] = useState<RevisionSnapshot | null>(
    null,
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  return (
    <div
      className="revision-section"
      aria-label="Revision history"
      id="revision-compare"
    >
      <h3
        className={
          embedInTools
            ? "sr-only"
            : "revision-section-title"
        }
      >
        Snapshots
      </h3>
      <p className="muted small">
        This device only · {revisions.length}/50
      </p>
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
      {snapshotFlash ? (
        <p className="snapshot-saved-flash" role="status" aria-live="polite">
          Snapshot saved
        </p>
      ) : null}
      {revisions.length === 0 ? (
        <p className="muted small">No snapshots yet.</p>
      ) : (
        <ul className="revision-list">
          {revisions.map((s) => (
            <li key={s.id} className="revision-list-item">
              <div className="revision-list-item-top">
                <div className="revision-meta">
                  <span
                    className="revision-when"
                    title={formatSnapshotWhen(s.createdAt)}
                  >
                    {formatRelativeSnapshotWhen(s.createdAt)}
                  </span>
                  {s.label ? (
                    <span className="revision-label">{s.label}</span>
                  ) : null}
                </div>
                <div className="revision-actions">
                  <button
                    type="button"
                    className="small-btn revision-compare-quick-btn"
                    title="Compare this snapshot against the current draft"
                    onClick={() => {
                      onCompareLeftChange(s.id);
                      onCompareRightChange(COMPARE_CURRENT_ID);
                      onCompareViewModeChange("diff");
                    }}
                  >
                    Diff
                  </button>
                  {onDiffSnapshot && (
                    <button
                      type="button"
                      className={`small-btn revision-diff-inline-btn${activeDiffSnapshotId === s.id ? " is-active" : ""}`}
                      title={activeDiffSnapshotId === s.id
                        ? "Currently shown as inline diff in the editor — click to exit"
                        : "Show word-level diff inline in the editor"}
                      onClick={() => onDiffSnapshot(s)}
                    >
                      {activeDiffSnapshotId === s.id ? "Exit diff" : "In editor"}
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
              </div>
              {pendingRestore?.id === s.id ? (
                <div
                  className="revision-inline-confirm"
                  role="group"
                  aria-label="Confirm restore snapshot"
                >
                  <p className="revision-inline-confirm-text">
                    Replace the current draft with this snapshot? Save a snapshot
                    first if you need to keep today&apos;s text.
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
          ))}
        </ul>
      )}
      <h4 className="tool-subheading">Compare</h4>
      {revisions.length === 0 ? (
        <p className="muted small">
          Save a snapshot to diff against the draft (or another snapshot).
        </p>
      ) : (
        <>
          <div className="compare-select-row">
            <label className="compare-select">
              <span className="compare-select-label" aria-hidden>
                From
              </span>
              <select
                value={compareLeftId}
                onChange={(e) => onCompareLeftChange(e.target.value)}
                aria-label="Older version (From)"
              >
                {compareSnapshotOptions.map((o) => (
                  <option
                    key={`L-${o.id}`}
                    value={o.id}
                    title={o.optionTitle}
                  >
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="compare-select-arrow" aria-hidden>→</span>
            <label className="compare-select">
              <span className="compare-select-label" aria-hidden>
                To
              </span>
              <select
                value={compareRightId}
                onChange={(e) => onCompareRightChange(e.target.value)}
                aria-label="Newer version (To)"
              >
                {compareSnapshotOptions.map((o) => (
                  <option
                    key={`R-${o.id}`}
                    value={o.id}
                    title={o.optionTitle}
                  >
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
          {compareLeftId === compareRightId ? (
            <p className="muted small">Choose two different versions to compare.</p>
          ) : compareViewMode === "side" ? (
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
    </div>
  );
}
