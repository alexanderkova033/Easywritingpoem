/**
 * Debounce shared by the editor spell decorations and the workshop heavy-body
 * sync so the sidebar list matches what the editor highlights.
 * Touch devices use a longer window — spell scan is the dominant per-keystroke
 * cost on iPad after the CSS / CodeMirror gating.
 */
const IS_TOUCH =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

export const SPELL_ANALYSIS_DEBOUNCE_MS = IS_TOUCH ? 600 : 320;

/**
 * How long to wait before pushing poem body from the CodeMirror buffer into React.
 * Keeps the workshop shell from re-rendering on every keystroke while typing fast.
 * Bumped from 100ms — at 100ms a continuous typist triggers a full workshop
 * re-render ~10x/sec; 180ms halves that without making the tools panel feel
 * laggy. Touch gets an even longer window.
 */
export const BODY_TO_REACT_DEBOUNCE_MS = IS_TOUCH ? 280 : 180;
