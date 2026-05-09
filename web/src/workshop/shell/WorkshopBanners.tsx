import type { usePoemWorkshopModel } from "./usePoemWorkshopModel";

type Model = ReturnType<typeof usePoemWorkshopModel>;

export function WorkshopBanners({ m }: { m: Model }) {
  return (
    <>
      {m.persistenceError ? (
        <div
          className="persistence-banner"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="persistence-banner-text">{m.persistenceError}</p>
          {m.storageNearlyFull ? (
            <button
              type="button"
              className="small-btn small-btn-primary persistence-banner-export"
              onClick={() => {
                void m.exportWorkshopBackup();
                m.dismissPersistenceError();
              }}
            >
              Export now
            </button>
          ) : null}
          <button
            type="button"
            className="small-btn persistence-banner-dismiss"
            onClick={m.dismissPersistenceError}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {m.wordlistErr ? (
        <div
          className="spell-warn-banner"
          role="status"
          aria-live="polite"
        >
          <p className="spell-warn-banner-text">
            Spell check unavailable: {m.wordlistErr}
          </p>
          <button
            type="button"
            className="small-btn spell-warn-retry-btn"
            onClick={m.retryWordlist}
          >
            Retry
          </button>
        </div>
      ) : null}

      {m.importNotice ? (
        <div
          className={`import-notice-banner ${m.importNoticeKind === "error" ? "is-error" : "is-success"}`}
          role="status"
          aria-live="polite"
        >
          <p className="import-notice-text">{m.importNotice}</p>
          <button
            type="button"
            className="small-btn import-notice-dismiss"
            onClick={m.dismissImportNotice}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {m.showExportReminder ? (
        <div
          className="import-notice-banner"
          role="status"
          aria-live="polite"
        >
          <p className="import-notice-text">
            It&rsquo;s been a while since your last backup. Export your workshop
            to keep a local copy of all your drafts.
          </p>
          <button
            type="button"
            className="small-btn"
            onClick={() => {
              void m.exportWorkshopBackup();
            }}
          >
            Export now
          </button>
          <button
            type="button"
            className="small-btn import-notice-dismiss"
            onClick={m.dismissExportReminder}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </>
  );
}
