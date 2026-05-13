import type { ChecklistItem } from "@/workshop/analysis/publication-checklist";
import { PublicationChecklistVisual } from "@/workshop/analysis/PublicationChecklistVisual";
import { useHoverHintBinder } from "@/workshop/hints/HoverHintsContext";
import type { usePoemWorkshopModel } from "./usePoemWorkshopModel";

type WorkshopModel = ReturnType<typeof usePoemWorkshopModel>;

export interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  m: WorkshopModel;
  exportFlash: string | null;
  doExportFlash: (msg: string) => void;
  checklistOpenCount: number;
  onJumpFromChecklist: (item: ChecklistItem) => void;
}

export function ExportModal({
  isOpen,
  onClose,
  m,
  exportFlash,
  doExportFlash,
  checklistOpenCount,
  onJumpFromChecklist,
}: ExportModalProps) {
  const hint = useHoverHintBinder();
  if (!isOpen) return null;

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Export poem"
      >
        <div className="modal-head">
          <h2 className="modal-title">Export</h2>
          <button type="button" className="small-btn" onClick={onClose}>
            Close
          </button>
        </div>
        {exportFlash ? (
          <p className="export-flash" role="status" aria-live="polite">
            {exportFlash}
          </p>
        ) : null}
        <div className="export-section">
          <h3 className="export-section-title">Download</h3>
          <button
            type="button"
            className="export-card export-card-hero"
            onClick={() => void m.onDownloadDocx().then(() => doExportFlash("Downloaded Word (.docx) ✓"))}
            {...hint("Editable Word document — title, italic form note, line-by-line body.")}
          >
            <span className="export-card-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M8 13l2 5 2-4 2 4 2-5" />
              </svg>
            </span>
            <span className="export-card-body">
              <span className="export-card-label">Word document</span>
              <span className="export-card-sub">.docx — editable, formatted</span>
            </span>
            <span className="export-card-badge">Recommended</span>
          </button>
          <div className="export-card-grid">
            <button
              type="button"
              className="export-card"
              onClick={() => { m.onDownloadTxt(); doExportFlash("Downloaded .txt ✓"); }}
              {...hint("Plain text — universal, no formatting.")}
            >
              <span className="export-card-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <line x1="8" y1="13" x2="16" y2="13" />
                  <line x1="8" y1="17" x2="14" y2="17" />
                </svg>
              </span>
              <span className="export-card-body">
                <span className="export-card-label">Plain text</span>
                <span className="export-card-sub">.txt</span>
              </span>
            </button>
            <button
              type="button"
              className="export-card"
              onClick={() => { m.onDownloadMd(); doExportFlash("Downloaded .md ✓"); }}
              {...hint("Markdown — title as heading, italic form note, preserves bold.")}
            >
              <span className="export-card-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="M7 15V9l3 3 3-3v6" />
                  <path d="M17 9v6m-2-2 2 2 2-2" />
                </svg>
              </span>
              <span className="export-card-body">
                <span className="export-card-label">Markdown</span>
                <span className="export-card-sub">.md</span>
              </span>
            </button>
            <button
              type="button"
              className="export-card"
              onClick={() => void m.onDownloadPdf().then(() => doExportFlash("Downloaded .pdf ✓"))}
              {...hint("Real PDF — print-ready serif layout.")}
            >
              <span className="export-card-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <text x="7.5" y="18" fontSize="6" fontWeight="700" fill="currentColor" stroke="none">PDF</text>
                </svg>
              </span>
              <span className="export-card-body">
                <span className="export-card-label">PDF</span>
                <span className="export-card-sub">.pdf — print-ready</span>
              </span>
            </button>
            <button
              type="button"
              className="export-card"
              onClick={() => void m.onDownloadHtml().then(() => doExportFlash("Downloaded .html ✓"))}
              {...hint("Standalone HTML — styled page, opens in any browser.")}
            >
              <span className="export-card-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
              </span>
              <span className="export-card-body">
                <span className="export-card-label">Web page</span>
                <span className="export-card-sub">.html — styled</span>
              </span>
            </button>
            <button
              type="button"
              className="export-card"
              onClick={() => void m.onDownloadPng().then(() => doExportFlash("Downloaded .png ✓"))}
              {...hint("Image — for social posts, screenshots.")}
            >
              <span className="export-card-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="9" cy="9" r="1.6" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
              </span>
              <span className="export-card-body">
                <span className="export-card-label">Image</span>
                <span className="export-card-sub">.png — share-ready</span>
              </span>
            </button>
          </div>
        </div>
        <div className="export-section">
          <h3 className="export-section-title">Copy &amp; share</h3>
          <div className="export-card-grid">
            <button
              type="button"
              className="export-card"
              onClick={() => void m.onCopyMarkdown().then(() => doExportFlash("Copied Markdown ✓"))}
              {...hint(
                "Copy as Markdown: title becomes a heading, form note is italic, each line preserved — handy for Notion, GitHub, blogs, or ChatGPT.",
              )}
            >
              <span className="export-card-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </span>
              <span className="export-card-body">
                <span className="export-card-label">Copy Markdown</span>
                <span className="export-card-sub">to clipboard</span>
              </span>
            </button>
            <button
              type="button"
              className="export-card"
              onClick={() => window.print()}
              {...hint("Open the browser print dialog.")}
            >
              <span className="export-card-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
              </span>
              <span className="export-card-body">
                <span className="export-card-label">Print</span>
                <span className="export-card-sub">browser dialog</span>
              </span>
            </button>
          </div>
        </div>
        {m.exportErr ? (
          <p className="export-error compact" role="alert">
            {m.exportErr}
          </p>
        ) : null}
        <p className="modal-note">
          Export/copy sends text only where you choose—check the destination’s
          terms.
        </p>
        <div className="export-checklist-row">
          <PublicationChecklistVisual
            items={m.publication.items}
            openCount={checklistOpenCount}
            onJump={onJumpFromChecklist}
          />
        </div>
        {m.folderPickerSupported ? (
          <div className="export-section">
            <h3 className="export-section-title">Save to folder</h3>
            <p className="modal-note">
              Pick a folder on your computer — the website writes the files
              there directly, no “Save as” dialog per file.
            </p>
            {m.folderSaveFlash ? (
              <p className="export-flash" role="status" aria-live="polite">
                {m.folderSaveFlash}
              </p>
            ) : null}
            <div className="modal-actions">
              <button
                type="button"
                className="small-btn"
                onClick={() =>
                  void m.saveCurrentPoemToFolder({
                    txt: true,
                    md: true,
                    html: true,
                    docx: true,
                    pdf: true,
                  })
                }
                {...hint(
                  "Pick a folder and write the current poem as .txt, .md, .html, .docx, and .pdf into it.",
                )}
              >
                Save current poem to folder…
              </button>
              <button
                type="button"
                className="small-btn"
                onClick={() => void m.saveCurrentPoemToFolder({ docx: true })}
                {...hint("Pick a folder and write only the .docx there.")}
              >
                Just .docx
              </button>
              <button
                type="button"
                className="small-btn"
                onClick={() =>
                  void m.saveAllPoemsToFolder({
                    docx: true,
                    txt: true,
                    json: true,
                  })
                }
                {...hint(
                  "Pick a folder and write every poem in your library as .docx + .txt, plus a JSON backup of everything.",
                )}
              >
                Save all poems to folder…
              </button>
            </div>
          </div>
        ) : null}
        <div className="export-backup-row">
          <h3 className="export-backup-title">Workshop backup</h3>
          <p className="modal-note">
            Export or import all drafts + snapshots as a single JSON file—useful for switching devices.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="small-btn"
              onClick={() => { m.exportWorkshopBackup(); doExportFlash("Backup downloaded"); }}
              {...hint("Download all drafts and snapshots as a JSON backup")}
            >
              Export backup (.json)
            </button>
            <button
              type="button"
              className="small-btn"
              onClick={m.triggerImportBackup}
              {...hint("Import a previously exported backup JSON file")}
            >
              Import backup
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
