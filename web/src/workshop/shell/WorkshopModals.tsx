import { lazy, Suspense } from "react";
import { TemplatesModal } from "./TemplatesModal";
import type { SharedPoem } from "@/workshop/sharing/sharing";

// Heavy modals are lazy — first paint of the workshop doesn't need them.
// Each opens infrequently and ships its own CSS, so deferring them keeps
// the initial JS payload smaller and improves first-load over slow links.
const ReadingModeModal = lazy(() =>
  import("@/workshop/reading/ReadingModeModal").then((m) => ({ default: m.ReadingModeModal })),
);
const ShareModal = lazy(() =>
  import("@/workshop/sharing/ShareModal").then((m) => ({ default: m.ShareModal })),
);
const ViewSharedPoem = lazy(() =>
  import("@/workshop/sharing/ShareModal").then((m) => ({ default: m.ViewSharedPoem })),
);

interface WorkshopModalsProps {
  // Templates
  isTemplatesOpen: boolean;
  onCloseTemplates: () => void;
  onInsertTemplate: (body: string, form: string) => void;
  // Reading mode
  isReadingMode: boolean;
  onCloseReadingMode: () => void;
  title: string;
  formNote: string;
  body: string;
  // Share
  isShareOpen: boolean;
  onCloseShare: () => void;
  // Shared poem view
  sharedPoemView: SharedPoem | null;
  onDismissSharedPoem: () => void;
  onAddSharedPoemToDrafts: (poem: SharedPoem) => void;
}

export function WorkshopModals({
  isTemplatesOpen, onCloseTemplates, onInsertTemplate,
  isReadingMode, onCloseReadingMode, title, formNote, body,
  isShareOpen, onCloseShare,
  sharedPoemView, onDismissSharedPoem, onAddSharedPoemToDrafts,
}: WorkshopModalsProps) {
  return (
    <>
      {isTemplatesOpen && (
        <TemplatesModal
          onClose={onCloseTemplates}
          onInsert={onInsertTemplate}
        />
      )}

      {isReadingMode && (
        <Suspense fallback={null}>
          <ReadingModeModal
            title={title}
            formNote={formNote}
            body={body}
            onClose={onCloseReadingMode}
          />
        </Suspense>
      )}

      {isShareOpen && (
        <Suspense fallback={null}>
          <ShareModal
            poem={{ title, body }}
            onClose={onCloseShare}
          />
        </Suspense>
      )}

      {sharedPoemView && (
        <Suspense fallback={null}>
          <ViewSharedPoem
            poem={sharedPoemView}
            onDismiss={onDismissSharedPoem}
            onAddToDrafts={() => onAddSharedPoemToDrafts(sharedPoemView)}
          />
        </Suspense>
      )}
    </>
  );
}
