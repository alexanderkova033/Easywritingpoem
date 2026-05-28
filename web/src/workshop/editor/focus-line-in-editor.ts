import type { EditorView } from "@codemirror/view";

/** Select a logical line in a CodeMirror 6 view (1-based line numbers). */
export function focusLineInEditor(
  view: EditorView,
  line1Based: number,
): void {
  const doc = view.state.doc;
  const n = Math.max(1, Math.min(line1Based, doc.lines));
  const line = doc.line(n);
  view.dispatch({
    selection: { anchor: line.from, head: line.to },
    scrollIntoView: true,
  });
  view.focus();
}

/** Place the cursor (no selection) at a 0-based document offset. */
export function focusCursorInEditor(
  view: EditorView,
  pos: number,
): void {
  const doc = view.state.doc;
  const p = Math.max(0, Math.min(pos, doc.length));
  view.dispatch({
    selection: { anchor: p, head: p },
    scrollIntoView: true,
  });
  view.focus();
}

/** Select a character range in the document (0-based offsets, end-exclusive). */
export function focusCharacterRangeInEditor(
  view: EditorView,
  from: number,
  to: number,
): void {
  const doc = view.state.doc;
  const len = doc.length;
  const a = Math.max(0, Math.min(from, len));
  const b = Math.max(0, Math.min(to, len));
  view.dispatch({
    selection: { anchor: a, head: b },
    scrollIntoView: true,
  });
  view.focus();
}

/** Select only the last word on a line (1-based). Falls back to the full line if the line has no word characters. */
export function focusLastWordInLine(
  view: EditorView,
  line1Based: number,
): void {
  const doc = view.state.doc;
  const n = Math.max(1, Math.min(line1Based, doc.lines));
  const line = doc.line(n);
  const text = line.text;
  const re = /[a-zA-Z']+/g;
  let last: { start: number; end: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    last = { start: m.index, end: m.index + m[0].length };
  }
  if (!last) {
    view.dispatch({
      selection: { anchor: line.from, head: line.to },
      scrollIntoView: true,
    });
  } else {
    view.dispatch({
      selection: {
        anchor: line.from + last.start,
        head: line.from + last.end,
      },
      scrollIntoView: true,
    });
  }
  view.focus();
}
