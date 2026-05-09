import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { useHoverHintBinder } from "@/workshop/hints/HoverHintsContext";
import type { DraftMeta } from "@/workshop/library/library-meta";
import type { PoemRecord } from "@/workshop/library/local-draft-library";
import { wordDiff } from "@/workshop/library/text-diff";
import { formatRelativeSnapshotWhen, formatSnapshotWhen } from "./workshop-helpers";
import type { usePoemWorkshopModel } from "./usePoemWorkshopModel";

type Model = ReturnType<typeof usePoemWorkshopModel>;

export type LibraryRow = {
  id: string;
  label: string;
  poem: PoemRecord;
  meta: DraftMeta;
};

type LibrarySort = "recent" | "title" | "updated";

type Props = {
  m: Model;
  isLibraryOpen: boolean;
  setIsLibraryOpen: (v: boolean) => void;
  showDeleteCurrentConfirm: boolean;
  setShowDeleteCurrentConfirm: (v: boolean) => void;
  libraryQuery: string;
  setLibraryQuery: (v: string) => void;
  librarySort: LibrarySort;
  setLibrarySort: Dispatch<SetStateAction<LibrarySort>>;
  libraryShowArchived: boolean;
  setLibraryShowArchived: (v: boolean) => void;
  libraryListRows: LibraryRow[];
  libraryListParentRef: MutableRefObject<HTMLDivElement | null>;
  libraryVirtualizer: Virtualizer<HTMLDivElement, Element>;
  libraryActiveIdx: number;
  librarySearchRef: MutableRefObject<HTMLInputElement | null>;
  pendingDeleteSnapId: string | null;
  setPendingDeleteSnapId: (v: string | null) => void;
  diffSnapshotId: string | null;
  setDiffSnapshotId: (v: string | null) => void;
};

export function WorkshopLibraryModal(props: Props) {
  const {
    m,
    isLibraryOpen,
    setIsLibraryOpen,
    showDeleteCurrentConfirm,
    setShowDeleteCurrentConfirm,
    libraryQuery,
    setLibraryQuery,
    librarySort,
    setLibrarySort,
    libraryShowArchived,
    setLibraryShowArchived,
    libraryListRows,
    libraryListParentRef,
    libraryVirtualizer,
    libraryActiveIdx,
    librarySearchRef,
    pendingDeleteSnapId,
    setPendingDeleteSnapId,
    diffSnapshotId,
    setDiffSnapshotId,
  } = props;

  const hint = useHoverHintBinder();

  if (!isLibraryOpen) return null;

  return (
    <div
      className="overlay overlay-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          setIsLibraryOpen(false);
          setShowDeleteCurrentConfirm(false);
        }
      }}
    >
      <section
        className="drawer library-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Draft library"
      >
        <div className="library-grip" aria-hidden />
        <div className="drawer-head">
          <h2 className="drawer-title">Library</h2>
          <button
            type="button"
            className="small-btn"
            onClick={() => setIsLibraryOpen(false)}
          >
            Close
          </button>
        </div>

        <div className="drawer-scroll">
        <div className="drawer-block library-drafts-section">
            <div className="drawer-actions">
              <button
                type="button"
                className="small-btn small-btn-primary"
                onClick={() => {
                  m.newPoem();
                  setIsLibraryOpen(false);
                }}
              >
                New draft
              </button>
              <button
                type="button"
                className="small-btn"
                onClick={() => {
                  m.duplicatePoem();
                  setIsLibraryOpen(false);
                }}
              >
                Duplicate
              </button>
              {showDeleteCurrentConfirm ? (
                <span className="library-delete-confirm" role="group" aria-label="Confirm delete draft">
                  <span className="library-delete-confirm-text">Delete this draft?</span>
                  <button
                    type="button"
                    className="small-btn danger-btn"
                    onClick={() => {
                      m.deleteCurrentPoem();
                      setShowDeleteCurrentConfirm(false);
                      setIsLibraryOpen(false);
                    }}
                  >
                    Yes, delete
                  </button>
                  <button
                    type="button"
                    className="small-btn"
                    onClick={() => setShowDeleteCurrentConfirm(false)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="small-btn danger-btn"
                  onClick={() => setShowDeleteCurrentConfirm(true)}
                >
                  Delete
                </button>
              )}
            </div>
            <div className="library-filters" role="search">
              <label className="library-filter-field">
                <span className="library-filter-label">Search</span>
                <input
                  ref={librarySearchRef}
                  type="search"
                  value={libraryQuery}
                  onChange={(e) => setLibraryQuery(e.target.value)}
                  placeholder="Title, label, tags"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Filter drafts in library"
                />
              </label>
              <label className="library-filter-field">
                <span className="library-filter-label">Sort</span>
                <select
                  value={librarySort}
                  onChange={(e) =>
                    setLibrarySort(e.target.value as LibrarySort)
                  }
                  aria-label="Sort drafts"
                >
                  <option value="recent">Recent (opened)</option>
                  <option value="updated">Recently edited</option>
                  <option value="title">Title A–Z</option>
                </select>
              </label>
              <label className="library-filter-checkbox">
                <input
                  type="checkbox"
                  checked={libraryShowArchived}
                  onChange={(e) =>
                    setLibraryShowArchived(e.target.checked)
                  }
                />
                Show archived
              </label>
            </div>
            {libraryListRows.length === 0 ? (
              <p className="drawer-note library-empty-msg" role="status">
                No drafts match this filter.
              </p>
            ) : (
            <div ref={libraryListParentRef} className="library-list-scroll">
              <div
                role="list"
                aria-label="Drafts in library"
                style={{
                  height: `${libraryVirtualizer.getTotalSize()}px`,
                  position: "relative",
                }}
              >
                {libraryVirtualizer.getVirtualItems().map((vItem) => {
                  const row = libraryListRows[vItem.index]!;
                  const { id, label, poem, meta } = row;
                  const tags = (meta.tags ?? []).join(", ");
                  const firstLine = poem.body.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
                  const isActive = id === m.activePoemId;
                  const isArchived = Boolean(meta.archived);
                  return (
                    <div
                      key={id}
                      role="listitem"
                      aria-selected={vItem.index === libraryActiveIdx}
                      data-index={vItem.index}
                      ref={libraryVirtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${vItem.start}px)`,
                        paddingBottom: "0.55rem",
                        boxSizing: "border-box",
                      }}
                    >
                      <div
                        className={`draft-item ${isActive ? "is-active" : ""} ${isArchived ? "is-archived" : ""} ${vItem.index === libraryActiveIdx ? "is-keyboard-active" : ""}`}
                      >
                        <div className="draft-item-row">
                          <button
                            type="button"
                            className={`pin-btn ${meta.pinned ? "is-on" : ""}`}
                            onClick={() => m.togglePinned(id)}
                            aria-pressed={Boolean(meta.pinned)}
                            {...hint(meta.pinned ? "Unpin draft" : "Pin draft")}
                          >
                            {meta.pinned ? "★" : "☆"}
                          </button>
                          <div className="draft-open-wrap">
                            <button
                              type="button"
                              className="draft-open-btn"
                              onClick={() => {
                                m.selectPoem(id);
                                setIsLibraryOpen(false);
                              }}
                              aria-current={isActive ? "true" : undefined}
                              {...hint("Open this draft in the editor")}
                            >
                              {label}
                              {isArchived ? " (archived)" : ""}
                            </button>
                            {firstLine && (
                              <span className="draft-first-line" aria-hidden>
                                {firstLine}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="small-btn draft-row-dup"
                            onClick={() => {
                              m.duplicatePoemById(id);
                              setIsLibraryOpen(false);
                            }}
                            {...hint("Duplicate this draft")}
                          >
                            Dup
                          </button>
                          {isArchived ? (
                            <button
                              type="button"
                              className="small-btn"
                              onClick={() => m.setDraftArchived(id, false)}
                              {...hint("Return draft to main list")}
                            >
                              Unarchive
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="small-btn"
                              disabled={isActive}
                              {...hint(
                                isActive
                                  ? "Switch to another draft before archiving this one"
                                  : "Archive — hide from list (data kept)",
                              )}
                              onClick={() => m.setDraftArchived(id, true)}
                            >
                              Archive
                            </button>
                          )}
                        </div>
                        <div className="draft-item-edit">
                          <label className="draft-edit-field">
                            Label
                            <input
                              type="text"
                              value={meta.label ?? ""}
                              onChange={(e) =>
                                m.setDraftLabel(id, e.target.value)
                              }
                              placeholder="Optional display name"
                              autoComplete="off"
                              spellCheck={false}
                            />
                          </label>
                          <label className="draft-edit-field">
                            Tags
                            <input
                              type="text"
                              value={tags}
                              onChange={(e) =>
                                m.setDraftTags(
                                  id,
                                  e.target.value
                                    .split(",")
                                    .map((t) => t.trim())
                                    .filter(Boolean),
                                )
                              }
                              placeholder="comma, separated"
                              autoComplete="off"
                              spellCheck={false}
                            />
                          </label>
                          {(meta.tags ?? []).length > 0 && (
                            <div className="draft-tag-chips">
                              {(meta.tags ?? []).map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  className={`draft-tag-chip ${libraryQuery === tag ? "is-active" : ""}`}
                                  onClick={() => setLibraryQuery(libraryQuery === tag ? "" : tag)}
                                  title={`Filter by tag: ${tag}`}
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            )}
        </div>

        <details className="drawer-accordion drawer-accordion-snapshots" open>
          <summary className="drawer-accordion-summary">
            Snapshots
            {m.revisions.length > 0 && (
              <span className="drawer-accordion-badge">{m.revisions.length}</span>
            )}
          </summary>
          <div className="drawer-accordion-body">
            <div className="snapshot-save-row">
              <input
                type="text"
                className="snapshot-label-input"
                value={m.snapshotLabel}
                onChange={(e) => m.setSnapshotLabel(e.target.value)}
                placeholder="Optional label..."
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(e) => { if (e.key === "Enter") m.saveSnapshot(); }}
              />
              <button
                type="button"
                className="small-btn small-btn-primary"
                onClick={m.saveSnapshot}
                {...hint("Save a snapshot of the current poem")}
              >
                Save now
              </button>
            </div>
            {m.revisions.length > 0 && (
              <div className="snapshot-history-list">
                {m.revisions.map((snap) => (
                  <div key={snap.id} className="snapshot-history-item">
                    <div className="snapshot-history-meta">
                      <span
                        className="snapshot-history-when"
                        title={formatSnapshotWhen(snap.createdAt)}
                      >
                        {formatRelativeSnapshotWhen(snap.createdAt)}
                      </span>
                      {snap.label && snap.label !== "Auto" && (
                        <span className="snapshot-history-label">{snap.label}</span>
                      )}
                      {snap.label === "Auto" && (
                        <span className="snapshot-history-auto">auto</span>
                      )}
                      {snap.title && (
                        <span className="snapshot-history-title">{snap.title}</span>
                      )}
                      {snap.aiScore != null && (
                        <span className="snapshot-ai-score" title="AI score at time of snapshot">
                          ✦ {snap.aiScore}
                        </span>
                      )}
                    </div>
                    <div className="snapshot-history-actions">
                      <button
                        type="button"
                        className="small-btn"
                        onClick={() => setDiffSnapshotId(diffSnapshotId === snap.id ? null : snap.id)}
                        aria-pressed={diffSnapshotId === snap.id}
                        {...hint("Show word-level diff between this snapshot and the current poem")}
                      >
                        {diffSnapshotId === snap.id ? "Hide diff" : "Diff"}
                      </button>
                      <button
                        type="button"
                        className="small-btn"
                        onClick={() => {
                          if (window.confirm(`Restore to "${formatRelativeSnapshotWhen(snap.createdAt)}"${snap.label ? ` (${snap.label})` : ""}?\n\nThis will replace the current poem text.`)) {
                            m.restoreRevision(snap);
                            setIsLibraryOpen(false);
                          }
                        }}
                        {...hint("Restore poem to this snapshot")}
                      >
                        Restore
                      </button>
                      {pendingDeleteSnapId === snap.id ? (
                        <span className="snapshot-delete-confirm" role="group" aria-label="Confirm delete snapshot">
                          <button
                            type="button"
                            className="small-btn danger-btn"
                            onClick={() => {
                              m.deleteRevision(snap.id);
                              setPendingDeleteSnapId(null);
                            }}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            className="small-btn"
                            onClick={() => setPendingDeleteSnapId(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="small-btn snapshot-delete-btn"
                          onClick={() => setPendingDeleteSnapId(snap.id)}
                          aria-label={`Delete snapshot from ${formatRelativeSnapshotWhen(snap.createdAt)}`}
                          {...hint("Delete this snapshot")}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    {diffSnapshotId === snap.id && (() => {
                      const tokens = wordDiff(snap.body, m.body);
                      return (
                        <div className="snapshot-diff-view" aria-label="Poem diff">
                          {tokens.map((tok, i) =>
                            tok.type === "same" ? (
                              <span key={i}>{tok.text}</span>
                            ) : tok.type === "del" ? (
                              <del key={i} className="snapshot-diff-del">{tok.text}</del>
                            ) : (
                              <ins key={i} className="snapshot-diff-add">{tok.text}</ins>
                            )
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>

        </div>
      </section>
    </div>
  );
}
