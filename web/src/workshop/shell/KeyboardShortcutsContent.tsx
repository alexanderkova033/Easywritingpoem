/** Shared copy for keyboard help (modal + command palette hint). */
export function KeyboardShortcutsContent() {
  return (
    <>
      <p className="shortcuts-modal-lead muted small">
        These shortcuts work globally unless your cursor is in the poem or another
        text field.
      </p>
      <ul className="shortcuts-modal-list">
        <li>
          <kbd className="kbd-hint">Alt</kbd> + <kbd className="kbd-hint">1</kbd> /{" "}
          <kbd className="kbd-hint">2</kbd> / <kbd className="kbd-hint">3</kbd> — jump
          to Overview / Sound / Suggest panel.
        </li>
        <li>
          <kbd className="kbd-hint">Alt</kbd> + <kbd className="kbd-hint">[</kbd> /{" "}
          <kbd className="kbd-hint">]</kbd> — cycle tabs within the current panel.
        </li>
        <li>
          <kbd className="kbd-hint">⌘</kbd> / <kbd className="kbd-hint">Ctrl</kbd> +{" "}
          <kbd className="kbd-hint">K</kbd> — open command palette.
        </li>
        <li>
          <kbd className="kbd-hint">⌘</kbd> / <kbd className="kbd-hint">Ctrl</kbd> +{" "}
          <kbd className="kbd-hint">Shift</kbd> + <kbd className="kbd-hint">R</kbd> — toggle reading view.
        </li>
        <li>
          <kbd className="kbd-hint">⌘</kbd> / <kbd className="kbd-hint">Ctrl</kbd> +{" "}
          <kbd className="kbd-hint">F</kbd> — find in poem.
        </li>
        <li>
          <kbd className="kbd-hint">⌘</kbd> / <kbd className="kbd-hint">Ctrl</kbd> +{" "}
          <kbd className="kbd-hint">H</kbd> — replace in poem.
        </li>
        <li>
          When spelling flags exist: <kbd className="kbd-hint">F7</kbd> /{" "}
          <kbd className="kbd-hint">Shift</kbd> + <kbd className="kbd-hint">F7</kbd> — next / previous flag.
        </li>
      </ul>
      <p className="shortcuts-modal-note muted small">
        Word definitions when you select text use the web (dictionary + related-word
        lookup). Syllable and rhyme tools are rough local heuristics—signals, not a
        grade.
      </p>
    </>
  );
}
