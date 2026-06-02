import { useMemo, useState } from "react";
import { diffPoemLines } from "@/workshop/library/diff-lines";
import type { RevisionSnapshot } from "@/workshop/library/revision-snapshots";
import {
  formatRelativeSnapshotWhen,
  formatSnapshotWhen,
} from "@/workshop/shell/workshop-helpers";

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
}

type PreviewLine =
  | { kind: "body"; text: string }
  | { kind: "add"; text: string }
  | { kind: "remove"; text: string }
  | { kind: "change"; from: string; to: string };

interface RowMeta {
  snap: RevisionSnapshot;
  autoName: string;
  autoNameKind: "initial" | "manual" | "edit" | "none";
  previewLines: PreviewLine[];
  lines: number;
  words: number;
  deltaLines: number | null;
  deltaWords: number | null;
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

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trimEnd() + "…";
}

/** First non-empty body lines, used when there are no changes to highlight. */
function bodyOpeningLines(body: string): PreviewLine[] {
  if (!body) return [{ kind: "body", text: "(empty)" }];
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 2)
    .map((l) => clip(l, 64));
  return lines.length === 0
    ? [{ kind: "body", text: "(empty)" }]
    : lines.map((text) => ({ kind: "body" as const, text }));
}

/**
 * Compute an auto-name and a preview that shows the *changed* lines vs the
 * predecessor snapshot. Cards in the list then look visibly different from
 * each other even when their opening lines are the same.
 */
function buildChangePreview(
  current: RevisionSnapshot,
  older: RevisionSnapshot | undefined,
): {
  autoName: string;
  autoNameKind: "initial" | "manual" | "edit" | "none";
  previewLines: PreviewLine[];
} {
  if (current.label && current.label.trim().length > 0) {
    // Manual label wins; preview still shows changes if any.
    const change = older ? summarizeChanges(older.body, current.body) : null;
    return {
      autoName: current.label.trim(),
      autoNameKind: "manual",
      previewLines:
        change && change.previewLines.length > 0
          ? change.previewLines
          : bodyOpeningLines(current.body),
    };
  }
  if (!older) {
    return {
      autoName: "Initial draft",
      autoNameKind: "initial",
      previewLines: bodyOpeningLines(current.body),
    };
  }
  const change = summarizeChanges(older.body, current.body);
  if (!change) {
    return {
      autoName: "No body changes",
      autoNameKind: "none",
      previewLines: bodyOpeningLines(current.body),
    };
  }
  return {
    autoName: change.name,
    autoNameKind: "edit",
    previewLines:
      change.previewLines.length > 0
        ? change.previewLines
        : bodyOpeningLines(current.body),
  };
}

function summarizeChanges(
  prevBody: string,
  curBody: string,
): { name: string; previewLines: PreviewLine[] } | null {
  if (prevBody === curBody) return null;
  const rows = diffPoemLines(prevBody, curBody);
  const adds: string[] = [];
  const removes: string[] = [];
  const changes: Array<{ from: string; to: string }> = [];
  for (const r of rows) {
    if (r.kind === "right" && r.text.trim().length > 0) {
      adds.push(r.text);
    } else if (r.kind === "left" && r.text.trim().length > 0) {
      removes.push(r.text);
    } else if (r.kind === "change") {
      changes.push({ from: r.left, to: r.right });
    }
  }
  if (adds.length === 0 && removes.length === 0 && changes.length === 0) {
    return null;
  }

  // Build the auto-name. Single-action snapshots get a specific verb; mixed
  // edits get a compact counter (+1 ↻2 −1) so the card still differs from
  // neighbours.
  let name: string;
  const onlyAdds = adds.length > 0 && removes.length === 0 && changes.length === 0;
  const onlyRemoves = removes.length > 0 && adds.length === 0 && changes.length === 0;
  const onlyChanges = changes.length > 0 && adds.length === 0 && removes.length === 0;
  if (onlyAdds) {
    name = adds.length === 1 ? "Added 1 line" : `Added ${adds.length} lines`;
  } else if (onlyRemoves) {
    name =
      removes.length === 1 ? "Trimmed 1 line" : `Trimmed ${removes.length} lines`;
  } else if (onlyChanges) {
    name =
      changes.length === 1 ? "Rewrote 1 line" : `Rewrote ${changes.length} lines`;
  } else {
    const parts: string[] = [];
    if (adds.length) parts.push(`+${adds.length}`);
    if (changes.length) parts.push(`↻${changes.length}`);
    if (removes.length) parts.push(`−${removes.length}`);
    name = `Edited (${parts.join(" ")})`;
  }

  // Build up to two preview lines. Rewrites are the most informative, then
  // additions, then deletions.
  const previewLines: PreviewLine[] = [];
  for (const c of changes) {
    if (previewLines.length >= 2) break;
    previewLines.push({
      kind: "change",
      from: clip(c.from, 28),
      to: clip(c.to, 28),
    });
  }
  for (const a of adds) {
    if (previewLines.length >= 2) break;
    previewLines.push({ kind: "add", text: clip(a, 64) });
  }
  if (previewLines.length === 0) {
    for (const r of removes) {
      if (previewLines.length >= 2) break;
      previewLines.push({ kind: "remove", text: clip(r, 64) });
    }
  }

  return { name, previewLines };
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
      const lines = lineCount(s.body);
      const words = wordCount(s.body);
      const deltaLines = older ? lines - lineCount(older.body) : null;
      const deltaWords = older ? words - wordCount(older.body) : null;
      const preview = buildChangePreview(s, older);
      return {
        snap: s,
        autoName: preview.autoName,
        autoNameKind: preview.autoNameKind,
        previewLines: preview.previewLines,
        lines,
        words,
        deltaLines,
        deltaWords,
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
          <p
            className={`snap-card-name snap-card-name-${row.autoNameKind}`}
            title={
              row.autoNameKind === "manual"
                ? row.autoName
                : `Auto-named from changes: ${row.autoName}`
            }
          >
            {row.autoName}
          </p>
          <div
            className="snap-snippet snap-snippet-multiline"
            title={s.body || "(empty)"}
          >
            {row.previewLines.map((ln, idx) => {
              if (ln.kind === "change") {
                return (
                  <span
                    key={idx}
                    className="snap-snippet-line snap-snippet-line-change"
                  >
                    <span className="snap-snippet-marker" aria-hidden="true">↻</span>
                    <span className="snap-snippet-change-from">{ln.from}</span>
                    <span className="snap-snippet-change-arrow" aria-hidden="true">→</span>
                    <span className="snap-snippet-change-to">{ln.to}</span>
                  </span>
                );
              }
              if (ln.kind === "add") {
                return (
                  <span
                    key={idx}
                    className="snap-snippet-line snap-snippet-line-add"
                  >
                    <span className="snap-snippet-marker" aria-hidden="true">+</span>
                    {ln.text}
                  </span>
                );
              }
              if (ln.kind === "remove") {
                return (
                  <span
                    key={idx}
                    className="snap-snippet-line snap-snippet-line-remove"
                  >
                    <span className="snap-snippet-marker" aria-hidden="true">−</span>
                    {ln.text}
                  </span>
                );
              }
              return (
                <span key={idx} className="snap-snippet-line">
                  {ln.text}
                </span>
              );
            })}
          </div>
          <div className="snap-meta">
            <span
              className="snap-meta-time"
              title={formatSnapshotWhen(s.createdAt)}
            >
              {formatRelativeSnapshotWhen(s.createdAt)}
            </span>
            <span className="snap-meta-counts" title="Lines · words">
              {row.lines} ln · {row.words} w
            </span>
            {phrase ? (
              <span
                className={`snap-meta-delta snap-meta-delta-${netSign}`}
                title="Change since previous snapshot"
              >
                {phrase}
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
          {onDiffSnapshot && (
            <button
              type="button"
              className={`snap-compare-btn${isDiffActive ? " is-active" : ""}`}
              title={
                isDiffActive
                  ? "Stop comparing in the editor"
                  : "Compare against current draft, inline in the editor"
              }
              aria-pressed={isDiffActive}
              onClick={() => onDiffSnapshot(s)}
            >
              {isDiffActive ? "Comparing" : "Compare"}
            </button>
          )}
          <div className="snap-actions">
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
        <p className="snap-section-hint muted small">
          Stored on this device. Compare opens the diff inside the editor.
        </p>
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
    </div>
  );
}
