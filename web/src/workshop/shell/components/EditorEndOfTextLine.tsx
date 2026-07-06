import { useEffect, useRef, useState } from "react";

export function EditorEndOfTextLine({ lineCount, visible }: { lineCount: number; visible: boolean }) {
  const prevLineCount = useRef(lineCount);
  const [isShifting, setIsShifting] = useState(false);

  useEffect(() => {
    if (prevLineCount.current !== lineCount) {
      prevLineCount.current = lineCount;
      setIsShifting(true);
      const id = setTimeout(() => setIsShifting(false), 220);
      return () => clearTimeout(id);
    }
  }, [lineCount]);

  if (!visible) return null;
  return (
    <div
      className={`poem-end-of-text-line${isShifting ? " is-shifting" : ""}`}
      style={{
        top: `calc(0.6rem + ${lineCount} * var(--poem-font-size, 1rem) * var(--poem-line-height, 1.65) + 0.6rem)`,
      }}
      aria-hidden
    />
  );
}
