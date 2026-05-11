import type {
  ChecklistIcon,
  ChecklistItem,
} from "./publication-checklist";

interface Props {
  items: ChecklistItem[];
  openCount: number;
  onJump: (item: ChecklistItem) => void;
}

export function PublicationChecklistVisual({
  items,
  openCount,
  onJump,
}: Props) {
  const total = items.length;
  const done = total - openCount;
  const pct = total === 0 ? 1 : done / total;
  const ready = openCount === 0;

  const size = 56;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct);

  return (
    <section
      className={`publication-checklist ${ready ? "is-ready" : "is-open"}`}
      aria-label="Publication checklist"
    >
      <header className="publication-checklist-head">
        <div
          className="publication-progress"
          role="img"
          aria-label={`${done} of ${total} ready`}
        >
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            aria-hidden
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={stroke}
              className="publication-progress-track"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="publication-progress-fill"
            />
          </svg>
          <span className="publication-progress-num" aria-hidden>
            {done}<span className="publication-progress-slash">/</span>{total}
          </span>
        </div>
        <div className="publication-checklist-heading">
          <h3 className="publication-checklist-title">Publication checklist</h3>
          <p className="publication-checklist-sub">
            {ready
              ? "Everything looks good — ready to share."
              : `${openCount} item${openCount === 1 ? "" : "s"} still need attention.`}
          </p>
        </div>
        {ready ? (
          <span className="publication-ready-pill" aria-hidden>✓ Ready</span>
        ) : null}
      </header>
      <ul className="publication-items">
        {items.map((item) => (
          <li
            key={item.text}
            className={`publication-item ${item.done ? "done" : "open"}`}
          >
            <span className="publication-item-icon" aria-hidden>
              <ChecklistIconGlyph icon={item.icon} />
            </span>
            <span className="publication-item-body">
              <span className="publication-item-title">{item.text}</span>
              {item.detail ? (
                <span className="publication-item-detail">{item.detail}</span>
              ) : null}
            </span>
            <span
              className="publication-item-status"
              aria-label={item.done ? "Done" : "Needs attention"}
            >
              {item.done ? (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="5 12 10 17 19 7"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9"/>
                  <line x1="12" y1="8" x2="12" y2="13"/>
                  <line x1="12" y1="16" x2="12" y2="16.5"/>
                </svg>
              )}
            </span>
            {!item.done && (item.openToolTab || item.focusTitleField) ? (
              <button
                type="button"
                className="publication-item-jump"
                onClick={() => onJump(item)}
              >
                {item.focusTitleField ? "Focus title" : "Open tool"}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChecklistIconGlyph({ icon }: { icon: ChecklistIcon }) {
  switch (icon) {
    case "lines":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="7" x2="20" y2="7"/>
          <line x1="4" y1="12" x2="16" y2="12"/>
          <line x1="4" y1="17" x2="13" y2="17"/>
        </svg>
      );
    case "title":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 7 4 5 20 5 20 7"/>
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="9" y1="19" x2="15" y2="19"/>
        </svg>
      );
    case "spell":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19l5-14 5 14"/>
          <line x1="6" y1="14" x2="12" y2="14"/>
          <path d="M16 12c1.4 0 2.5.9 2.5 2.5S17.4 17 16 17h-1v-5h1z"/>
        </svg>
      );
    case "goals":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <circle cx="12" cy="12" r="5"/>
          <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
        </svg>
      );
  }
}
