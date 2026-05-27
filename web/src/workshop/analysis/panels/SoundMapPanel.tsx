import { useEffect, useMemo, useState } from "react";
import {
  buildLineSounds,
  endStopLabel,
  findEchoes,
  SOUND_CLASS_BLURB,
  SOUND_CLASS_HUES,
  SOUND_CLASS_LABELS,
  summarisePauses,
  type SoundClass,
  type SoundEcho,
} from "@/workshop/sound/sound-map-analysis";
import { EmptyState, NoLinesYetHint } from "@/workshop/analysis/tools/shared";
import { LiveSectionTitle } from "../ToolTabBar";

export interface EditorEchoHighlight {
  line: number;
  start: number;
  end: number;
  colorKey: string;
  /** Per-echo color (CSS color string). Overrides the class-based color when set. */
  color?: string;
  /** Technique label (e.g. "alliteration") — shown next to the first member when present. */
  label?: string;
}

/** Deterministic per-echo hue from class+key so the same echo always has the same color. */
function echoColor(echo: SoundEcho): string {
  const s = `${echo.className}|${echo.key}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  return `hsl(${hue}, 58%, 58%)`;
}

export interface EditorLineVowelTint {
  line: number;
  bucket: "bright" | "mid" | "dark";
  active?: boolean;
}

export interface EditorFlowMarker {
  line: number;
  endStop: "hard" | "soft" | "open";
  caesuraColumn: number | null;
  active?: boolean;
}

export interface SoundMapPanelProps {
  poemLines: string[];
  stressLexicon: ReadonlyMap<string, string> | null;
  stressLexiconReady: boolean;
  heavyToolsStale: boolean;
  goToLine: (line1Based: number) => void;
  /** When provided, the panel reports which words to highlight in the editor. */
  onEchoHighlightsChange?: (highlights: EditorEchoHighlight[] | null) => void;
  onLineVowelTintsChange?: (tints: EditorLineVowelTint[] | null) => void;
  onFlowMarkersChange?: (markers: EditorFlowMarker[] | null) => void;
}

const VOWEL_BUCKET: Record<string, "bright" | "mid" | "dark"> = {
  a: "bright", e: "bright", i: "bright", ay: "bright",
  ee: "bright", ih: "bright", y: "bright",
  uh: "mid", er: "mid",
  ah: "dark", aw: "dark", ow: "dark", oh: "dark",
  oy: "dark", oo: "dark", o: "dark", u: "dark",
};
const VOWEL_BUCKET_LABEL = { bright: "Bright", mid: "Mid", dark: "Dark" } as const;
const VOWEL_BUCKET_EXAMPLES = {
  bright: "ee, ay, i",
  mid: "uh, er",
  dark: "oo, oh, ah",
} as const;
const VOWEL_BUCKET_HUE = {
  bright: "#e6b550",
  mid:    "#88a596",
  dark:   "#6a78b8",
} as const;

type SoundSubTab = "echoes" | "vowels" | "flow";

const ALL_CLASSES: SoundClass[] = [
  "alliteration",
  "assonance",
  "consonance",
  "sibilance",
  "plosive",
  "liquid",
];

function EchoCard({
  echo,
  goToLine,
  echoId,
  isActive,
  onHoverChange,
}: {
  echo: SoundEcho;
  goToLine: (line: number) => void;
  echoId: string;
  isActive: boolean;
  onHoverChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const previewMax = 6;
  const preview = open ? echo.members : echo.members.slice(0, previewMax);
  const tint = echoColor(echo);
  const gapLabel =
    echo.minGap > 0
      ? echo.minGap === 1
        ? "adjacent"
        : echo.span <= 3
          ? "tight"
          : `across ${echo.span + 1} lines`
      : null;
  return (
    <li
      className={`rep-card sound-echo-card${isActive ? " is-active" : ""}`}
      style={{ borderLeftColor: tint }}
      onMouseEnter={() => onHoverChange(echoId)}
      onMouseLeave={() => onHoverChange(null)}
      onFocus={() => onHoverChange(echoId)}
      onBlur={() => onHoverChange(null)}
    >
      <div className="sound-echo-card-head">
        <span className="sound-echo-key">/{echo.key}/</span>
        <span className="sound-echo-count" style={{ color: tint }}>×{echo.members.length}</span>
        {gapLabel && <span className="sound-echo-gap muted small">{gapLabel}</span>}
      </div>
      <div className="sound-echo-members">
        {preview.map((m, i) => (
          <button
            key={`${m.lineNumber}-${i}`}
            type="button"
            className="sound-echo-chip"
            onClick={() => goToLine(m.lineNumber)}
            title={`Jump to line ${m.lineNumber}`}
            style={{ borderColor: tint }}
          >
            <span className="sound-echo-chip-word">{m.word}</span>
            <span className="sound-echo-chip-line">L{m.lineNumber}</span>
          </button>
        ))}
      </div>
      {echo.members.length > previewMax && (
        <button
          type="button"
          className="rep-show-more linkish small"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Show less" : `Show ${echo.members.length - previewMax} more`}
        </button>
      )}
    </li>
  );
}

export function SoundMapPanel({
  poemLines,
  stressLexicon,
  stressLexiconReady,
  heavyToolsStale,
  goToLine,
  onEchoHighlightsChange,
  onLineVowelTintsChange,
  onFlowMarkersChange,
}: SoundMapPanelProps) {
  const [subTab, setSubTab] = useState<SoundSubTab>("echoes");
  const [classFilter, setClassFilter] = useState<SoundClass | "all">("all");
  const [hoveredEchoId, setHoveredEchoId] = useState<string | null>(null);
  const [hoveredVowelLine, setHoveredVowelLine] = useState<number | null>(null);
  const [hoveredFlowLine, setHoveredFlowLine] = useState<number | null>(null);
  const [showTechnique, setShowTechnique] = useState(false);

  useEffect(() => {
    if (showTechnique) {
      document.documentElement.classList.add("show-echo-technique");
      return () => document.documentElement.classList.remove("show-echo-technique");
    }
    document.documentElement.classList.remove("show-echo-technique");
  }, [showTechnique]);

  const lineSounds = useMemo(
    () => buildLineSounds(poemLines, stressLexicon),
    [poemLines, stressLexicon],
  );

  const nonEmpty = lineSounds.some((l) => l.tokens.length > 0);
  const echoes = useMemo(() => findEchoes(lineSounds), [lineSounds]);
  const pauseStats = useMemo(() => summarisePauses(lineSounds), [lineSounds]);
  const byClass = useMemo(() => {
    const m: Record<SoundClass, SoundEcho[]> = {
      alliteration: [], assonance: [], consonance: [],
      sibilance: [], plosive: [], liquid: [],
    };
    for (const e of echoes) m[e.className].push(e);
    return m;
  }, [echoes]);
  const classCounts = useMemo(() => {
    const counts: Record<SoundClass, number> = {
      alliteration: 0, assonance: 0, consonance: 0,
      sibilance: 0, plosive: 0, liquid: 0,
    };
    for (const c of ALL_CLASSES) counts[c] = byClass[c].length;
    return counts;
  }, [byClass]);
  const visibleClassesWithEchoes = useMemo(
    () =>
      ALL_CLASSES.filter(
        (c) => byClass[c].length > 0 && (classFilter === "all" || classFilter === c),
      ),
    [byClass, classFilter],
  );

  const lineSoundsByLine = useMemo(() => {
    const m = new Map<number, (typeof lineSounds)[number]>();
    for (const ls of lineSounds) m.set(ls.lineNumber, ls);
    return m;
  }, [lineSounds]);

  // Which vowels actually appear in this poem (for the legend).
  const usedVowels = useMemo(() => {
    const seen = new Set<string>();
    for (const ls of lineSounds) if (ls.dominantVowel) seen.add(ls.dominantVowel);
    return [...seen].sort();
  }, [lineSounds]);

  // Caesura token index → column position in the line text.
  const caesuraColumnsByLine = useMemo(() => {
    const m = new Map<number, number | null>();
    for (const ls of lineSounds) {
      if (ls.caesuraAt === null) { m.set(ls.lineNumber, null); continue; }
      const tok = ls.tokens[ls.caesuraAt];
      m.set(ls.lineNumber, tok ? tok.end : null);
    }
    return m;
  }, [lineSounds]);

  const echoesWithId = useMemo(() => {
    const out: Array<{ id: string; echo: SoundEcho }> = [];
    for (const cls of ALL_CLASSES) {
      const items = byClass[cls];
      for (let i = 0; i < items.length; i++) {
        out.push({ id: `${cls}-${items[i]!.key}-${i}`, echo: items[i]! });
      }
    }
    return out;
  }, [byClass]);
  const echoesById = useMemo(() => {
    const m = new Map<string, SoundEcho>();
    for (const { id, echo } of echoesWithId) m.set(id, echo);
    return m;
  }, [echoesWithId]);

  function membersToHighlights(echo: SoundEcho): EditorEchoHighlight[] {
    const out: EditorEchoHighlight[] = [];
    const color = echoColor(echo);
    const labelText = SOUND_CLASS_LABELS[echo.className].toLowerCase();
    // Sort so the "first" member (gets the label) is reading-order earliest.
    const sorted = [...echo.members].sort(
      (a, b) => a.lineNumber - b.lineNumber || a.tokenIndex - b.tokenIndex,
    );
    for (let i = 0; i < sorted.length; i++) {
      const m = sorted[i]!;
      const ls = lineSoundsByLine.get(m.lineNumber);
      if (!ls) continue;
      const tok = ls.tokens[m.tokenIndex];
      if (!tok) continue;
      out.push({
        line: m.lineNumber,
        start: tok.start,
        end: tok.end,
        colorKey: echo.className,
        color,
        // Label only on the first member of this echo so we don't repeat
        // "alliteration" beside every word.
        label: i === 0 ? labelText : undefined,
      });
    }
    return out;
  }

  // Echo highlights:
  // - hover any card → just that one echo's words
  // - else specific class filter → all words of that class
  // - else (All filter, no hover) → nothing (avoids rainbow soup)
  const editorEchoHighlights = useMemo<EditorEchoHighlight[] | null>(() => {
    if (subTab !== "echoes") return null;
    if (hoveredEchoId) {
      const e = echoesById.get(hoveredEchoId);
      return e ? membersToHighlights(e) : null;
    }
    if (classFilter !== "all") {
      const out: EditorEchoHighlight[] = [];
      for (const e of byClass[classFilter]) out.push(...membersToHighlights(e));
      return out;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, hoveredEchoId, echoesById, classFilter, byClass, lineSoundsByLine]);

  // Line-level vowel tints (3 buckets) — active when on vowels subtab.
  const editorLineVowelTints = useMemo<EditorLineVowelTint[] | null>(() => {
    if (subTab !== "vowels") return null;
    const out: EditorLineVowelTint[] = [];
    for (const ls of lineSounds) {
      if (ls.text.trim().length === 0 || !ls.dominantVowel) continue;
      const bucket = VOWEL_BUCKET[ls.dominantVowel];
      if (!bucket) continue;
      out.push({
        line: ls.lineNumber,
        bucket,
        active: hoveredVowelLine === ls.lineNumber,
      });
    }
    return out;
  }, [subTab, lineSounds, hoveredVowelLine]);

  // Flow markers — active when on flow subtab.
  const editorFlowMarkers = useMemo<EditorFlowMarker[] | null>(() => {
    if (subTab !== "flow") return null;
    const out: EditorFlowMarker[] = [];
    for (const ls of lineSounds) {
      if (ls.text.trim().length === 0) continue;
      out.push({
        line: ls.lineNumber,
        endStop: ls.endStop,
        caesuraColumn: caesuraColumnsByLine.get(ls.lineNumber) ?? null,
        active: hoveredFlowLine === ls.lineNumber,
      });
    }
    return out;
  }, [subTab, lineSounds, caesuraColumnsByLine, hoveredFlowLine]);

  useEffect(() => {
    if (!onEchoHighlightsChange) return;
    onEchoHighlightsChange(editorEchoHighlights);
    return () => { onEchoHighlightsChange(null); };
  }, [onEchoHighlightsChange, editorEchoHighlights]);
  useEffect(() => {
    if (!onLineVowelTintsChange) return;
    onLineVowelTintsChange(editorLineVowelTints);
    return () => { onLineVowelTintsChange(null); };
  }, [onLineVowelTintsChange, editorLineVowelTints]);
  useEffect(() => {
    if (!onFlowMarkersChange) return;
    onFlowMarkersChange(editorFlowMarkers);
    return () => { onFlowMarkersChange(null); };
  }, [onFlowMarkersChange, editorFlowMarkers]);

  return (
    <div
      className="tool-block tool-block-live tool-block-soundmap"
      id="tool-panel-echoes"
      role="tabpanel"
      aria-labelledby="tool-tab-echoes"
    >
      <LiveSectionTitle>Echoes &amp; line music</LiveSectionTitle>
      {!nonEmpty ? <NoLinesYetHint /> : null}
      {!stressLexiconReady && (
        <p className="muted small soundmap-status" aria-busy="true">
          Using letter heuristics — sound dictionary still loading…
        </p>
      )}
      {heavyToolsStale ? (
        <p className="tools-stale-hint muted small" role="status" aria-live="polite">Updating…</p>
      ) : null}

      <div className="rep-subtabs" role="tablist" aria-label="Echoes views">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "echoes"}
          className={`rep-subtab${subTab === "echoes" ? " active" : ""}`}
          onClick={() => setSubTab("echoes")}
        >
          Sound echoes <span className="rep-subtab-count">{echoes.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "vowels"}
          className={`rep-subtab${subTab === "vowels" ? " active" : ""}`}
          onClick={() => setSubTab("vowels")}
        >
          Vowel music <span className="rep-subtab-count">{usedVowels.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "flow"}
          className={`rep-subtab${subTab === "flow" ? " active" : ""}`}
          onClick={() => setSubTab("flow")}
        >
          Pause &amp; flow <span className="rep-subtab-count">{pauseStats.caesuras}</span>
        </button>
      </div>

      {/* ── Echoes ── */}
      {subTab === "echoes" && (
        <>
          <p className="muted small sound-help">
            Hover an echo to highlight its words in the poem. Pick a sound type below
            to keep its words lit while you read.
          </p>

          {echoes.length > 0 && (
            <button
              type="button"
              className={`sound-toggle${showTechnique ? " is-active" : ""}`}
              onClick={() => setShowTechnique((v) => !v)}
              aria-pressed={showTechnique}
              title="Show the technique name next to highlighted words in the poem"
            >
              <span className="sound-toggle-dot" aria-hidden />
              Show technique in poem
            </button>
          )}

          {echoes.length > 0 && (
            <div className="sound-filter-chips" role="group" aria-label="Filter echoes by sound type">
              <button
                type="button"
                className={`sound-filter-chip${classFilter === "all" ? " is-active" : ""}`}
                onClick={() => setClassFilter("all")}
                title="Show every echo group below"
              >
                All <span className="sound-filter-count">{echoes.length}</span>
              </button>
              {ALL_CLASSES.map((c) => {
                const count = classCounts[c];
                if (count === 0) return null;
                const active = classFilter === c;
                return (
                  <button
                    key={c}
                    type="button"
                    className={`sound-filter-chip${active ? " is-active" : ""}`}
                    onClick={() => setClassFilter(active ? "all" : c)}
                    title={SOUND_CLASS_BLURB[c]}
                    style={
                      active
                        ? { borderColor: SOUND_CLASS_HUES[c], color: SOUND_CLASS_HUES[c] }
                        : undefined
                    }
                  >
                    <span
                      className="sound-filter-dot"
                      style={{ background: SOUND_CLASS_HUES[c] }}
                      aria-hidden
                    />
                    {SOUND_CLASS_LABELS[c]}
                    <span className="sound-filter-count">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {echoes.length === 0 ? (
            <EmptyState title="No strong echoes yet">
              <p className="muted small">
                Echoes appear once three or more words share a sound — keep writing.
              </p>
            </EmptyState>
          ) : visibleClassesWithEchoes.length === 0 ? (
            <p className="muted small">No echoes of this type. Try another filter.</p>
          ) : (
            <div className="sound-echo-groups">
              {visibleClassesWithEchoes.map((cls) => {
                const items = byClass[cls];
                const hue = SOUND_CLASS_HUES[cls];
                return (
                  <section
                    key={cls}
                    className="sound-echo-group"
                    style={{ ["--echo-hue" as string]: hue }}
                  >
                    <header
                      className="sound-echo-group-head"
                      title={SOUND_CLASS_BLURB[cls]}
                    >
                      <span
                        className="sound-echo-group-dot"
                        style={{ background: hue }}
                        aria-hidden
                      />
                      <span className="sound-echo-group-label">
                        {SOUND_CLASS_LABELS[cls]}
                      </span>
                      <span className="sound-echo-group-count">{items.length}</span>
                    </header>
                    <ul className="rep-card-list sound-echo-list">
                      {items.map((e, i) => {
                        const id = `${cls}-${e.key}-${i}`;
                        return (
                          <EchoCard
                            key={id}
                            echo={e}
                            goToLine={goToLine}
                            echoId={id}
                            isActive={hoveredEchoId === id}
                            onHoverChange={setHoveredEchoId}
                          />
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Vowel music ── */}
      {subTab === "vowels" && (
        <>
          <p className="muted small sound-help">
            Each line is tinted in the poem by its dominant vowel. Bright (ee, ay) feels
            sharp; dark (oo, oh) feels weighted. Hover a stripe to spotlight that line.
          </p>

          {usedVowels.length === 0 ? (
            <EmptyState title="Not enough words yet">
              <p className="muted small">Write a few words and the shape will appear.</p>
            </EmptyState>
          ) : (
            <>
              <div className="sound-vowel-legend" aria-label="Vowel colour key">
                {(["bright", "mid", "dark"] as const).map((b) => (
                  <span key={b} className="sound-vowel-legend-item">
                    <span
                      className={`sound-vowel-legend-swatch sound-vowel-legend-swatch-${b}`}
                      style={{ background: VOWEL_BUCKET_HUE[b] }}
                      aria-hidden
                    />
                    <span className="sound-vowel-legend-label">
                      {VOWEL_BUCKET_LABEL[b]}
                      <span className="sound-vowel-legend-eg muted small">
                        {" "}{VOWEL_BUCKET_EXAMPLES[b]}
                      </span>
                    </span>
                  </span>
                ))}
              </div>

              <div
                className="sound-vowel-strip"
                role="list"
                aria-label="Vowel shape across the poem"
              >
                {lineSounds.map((ls) => {
                  if (ls.text.trim().length === 0) {
                    return (
                      <span
                        key={ls.lineNumber}
                        className="sound-vowel-strip-seg sound-vowel-strip-seg-blank"
                        aria-hidden
                      />
                    );
                  }
                  const bucket = ls.dominantVowel ? VOWEL_BUCKET[ls.dominantVowel] : null;
                  const isActive = hoveredVowelLine === ls.lineNumber;
                  return (
                    <button
                      key={ls.lineNumber}
                      type="button"
                      role="listitem"
                      className={`sound-vowel-strip-seg sound-vowel-strip-seg-${bucket ?? "none"}${isActive ? " is-active" : ""}`}
                      onClick={() => goToLine(ls.lineNumber)}
                      onMouseEnter={() => setHoveredVowelLine(ls.lineNumber)}
                      onMouseLeave={() => setHoveredVowelLine(null)}
                      onFocus={() => setHoveredVowelLine(ls.lineNumber)}
                      onBlur={() => setHoveredVowelLine(null)}
                      title={`L${ls.lineNumber} — ${
                        bucket ? VOWEL_BUCKET_LABEL[bucket].toLowerCase() : "—"
                      }${ls.dominantVowel ? ` (${ls.dominantVowel})` : ""}`}
                      aria-label={`Line ${ls.lineNumber}, ${bucket ?? "unknown"} vowel`}
                    >
                      <span className="sound-vowel-strip-num">{ls.lineNumber}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Pause & flow ── */}
      {subTab === "flow" && (
        <>
          <p className="muted small sound-help">
            How each line breaks. <span className="sound-glyph-hard">■</span> stops,
            <span className="sound-glyph-soft"> · </span>pauses,
            <span className="sound-glyph-open"> ↵ </span>spills into the next.
            <span className="sound-glyph-cae"> ‖ </span> marks a mid-line pause — shown in the poem.
          </p>

          {pauseStats.total === 0 ? (
            <EmptyState title="Not enough text yet">
              <p className="muted small">Add some lines to see how they break and flow.</p>
            </EmptyState>
          ) : (
            <>
              <div className="sound-flow-summary">
                <div className="sound-flow-stat sound-flow-stat-hard">
                  <span className="sound-flow-stat-value">{pauseStats.endStopped}</span>
                  <span className="sound-flow-stat-label">stops ■</span>
                </div>
                <div className="sound-flow-stat sound-flow-stat-soft">
                  <span className="sound-flow-stat-value">{pauseStats.soft}</span>
                  <span className="sound-flow-stat-label">pauses ·</span>
                </div>
                <div className="sound-flow-stat sound-flow-stat-open">
                  <span className="sound-flow-stat-value">{pauseStats.enjambed}</span>
                  <span className="sound-flow-stat-label">enjambed ↵</span>
                </div>
                <div className="sound-flow-stat sound-flow-stat-cae">
                  <span className="sound-flow-stat-value">{pauseStats.caesuras}</span>
                  <span className="sound-flow-stat-label">caesuras ‖</span>
                </div>
              </div>

              <div
                className="sound-flow-strip"
                role="list"
                aria-label="Flow shape across the poem"
              >
                {lineSounds.map((ls) => {
                  if (ls.text.trim().length === 0) {
                    return (
                      <span
                        key={ls.lineNumber}
                        className="sound-flow-strip-seg sound-flow-strip-seg-blank"
                        aria-hidden
                      />
                    );
                  }
                  const isActive = hoveredFlowLine === ls.lineNumber;
                  const hasCae = ls.caesuraAt !== null;
                  const endTitle = endStopLabel(ls.endStop);
                  return (
                    <button
                      key={ls.lineNumber}
                      type="button"
                      role="listitem"
                      className={`sound-flow-strip-seg sound-flow-strip-seg-${ls.endStop}${hasCae ? " has-caesura" : ""}${isActive ? " is-active" : ""}`}
                      onClick={() => goToLine(ls.lineNumber)}
                      onMouseEnter={() => setHoveredFlowLine(ls.lineNumber)}
                      onMouseLeave={() => setHoveredFlowLine(null)}
                      onFocus={() => setHoveredFlowLine(ls.lineNumber)}
                      onBlur={() => setHoveredFlowLine(null)}
                      title={`L${ls.lineNumber} — ${endTitle}${hasCae ? " · pause inside line" : ""}`}
                      aria-label={`Line ${ls.lineNumber}, ${endTitle}`}
                    >
                      <span className="sound-flow-strip-num">{ls.lineNumber}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
