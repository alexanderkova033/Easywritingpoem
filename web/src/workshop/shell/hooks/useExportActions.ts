import { useCallback, useRef, useState, type ChangeEvent, type MutableRefObject } from "react";
import {
  buildMarkdownPoem,
  buildPlainTextTitleBody,
  copyTextToClipboard,
  downloadDocxFile,
  downloadHtmlFile,
  downloadPdfFile,
  downloadPngFile,
  downloadTextFile,
  exportFilename,
  isDirectoryPickerSupported,
  pickExportDirectory,
  savePoemToDirectory,
  writeTextToDirectory,
  type FolderSaveFormats,
} from "@/workshop/library/export-poem";
import { stripFormatMarkers } from "@/workshop/editor/format-marks";
import {
  buildWorkshopExportJson,
  loadOrCreateLibrary as _loadOrCreateLibrary,
  mergeImportedPoems,
  saveLibrary,
  upsertActivePoem,
  type DraftLibrary,
} from "@/workshop/library/local-draft-library";
import { loadRevisions } from "@/workshop/library/revision-snapshots";
import { STORAGE_KEY_LAST_EXPORT_AT } from "@/shared/storage-keys";

const DRAFT_STORAGE_MSG =
  "Could not save your drafts to this browser (storage may be full or blocked).";

function recordExportAt() {
  try {
    localStorage.setItem(STORAGE_KEY_LAST_EXPORT_AT, new Date().toISOString());
  } catch {
    /* ignore */
  }
}

export interface ExportActionsInput {
  title: string;
  formNote: string;
  bodyLiveRef: MutableRefObject<string>;
  library: DraftLibrary;
  workshopStateRef: MutableRefObject<{
    title: string;
    body: string;
    formNote: string;
    spellMode: import("@/workshop/library/local-draft-storage").SpellMode;
    library: DraftLibrary;
  }>;
  setLibrary: React.Dispatch<React.SetStateAction<DraftLibrary>>;
  setPersistenceError: (msg: string | null) => void;
  setImportNotice: (msg: string | null) => void;
  setImportNoticeKind: (kind: "success" | "error") => void;
  applyLoadedPoem: (lib: DraftLibrary) => void;
  setShowExportReminder: (v: boolean) => void;
}

export function useExportActions(input: ExportActionsInput) {
  const {
    title,
    formNote,
    bodyLiveRef,
    library,
    workshopStateRef,
    setLibrary,
    setPersistenceError,
    setImportNotice,
    setImportNoticeKind,
    applyLoadedPoem,
    setShowExportReminder,
  } = input;

  const [copyExportFlash, setCopyExportFlash] = useState(false);
  const [quickCopyFlash, setQuickCopyFlash] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const copyExportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickCopyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const onDownloadTxt = useCallback(() => {
    const cleanBody = stripFormatMarkers(bodyLiveRef.current);
    const text = buildPlainTextTitleBody(
      title,
      formNote.trim() || undefined,
      cleanBody,
    );
    downloadTextFile(exportFilename(title, "txt", cleanBody), text);
    recordExportAt();
  }, [title, formNote, bodyLiveRef]);

  const onDownloadMd = useCallback(() => {
    const cleanBody = bodyLiveRef.current.replace(/__(.+?)__/g, "$1");
    const text = buildMarkdownPoem(
      title,
      formNote.trim() || undefined,
      cleanBody,
    );
    downloadTextFile(exportFilename(title, "md", cleanBody), text);
    recordExportAt();
  }, [title, formNote, bodyLiveRef]);

  const onCopyMarkdown = useCallback(async () => {
    const cleanBody = bodyLiveRef.current.replace(/__(.+?)__/g, "$1");
    const text = buildMarkdownPoem(
      title,
      formNote.trim() || undefined,
      cleanBody,
    );
    try {
      await copyTextToClipboard(text);
      setCopyExportFlash(true);
      if (copyExportTimer.current) clearTimeout(copyExportTimer.current);
      copyExportTimer.current = setTimeout(() => {
        setCopyExportFlash(false);
        copyExportTimer.current = null;
      }, 1200);
    } catch {
      setPersistenceError("Could not copy to clipboard. Check browser permissions.");
    }
  }, [title, formNote, bodyLiveRef, setPersistenceError]);

  const onQuickCopyPlain = useCallback(async () => {
    try {
      await copyTextToClipboard(stripFormatMarkers(bodyLiveRef.current));
      setQuickCopyFlash(true);
      if (quickCopyTimer.current) clearTimeout(quickCopyTimer.current);
      quickCopyTimer.current = setTimeout(() => {
        setQuickCopyFlash(false);
        quickCopyTimer.current = null;
      }, 1200);
    } catch {
      setPersistenceError("Could not copy to clipboard. Check browser permissions.");
    }
  }, [bodyLiveRef, setPersistenceError]);

  const onDownloadDocx = useCallback(async () => {
    setExportErr(null);
    try {
      const cleanBody = stripFormatMarkers(bodyLiveRef.current);
      await downloadDocxFile(
        exportFilename(title, "docx", cleanBody),
        title,
        formNote.trim() || undefined,
        cleanBody,
      );
      recordExportAt();
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "Could not build the Word file.");
    }
  }, [title, formNote, bodyLiveRef]);

  const onDownloadPdf = useCallback(async () => {
    setExportErr(null);
    try {
      const cleanBody = stripFormatMarkers(bodyLiveRef.current);
      await downloadPdfFile(
        exportFilename(title, "pdf", cleanBody),
        title,
        formNote.trim() || undefined,
        cleanBody,
      );
      recordExportAt();
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "Could not build the PDF.");
    }
  }, [title, formNote, bodyLiveRef]);

  const onDownloadHtml = useCallback(async () => {
    setExportErr(null);
    try {
      const cleanBody = stripFormatMarkers(bodyLiveRef.current);
      await downloadHtmlFile(
        exportFilename(title, "html", cleanBody),
        title,
        formNote.trim() || undefined,
        cleanBody,
      );
      recordExportAt();
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "Could not build the HTML file.");
    }
  }, [title, formNote, bodyLiveRef]);

  const onDownloadPng = useCallback(async () => {
    setExportErr(null);
    try {
      const cleanBody = stripFormatMarkers(bodyLiveRef.current);
      await downloadPngFile(
        exportFilename(title, "png", cleanBody),
        title,
        formNote.trim() || undefined,
        cleanBody,
      );
      recordExportAt();
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "Could not build the image.");
    }
  }, [title, formNote, bodyLiveRef]);

  const [folderSaveFlash, setFolderSaveFlash] = useState<string | null>(null);
  const folderSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashFolderSave = useCallback((msg: string) => {
    setFolderSaveFlash(msg);
    if (folderSaveTimer.current) clearTimeout(folderSaveTimer.current);
    folderSaveTimer.current = setTimeout(() => {
      setFolderSaveFlash(null);
      folderSaveTimer.current = null;
    }, 2500);
  }, []);

  const folderPickerSupported = isDirectoryPickerSupported();

  const saveCurrentPoemToFolder = useCallback(
    async (formats: FolderSaveFormats) => {
      setExportErr(null);
      if (!isDirectoryPickerSupported()) {
        setExportErr(
          "This browser does not support saving to a folder. Use Chrome, Edge, or Opera on desktop.",
        );
        return;
      }
      const dir = await pickExportDirectory();
      if (!dir) return;
      try {
        const cleanBody = stripFormatMarkers(bodyLiveRef.current);
        const written = await savePoemToDirectory(dir, {
          title,
          formNote: formNote.trim() || undefined,
          body: cleanBody,
          formats,
        });
        recordExportAt();
        flashFolderSave(
          written.length === 1
            ? `Saved ${written[0]} to ${dir.name} ✓`
            : `Saved ${written.length} files to ${dir.name} ✓`,
        );
      } catch (e) {
        setExportErr(
          e instanceof Error
            ? `Folder save failed: ${e.message}`
            : "Folder save failed.",
        );
      }
    },
    [title, formNote, bodyLiveRef, flashFolderSave],
  );

  const saveAllPoemsToFolder = useCallback(
    async (formats: FolderSaveFormats) => {
      setExportErr(null);
      if (!isDirectoryPickerSupported()) {
        setExportErr(
          "This browser does not support saving to a folder. Use Chrome, Edge, or Opera on desktop.",
        );
        return;
      }
      const dir = await pickExportDirectory();
      if (!dir) return;
      try {
        const state = workshopStateRef.current;
        const flushed = upsertActivePoem(state.library, {
          title: state.title,
          body: state.body,
          form: state.formNote,
          spellMode: state.spellMode,
        });
        let totalFiles = 0;
        for (const poem of flushed.poems) {
          const cleanBody = stripFormatMarkers(poem.body);
          const written = await savePoemToDirectory(dir, {
            title: poem.title,
            formNote: poem.form?.trim() || undefined,
            body: cleanBody,
            formats,
          });
          totalFiles += written.length;
        }
        if (formats.json) {
          const json = buildWorkshopExportJson({
            poems: flushed.poems,
            revisionsForPoem: loadRevisions,
          });
          const stamp = new Date().toISOString().slice(0, 10);
          await writeTextToDirectory(
            dir,
            `easy-poems-backup-${stamp}.json`,
            json,
          );
          totalFiles += 1;
        }
        recordExportAt();
        flashFolderSave(
          `Saved ${totalFiles} file${totalFiles === 1 ? "" : "s"} (${flushed.poems.length} poem${
            flushed.poems.length === 1 ? "" : "s"
          }) to ${dir.name} ✓`,
        );
      } catch (e) {
        setExportErr(
          e instanceof Error
            ? `Folder save failed: ${e.message}`
            : "Folder save failed.",
        );
      }
    },
    [workshopStateRef, flashFolderSave],
  );

  const exportWorkshopBackup = useCallback(() => {
    const json = buildWorkshopExportJson({
      poems: library.poems,
      revisionsForPoem: loadRevisions,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`easy-poems-backup-${stamp}.json`, json);
    recordExportAt();
    setShowExportReminder(false);
  }, [library.poems, setShowExportReminder]);

  const triggerImportBackup = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const onImportBackupFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        const { title: t, body: b, formNote: f, spellMode: sm, library: lib } =
          workshopStateRef.current;
        const flushed = upsertActivePoem(lib, {
          title: t,
          body: b,
          form: f,
          spellMode: sm,
        });
        if (!saveLibrary(flushed)) {
          setPersistenceError(DRAFT_STORAGE_MSG);
          return;
        }
        const merged = mergeImportedPoems(flushed, text);
        if ("error" in merged) {
          setImportNoticeKind("error");
          setImportNotice(merged.error);
          return;
        }
        if (!saveLibrary(merged.lib)) {
          setPersistenceError(DRAFT_STORAGE_MSG);
          return;
        }
        setImportNoticeKind("success");
        setImportNotice(`Imported ${merged.added} poem(s).`);
        setLibrary(merged.lib);
        applyLoadedPoem(merged.lib);
      };
      reader.onerror = () => {
        setImportNoticeKind("error");
        setImportNotice("Could not read the file. Check that it is a valid text file and try again.");
      };
      reader.onabort = () => {
        setImportNoticeKind("error");
        setImportNotice("File read was cancelled.");
      };
      reader.readAsText(file, "utf-8");
    },
    [applyLoadedPoem, workshopStateRef, setLibrary, setPersistenceError, setImportNotice, setImportNoticeKind],
  );

  return {
    copyExportFlash,
    quickCopyFlash,
    exportErr,
    importInputRef,
    onDownloadTxt,
    onDownloadMd,
    onDownloadDocx,
    onDownloadPdf,
    onDownloadHtml,
    onDownloadPng,
    onCopyMarkdown,
    onQuickCopyPlain,
    exportWorkshopBackup,
    triggerImportBackup,
    onImportBackupFile,
    folderPickerSupported,
    folderSaveFlash,
    saveCurrentPoemToFolder,
    saveAllPoemsToFolder,
  };
}
