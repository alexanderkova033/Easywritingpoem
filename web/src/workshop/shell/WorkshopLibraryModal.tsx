import { useMemo, useState } from "react";
import type { CSSProperties, Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { useHoverHintBinder } from "@/workshop/hints/HoverHintsContext";
import type { DraftMeta } from "@/workshop/library/library-meta";
import type { PoemRecord } from "@/workshop/library/local-draft-library";
import { RevisionCompareSection } from "@/workshop/analysis/RevisionCompareSection";
import type { usePoemWorkshopModel } from "./usePoemWorkshopModel";

type Model = ReturnType<typeof usePoemWorkshopModel>;

/* ------------------------------------------------------------------ */
/* Book palette                                                       */
/*                                                                    */
/* Sixteen library-classic spine colors. A book picks one based on    */
/* its first tag (so all "love" books match), falling back to a hash  */
/* of its id so untagged drafts still differ from each other.         */
/* ------------------------------------------------------------------ */

const BOOK_PALETTE: ReadonlyArray<{ h: number; s: number; l: number }> = [
  { h: 350, s: 55, l: 32 }, // burgundy
  { h: 140, s: 45, l: 28 }, // forest
  { h: 215, s: 50, l: 30 }, // navy
  { h: 42,  s: 65, l: 38 }, // mustard
  { h: 290, s: 35, l: 32 }, // plum
  { h: 180, s: 50, l: 28 }, // teal
  { h: 18,  s: 60, l: 38 }, // rust
  { h: 245, s: 40, l: 32 }, // indigo
  { h: 95,  s: 30, l: 32 }, // sage
  { h: 10,  s: 55, l: 38 }, // coral
  { h: 220, s: 16, l: 32 }, // slate
  { h: 35,  s: 55, l: 33 }, // ochre
  { h: 320, s: 40, l: 33 }, // magenta
  { h: 195, s: 48, l: 28 }, // sea
  { h: 70,  s: 35, l: 28 }, // olive
  { h: 5,   s: 50, l: 30 }, // maroon
];

function hashIndex(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % mod;
}

function bookColorFor(id: string, tags: readonly string[] | undefined): {
  h: number;
  s: number;
  l: number;
} {
  const tag = tags?.find((t) => t.trim().length > 0)?.trim().toLowerCase();
  const key = tag && tag.length > 0 ? `tag:${tag}` : `id:${id}`;
  return BOOK_PALETTE[hashIndex(key, BOOK_PALETTE.length)]!;
}

function bookStyleVars(id: string, tags: readonly string[] | undefined): CSSProperties {
  const c = bookColorFor(id, tags);
  return {
    ["--book-hue" as never]: c.h,
    ["--book-sat" as never]: `${c.s}%`,
    ["--book-light" as never]: `${c.l}%`,
  } as CSSProperties;
}

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
    diffSnapshotId,
    setDiffSnapshotId,
  } = props;

  const hint = useHoverHintBinder();
  const [editingId, setEditingId] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of libraryListRows) {
      for (const raw of r.meta.tags ?? []) {
        const t = raw.trim();
        if (!t) continue;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));
  }, [libraryListRows]);

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
            {allTags.length > 0 && (
              <div className="library-tag-cloud" role="group" aria-label="Filter by tag">
                <span className="library-tag-cloud-label">Tags</span>
                {allTags.map(({ tag, count }) => {
                  const active = libraryQuery.trim().toLowerCase() === tag.toLowerCase();
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`library-tag-cloud-chip ${active ? "is-active" : ""}`}
                      style={bookStyleVars(tag, [tag])}
                      onClick={() => setLibraryQuery(active ? "" : tag)}
                      title={
                        active
                          ? `Clear filter`
                          : `Filter by tag: ${tag} (${count})`
                      }
                    >
                      <span className="library-tag-cloud-dot" aria-hidden />
                      <span className="library-tag-cloud-text">{tag}</span>
                      <span className="library-tag-cloud-count">{count}</span>
                    </button>
                  );
                })}
                {libraryQuery && (
                  <button
                    type="button"
                    className="library-tag-cloud-clear"
                    onClick={() => setLibraryQuery("")}
                    title="Clear search"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
            {libraryListRows.length === 0 ? (
              <div className="library-bookshelf library-bookshelf-empty" role="status" aria-label="Empty library">
                <div className="shelf-empty-row">
                  <div className="shelf-plank" aria-hidden />
                </div>
                <div className="shelf-empty-row">
                  <div className="shelf-plank" aria-hidden />
                </div>
                <p className="drawer-note library-empty-msg">No drafts match this filter.</p>
              </div>
            ) : (
            <div ref={libraryListParentRef} className="library-list-scroll library-bookshelf">
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
                  const tagsList = (meta.tags ?? []).filter((t) => t.trim().length > 0);
                  const firstLine = poem.body.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
                  const isActive = id === m.activePoemId;
                  const isArchived = Boolean(meta.archived);
                  const isEditingThis = editingId === id;
                  const spineTitle = (label && label.trim()) || "Untitled";
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
                        className={`draft-item shelf-item ${isActive ? "is-active" : ""} ${isArchived ? "is-archived" : ""} ${vItem.index === libraryActiveIdx ? "is-keyboard-active" : ""}`}
                        style={bookStyleVars(id, tagsList)}
                      >
                        <div className="shelf-row">
                          <button
                            type="button"
                            className={`book ${meta.pinned ? "is-pinned" : ""}`}
                            onClick={() => {
                              m.selectPoem(id);
                              setIsLibraryOpen(false);
                            }}
                            aria-current={isActive ? "true" : undefined}
                            aria-label={`Open draft "${spineTitle}"`}
                            {...hint("Open this draft in the editor")}
                          >
                            <span className="book-spine">
                              <span className="book-spine-title">{spineTitle}</span>
                              {meta.pinned && <span className="book-spine-pin" aria-hidden>★</span>}
                            </span>
                          </button>
                          <div className="shelf-row-meta">
                            <div className="shelf-row-head">
                              <button
                                type="button"
                                className={`pin-btn ${meta.pinned ? "is-on" : ""}`}
                                onClick={() => m.togglePinned(id)}
                                aria-pressed={Boolean(meta.pinned)}
                                {...hint(meta.pinned ? "Unpin draft" : "Pin draft")}
                              >
                                {meta.pinned ? "★" : "☆"}
                              </button>
                              <div className="shelf-row-titlewrap">
                                <span className="shelf-row-title" title={spineTitle}>
                                  {spineTitle}
                                </span>
                                {firstLine ? (
                                  <span className="draft-first-line" aria-hidden>
                                    {firstLine}
                                  </span>
                                ) : (
                                  <span className="draft-first-line is-blank" aria-hidden>
                                    Blank page
                                  </span>
                                )}
                              </div>
                              {isArchived && (
                                <span className="shelf-archived-badge" aria-hidden>archived</span>
                              )}
                            </div>
                            {tagsList.length > 0 && (
                              <div className="shelf-row-tags">
                                {tagsList.map((tag) => {
                                  const filterActive =
                                    libraryQuery.trim().toLowerCase() === tag.toLowerCase();
                                  return (
                                    <button
                                      key={tag}
                                      type="button"
                                      className={`draft-tag-chip ${filterActive ? "is-active" : ""}`}
                                      style={bookStyleVars(tag, [tag])}
                                      onClick={() =>
                                        setLibraryQuery(filterActive ? "" : tag)
                                      }
                                      title={
                                        filterActive
                                          ? "Clear tag filter"
                                          : `Filter by tag: ${tag}`
                                      }
                                    >
                                      <span className="draft-tag-chip-dot" aria-hidden />
                                      {tag}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            <div className="shelf-row-actions">
                              <button
                                type="button"
                                className={`shelf-row-edit-toggle ${isEditingThis ? "is-on" : ""}`}
                                onClick={() =>
                                  setEditingId(isEditingThis ? null : id)
                                }
                                aria-expanded={isEditingThis}
                                {...hint("Rename or change tags")}
                              >
                                {isEditingThis ? "Done" : "Rename / tags"}
                              </button>
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
                            {isEditingThis && (
                              <div className="draft-item-edit">
                                <label className="draft-edit-field">
                                  Label
                                  <input
                                    type="text"
                                    value={meta.label ?? ""}
                                    onChange={(e) =>
                                      m.setDraftLabel(id, e.target.value)
                                    }
                                    placeholder="Display name (overrides title)"
                                    autoComplete="off"
                                    spellCheck={false}
                                  />
                                </label>
                                <label className="draft-edit-field">
                                  Tags
                                  <input
                                    type="text"
                                    value={tagsList.join(", ")}
                                    onChange={(e) =>
                                      m.setDraftTags(
                                        id,
                                        e.target.value
                                          .split(",")
                                          .map((t) => t.trim())
                                          .filter(Boolean),
                                      )
                                    }
                                    placeholder="comma, separated (colors the book)"
                                    autoComplete="off"
                                    spellCheck={false}
                                  />
                                </label>
                                <p className="draft-edit-hint">
                                  Tags color the book spine and group drafts in the filter row above.
                                </p>
                              </div>
                            )}
                          </div>
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
          <div className="drawer-accordion-body library-snap-body">
            <RevisionCompareSection
              embedInTools
              revisions={m.revisions}
              snapshotLabel={m.snapshotLabel}
              onSnapshotLabelChange={m.setSnapshotLabel}
              onSaveSnapshot={m.saveSnapshot}
              snapshotFlash={m.snapshotFlash}
              onRestoreRevision={(snap) => {
                m.restoreRevision(snap);
                setIsLibraryOpen(false);
              }}
              onDeleteRevision={m.deleteRevision}
              onDeleteDuplicates={m.deleteDuplicateRevisions}
              duplicateCount={m.duplicateRevisionCount}
              onDiffSnapshot={(snap) =>
                setDiffSnapshotId(diffSnapshotId === snap.id ? null : snap.id)
              }
              activeDiffSnapshotId={diffSnapshotId}
            />
          </div>
        </details>

        </div>
      </section>
    </div>
  );
}
