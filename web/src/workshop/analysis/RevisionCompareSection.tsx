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
  onDeleteDuplicates?: () => void;
  duplicateCount?: number;
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

type BucketKey = "today" | "yesterday" | "week" | "older";

const BUCKET_LABELS: Record<BucketKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Earlier this week",
  older: "Before",
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const dow = x.getDay();
  const diff = (dow + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

function bucketFor(iso: string, now: Date): BucketKey {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "older";
  const today = startOfDay(now);
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const weekStart = startOfWeek(now);
  const t = d.getTime();
  if (t >= today.getTime()) return "today";
  if (t >= yest.getTime()) return "yesterday";
  if (t >= weekStart.getTime()) return "week";
  return "older";
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
    onDeleteDuplicates,
    duplicateCount = 0,
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
  const [pendingDeleteDupes, setPendingDeleteDupes] = useState(false);

  const duplicateIds = useMemo(() => {
    const seen = new Map<string, string>();
    const dupes = new Set<string>();
    for (const s of revisions) {
      const k = `${s.title} ${s.form ?? ""} ${s.body}`;
      const keeper = seen.get(k);
      if (keeper) dupes.add(s.id);
      else seen.set(k, s.id);
    }
    return dupes;
  }, [revisions]);

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

  const groupedRows = useMemo<
    Array<{ key: BucketKey; rows: RowMeta[] }>
  >(() => {
    const now = new Date();
    const buckets: Record<BucketKey, RowMeta[]> = {
      today: [],
      yesterday: [],
      week: [],
      older: [],
    };
    for (const r of rowsMeta) {
      buckets[bucketFor(r.snap.createdAt, now)].push(r);
    }
    const order: BucketKey[] = ["today", "yesterday", "week", "older"];
    return order
      .filter((k) => buckets[k].length > 0)
      .map((k) => ({ key: k, rows: buckets[k] }));
  }, [rowsMeta]);

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
      <div className="snap-pick" role="group" aria-label="Pick for compare">
        <button
          type="button"
          className={`snap-pick-chip snap-pick-from${isFrom ? " is-active" : ""}`}
          aria-pressed={isFrom}
          title={isFrom ? "Currently the From snapshot" : "Use as From"}
          onClick={() => pickAs(snap.id, "from")}
        >
          From
        </button>
        <button
          type="button"
          className={`snap-pick-chip snap-pick-to${isTo ? " is-active" : ""}`}
          aria-pressed={isTo}
          title={isTo ? "Currently the To snapshot" : "Use as To"}
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
    const isDuplicate = duplicateIds.has(s.id);
    const isDiffActive = activeDiffSnapshotId === s.id;
    return (
      <li
        key={s.id}
        className={`snap-card${isDuplicate ? " is-duplicate" : ""}${isDiffActive ? " is-diff-active" : ""}`}
      >
        <div className="snap-card-body">
          <p className="snap-snippet" title={s.body || "(empty)"}>
            {row.snippet}
          </p>
          <div className="snap-meta">
            <span
              className="snap-meta-time"
              title={formatSnapshotWhen(s.createdAt)}
            >
              {formatRelativeSnapshotWhen(s.createdAt)}
            </span>
            {phrase ? (
              <span
                className={`snap-meta-delta snap-meta-delta-${netSign}`}
                title="Change since previous snapshot"
              >
                {phrase}
              </span>
            ) : null}
            {s.label ? (
              <span className="snap-meta-label" title={s.label}>
                {s.label}
              </span>
            ) : null}
            {isDuplicate ? (
              <span
                className="snap-meta-dupe"
                title="Same text as a newer snapshot"
              >
                duplicate
              </span>
            ) : null}
          </div>
        </div>
        <div className="snap-card-side">
          {renderRowControls(s)}
          <div className="snap-actions">
            {onDiffSnapshot && (
              <button
                type="button"
                className={`snap-action-btn${isDiffActive ? " is-active" : ""}`}
                title={
                  isDiffActive
                    ? "Exit inline diff in editor"
                    : "Show word-level diff inline in editor"
                }
                aria-label={isDiffActive ? "Exit editor diff" : "Show in editor"}
                onClick={() => onDiffSnapshot(s)}
              >
                {isDiffActive ? "Exit" : "Editor"}
              </button>
            )}
            <button
              type="button"
              className="snap-action-btn"
              title="Replace current draft with this snapshot"
              onClick={() => {
                setPendingDeleteId(null);
                setPendingRestore((cur) => (cur?.id === s.id ? null : s));
              }}
            >
              Restore
            </button>
            <button
              type="button"
              className="snap-action-btn snap-action-danger"
              title="Delete this snapshot"
              aria-label="Delete snapshot"
              onClick={() => {
                setPendingRestore(null);
                setPendingDeleteId((cur) => (cur === s.id ? null : s.id));
              }}
            >
              ✕
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
      className="snap-section"
      aria-label="Snapshots"
      id="revision-compare"
    >
      <header className="snap-section-header">
        <div className="snap-section-title">
          <h3 className={embedInTools ? "sr-only" : "snap-section-h"}>
            Snapshots
          </h3>
          <span className="snap-section-count" title="This device only">
            {revisions.length}
            <span className="snap-section-count-max">/50</span>
          </span>
        </div>
        <p className="snap-section-hint muted small">Stored on this device</p>
      </header>

      <div className="snap-save-bar">
        <input
          type="text"
          className="snap-save-input"
          value={snapshotLabel}
          onChange={(e) => onSnapshotLabelChange(e.target.value)}
          placeholder="Label this snapshot (optional)"
          autoComplete="off"
          aria-label="Snapshot label"
          spellCheck={false}
        />
        <button
          type="button"
          className="snap-save-btn"
          onClick={onSaveSnapshot}
          title="Save current draft as a snapshot"
        >
          <span aria-hidden="true" className="snap-save-btn-icon">＋</span>
          Save
        </button>
      </div>
      {flashStatus === "saved" ? (
        <p
          className="snap-flash snap-flash-saved"
          role="status"
          aria-live="polite"
        >
          ✓ Snapshot saved
        </p>
      ) : flashStatus === "duplicate" ? (
        <p
          className="snap-flash snap-flash-duplicate"
          role="status"
          aria-live="polite"
        >
          No changes since last snapshot
        </p>
      ) : null}

      {onDeleteDuplicates && duplicateCount > 0 ? (
        pendingDeleteDupes ? (
          <div
            className="snap-dupes-strip snap-dupes-strip-confirm"
            role="group"
            aria-label="Confirm delete duplicate snapshots"
          >
            <span className="snap-dupes-text">
              Delete {duplicateCount} duplicate{" "}
              {duplicateCount === 1 ? "snapshot" : "snapshots"}? Newest of each
              is kept.
            </span>
            <div className="snap-dupes-actions">
              <button
                type="button"
                className="snap-action-btn"
                onClick={() => setPendingDeleteDupes(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="snap-action-btn snap-action-danger snap-action-solid"
                onClick={() => {
                  onDeleteDuplicates();
                  setPendingDeleteDupes(false);
                }}
              >
                Delete duplicates
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="snap-dupes-strip"
            onClick={() => setPendingDeleteDupes(true)}
            title="Remove snapshots that match a newer one"
          >
            <span className="snap-dupes-badge" aria-hidden="true">
              {duplicateCount}
            </span>
            <span className="snap-dupes-text">
              duplicate{duplicateCount === 1 ? "" : "s"} found
            </span>
            <span className="snap-dupes-cta">Clean up →</span>
          </button>
        )
      ) : null}

      <div className="snap-card snap-card-live">
        <div className="snap-card-body">
          <p className="snap-snippet snap-snippet-live">
            <span className="snap-live-dot" aria-hidden="true" />
            Current draft
          </p>
          <div className="snap-meta">
            <span className="snap-meta-time">Editing now</span>
            <span className="snap-meta-live">LIVE</span>
          </div>
        </div>
        <div className="snap-card-side">
          <div className="snap-pick" role="group" aria-label="Pick current draft for compare">
            <button
              type="button"
              className={`snap-pick-chip snap-pick-from${isDraftFrom ? " is-active" : ""}`}
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
              className={`snap-pick-chip snap-pick-to${isDraftTo ? " is-active" : ""}`}
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
      </div>

      {revisions.length === 0 ? (
        <div className="snap-empty">
          <span className="snap-empty-icon" aria-hidden="true">⌛</span>
          <p className="snap-empty-text">
            No snapshots yet. Save one to preserve this draft.
          </p>
        </div>
      ) : (
        <div className="snap-list-scroll">
          {groupedRows.map((group) => (
            <section key={group.key} className="snap-group">
              <h4 className="snap-group-heading">
                <span className="snap-group-bar" aria-hidden="true" />
                <span className="snap-group-label">
                  {BUCKET_LABELS[group.key]}
                </span>
                <span className="snap-group-count">{group.rows.length}</span>
              </h4>
              <ul className="snap-list">{group.rows.map(renderSnapItem)}</ul>
            </section>
          ))}
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
