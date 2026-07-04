export function EditorEndOfTextLine({ lineCount, visible }: { lineCount: number; visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="poem-end-of-text-line"
      style={{
        top: `calc(0.6rem + ${lineCount} * var(--poem-font-size, 1rem) * var(--poem-line-height, 1.65))`,
      }}
      aria-hidden
    />
  );
}
