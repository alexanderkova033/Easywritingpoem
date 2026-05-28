import { useMemo, useState } from "react";
import type {
  RepeatedWord,
} from "@/workshop/analysis/repeated-words";
import {
  buildPhraseRegex,
  buildPhraseRegexSource,
  cropAroundMatch,
  escapeRegex,
  highlightInLine,
} from "./helpers";

export function RepeatedWordCard({
  item,
  cardId,
  goToLine,
  peekToLine,
  clearHoverPeek,
  onReject,
}: {
  item: RepeatedWord;
  cardId?: string;
  goToLine: (line1Based: number) => void;
  peekToLine?: (line1Based: number, word?: string) => void;
  clearHoverPeek?: () => void;
  onReject?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const variantList =
    item.variants.length > 1 ? item.variants.join(", ") : null;
  const wordRe = useMemo(() => {
    const escaped = escapeRegex(item.word);
    if (item.variants.length > 1) {
      const stem = escaped.replace(/(ing|ed|es|s|y)$/i, "");
      return new RegExp(`\\b${stem}\\w*\\b`, "gi");
    }
    return new RegExp(`\\b${escaped}\\b`, "gi");
  }, [item.word, item.variants]);
  const previewOccurrences = open ? item.occurrences : item.occurrences.slice(0, 2);
  return (
    <li className="rep-card" data-repeat-card-id={cardId}>
      <div className="rep-card-header">
        <span className="rep-card-title">{item.display}</span>
        <span className="rep-card-count">×{item.count}</span>
        {variantList ? (
          <span className="rep-card-variants" title={`Variants: ${variantList}`}>
            {item.variants.length} forms
          </span>
        ) : null}
        <span className="rep-card-gap muted small">
          {item.minGap === Number.POSITIVE_INFINITY
            ? ""
            : item.minGap <= 0
              ? "same line"
              : item.minGap === 1
                ? "adjacent lines"
                : `${item.minGap} lines apart`}
        </span>
        {onReject ? (
          <button
            type="button"
            className="craft-cluster-reject"
            onClick={onReject}
            title="Hide this repeat"
            aria-label={`Hide “${item.display}”`}
          >
            ×
          </button>
        ) : null}
      </div>
      <ul className="rep-snippets">
        {previewOccurrences.map((o, i) => (
          <li
            key={`${o.line}-${o.start}-${i}`}
            className="rep-snippet"
            onMouseEnter={() => peekToLine?.(o.line, item.display)}
            onMouseLeave={() => clearHoverPeek?.()}
          >
            <button
              type="button"
              className="rep-line-jump linkish"
              onClick={() => goToLine(o.line)}
              onFocus={() => peekToLine?.(o.line, item.display)}
              onBlur={() => clearHoverPeek?.()}
              aria-label={`Go to line ${o.line}`}
              title="Click to jump, hover to peek"
            >
              L{o.line}
            </button>
            <span className="rep-snippet-text">
              {highlightInLine(cropAroundMatch(o.lineText, wordRe, 28), wordRe)}
            </span>
          </li>
        ))}
      </ul>
      {item.occurrences.length > 2 ? (
        <button
          type="button"
          className="rep-show-more linkish small"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Show less" : `Show ${item.occurrences.length - 2} more`}
        </button>
      ) : null}
    </li>
  );
}

export function PhraseRepeatCard({
  item,
  cardId,
  goToLine,
  peekToLine,
  clearHoverPeek,
}: {
  item: import("@/workshop/analysis/repeated-words").PhraseRepeat;
  cardId?: string;
  goToLine: (line1Based: number) => void;
  peekToLine?: (line1Based: number, word?: string) => void;
  clearHoverPeek?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const previewSnippets = open ? item.snippets : item.snippets.slice(0, 2);
  const phraseRe = useMemo(() => buildPhraseRegex(item.phrase), [item.phrase]);
  return (
    <li className="rep-card" data-repeat-card-id={cardId}>
      <div className="rep-card-header">
        <span className="rep-card-title">"{item.display}"</span>
        <span className="rep-card-count">×{item.count}</span>
        <span className="rep-card-meta muted small">{item.n}-word</span>
      </div>
      <ul className="rep-snippets">
        {previewSnippets.map((s, i) => (
          <li
            key={`${s.line}-${i}`}
            className="rep-snippet"
            onMouseEnter={() => peekToLine?.(s.line, item.display)}
            onMouseLeave={() => clearHoverPeek?.()}
          >
            <button
              type="button"
              className="rep-line-jump linkish"
              onClick={() => goToLine(s.line)}
              onFocus={() => peekToLine?.(s.line, item.display)}
              onBlur={() => clearHoverPeek?.()}
              aria-label={`Go to line ${s.line}`}
              title="Click to jump, hover to peek"
            >
              L{s.line}
            </button>
            <span className="rep-snippet-text">
              {highlightInLine(cropAroundMatch(s.text, phraseRe, 28), phraseRe)}
            </span>
          </li>
        ))}
      </ul>
      {item.snippets.length > 2 ? (
        <button
          type="button"
          className="rep-show-more linkish small"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Show less" : `Show ${item.snippets.length - 2} more`}
        </button>
      ) : null}
    </li>
  );
}

export function EdgeRepeatCard({
  group,
  cardId,
  edge,
  goToLine,
  peekToLine,
  clearHoverPeek,
}: {
  group: import("@/workshop/analysis/repeated-words").AnaphoraGroup;
  cardId?: string;
  edge: "start" | "end";
  goToLine: (line1Based: number) => void;
  peekToLine?: (line1Based: number, word?: string) => void;
  clearHoverPeek?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const previewSnippets = open ? group.snippets : group.snippets.slice(0, 3);
  const matchRe = useMemo(() => {
    const body = buildPhraseRegexSource(group.prefix);
    return edge === "start"
      ? new RegExp(`^[^A-Za-z']*${body}`, "gi")
      : new RegExp(`${body}[^A-Za-z']*$`, "gi");
  }, [group.prefix, edge]);
  return (
    <li className="rep-card rep-card-pattern" data-repeat-card-id={cardId}>
      <div className="rep-card-header">
        <span className="rep-pattern-icon" aria-hidden="true">
          {edge === "start" ? "↦" : "↤"}
        </span>
        <span className="rep-card-title">"{group.display}"</span>
        <span className="rep-card-count">×{group.lines.length}</span>
        <span className="rep-card-meta muted small">
          {edge === "start" ? "line-start" : "line-end"}
        </span>
      </div>
      <ul className="rep-snippets">
        {previewSnippets.map((s, i) => (
          <li
            key={`${s.line}-${i}`}
            className="rep-snippet"
            onMouseEnter={() => peekToLine?.(s.line, group.display)}
            onMouseLeave={() => clearHoverPeek?.()}
          >
            <button
              type="button"
              className="rep-line-jump linkish"
              onClick={() => goToLine(s.line)}
              onFocus={() => peekToLine?.(s.line, group.display)}
              onBlur={() => clearHoverPeek?.()}
              aria-label={`Go to line ${s.line}`}
              title="Click to jump, hover to peek"
            >
              L{s.line}
            </button>
            <span className="rep-snippet-text">
              {highlightInLine(cropAroundMatch(s.text, matchRe, 28), matchRe)}
            </span>
          </li>
        ))}
      </ul>
      {group.snippets.length > 3 ? (
        <button
          type="button"
          className="rep-show-more linkish small"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Show less" : `Show ${group.snippets.length - 3} more`}
        </button>
      ) : null}
    </li>
  );
}
