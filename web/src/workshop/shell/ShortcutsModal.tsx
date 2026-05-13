import { KeyboardShortcutsContent } from "./KeyboardShortcutsContent";

export interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
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
        className="modal shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
      >
        <div className="modal-head">
          <h2 id="shortcuts-modal-title" className="modal-title">
            Keyboard shortcuts
          </h2>
          <button type="button" className="small-btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="shortcuts-modal-body">
          <KeyboardShortcutsContent />
        </div>
      </section>
    </div>
  );
}
