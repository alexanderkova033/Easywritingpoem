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
  goToWord?: (line1Based: number, startCol: number, endCol: number) => void;
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

const CLASS_HEADLINE: Record<SoundClass, string> = {
  alliteration: "Words sharing a starting sound chime through your poem.",
  assonance: "Vowel sounds chime through your lines.",
  consonance: "Repeated consonants thread through your lines.",
  sibilance: "Hissing s / sh sounds run through your poem.",
  plosive: "Hard, punchy consonants give your lines weight.",
  liquid: "Soft l / r / m / n sounds carry your lines along.",
};

function pickDominantClass(
  byClass: Record<SoundClass, SoundEcho[]>,
): SoundClass | null {
  let best: { cls: SoundClass; weight: number } | null = null;
  for (const cls of ALL_CLASSES) {
    let weight = 0;
    for (const e of byClass[cls]) weight += e.members.length;
    if (weight === 0) continue;
    if (best === null || weight > best.weight) best = { cls, weight };
  }
  return best?.cls ?? null;
}

type VowelBucket = "bright" | "mid" | "dark";

interface VowelVerdict {
  /** Plain-English summary of the vowel arc, written for the user. */
  sentence: string;
  /** Whole-percent share per bucket; sums to 100 (or 0 if no scored lines). */
  pct: Record<VowelBucket, number>;
  /** Where the tonal shift kicks in (line number), if one was detected. */
  turnAt: number | null;
  /** Direction of the shift, if any. */
  turnDirection: "brightening" | "darkening" | null;
  /** Dominant bucket overall — null if no clear dominance. */
  dominant: VowelBucket | null;
}

function computeVowelVerdict(
  perLine: Array<{ lineNumber: number; bucket: VowelBucket | null }>,
): VowelVerdict | null {
  const scored = perLine.filter(
    (x): x is { lineNumber: number; bucket: VowelBucket } => x.bucket !== null,
  );
  if (scored.length === 0) return null;

  const counts: Record<VowelBucket, number> = { bright: 0, mid: 0, dark: 0 };
  for (const s of scored) counts[s.bucket]++;
  const total = scored.length;
  const pctRaw = {
    bright: (100 * counts.bright) / total,
    mid: (100 * counts.mid) / total,
    dark: (100 * counts.dark) / total,
  };
  const pct: Record<VowelBucket, number> = {
    bright: Math.round(pctRaw.bright),
    mid: Math.round(pctRaw.mid),
    dark: Math.round(pctRaw.dark),
  };

  const score = (b: VowelBucket): number => (b === "bright" ? 1 : b === "dark" ? -1 : 0);
  const numericScores: number[] = scored.map((s) => score(s.bucket));

  const half = Math.floor(scored.length / 2);
  let firstAvg = 0;
  let secondAvg = 0;
  if (half > 0) {
    firstAvg = numericScores.slice(0, half).reduce((a, b) => a + b, 0) / half;
  }
  const secondCount = scored.length - half;
  if (secondCount > 0) {
    secondAvg = numericScores.slice(half).reduce((a, b) => a + b, 0) / secondCount;
  }
  const diff = secondAvg - firstAvg;

  let dominant: VowelBucket | null = null;
  if (pct.bright >= 60) dominant = "bright";
  else if (pct.dark >= 60) dominant = "dark";
  else if (pct.mid >= 60) dominant = "mid";

  const SHIFT_THRESHOLD = 0.6;

  if (scored.length >= 4 && Math.abs(diff) >= SHIFT_THRESHOLD) {
    const direction: "brightening" | "darkening" = diff > 0 ? "brightening" : "darkening";
    const turnAt = scored[half]?.lineNumber ?? null;
    const sentence =
      direction === "brightening"
        ? `Your poem opens darker and brightens from L${turnAt} — a tonal lift.`
        : `Your poem opens bright and darkens from L${turnAt} — a tonal shift.`;
    return { sentence, pct, turnAt, turnDirection: direction, dominant };
  }

  if (dominant === "bright") {
    return {
      sentence: "Your poem stays bright throughout — open, sharp vowels carry the mood.",
      pct,
      turnAt: null,
      turnDirection: null,
      dominant,
    };
  }
  if (dominant === "dark") {
    return {
      sentence: "Your poem stays dark throughout — deep, hushed vowels carry the mood.",
      pct,
      turnAt: null,
      turnDirection: null,
      dominant,
    };
  }
  if (dominant === "mid") {
    return {
      sentence: "Your poem hovers in the mid range — neutral, even vowel colour.",
      pct,
      turnAt: null,
      turnDirection: null,
      dominant,
    };
  }
  return {
    sentence: "Your vowels alternate without a clear arc — a restless tonal pattern.",
    pct,
    turnAt: null,
    turnDirection: null,
    dominant: null,
  };
}

function friendlyEchoKey(echo: SoundEcho): string {
  const upper = echo.key.toUpperCase();
  return echo.className === "assonance" ? `${upper} vowel` : `${upper} sound`;
}

function echoLineRange(echo: SoundEcho): string {
  let first = echo.members[0]?.lineNumber ?? 0;
  let last = first;
  for (const m of echo.members) {
    if (m.lineNumber < first) first = m.lineNumber;
    if (m.lineNumber > last) last = m.lineNumber;
  }
  if (first === last) return `all on L${first}`;
  if (echo.minGap === 1) return `L${first}–L${last}, adjacent`;
  return `L${first}–L${last}`;
}

function EchoCard({
  echo,
  onMemberClick,
  echoId,
  isActive,
  isPinned,
  onTogglePin,
  onHoverChange,
}: {
  echo: SoundEcho;
  onMemberClick: (m: { lineNumber: number; tokenIndex: number; word: string }) => void;
  echoId: string;
  isActive: boolean;
  isPinned: boolean;
  onTogglePin: (id: string) => void;
  onHoverChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const previewMax = 6;
  const preview = open ? echo.members : echo.members.slice(0, previewMax);
  const tint = echoColor(echo);
  const wordsLabel = `${echo.members.length} word${echo.members.length === 1 ? "" : "s"}`;
  const rangeLabel = echoLineRange(echo);
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
        <span className="sound-echo-key">{friendlyEchoKey(echo)}</span>
        <span className="sound-echo-count" style={{ color: tint }}>{wordsLabel}</span>
        <span className="sound-echo-gap muted small">{rangeLabel}</span>
        <button
          type="button"
          className={`sound-echo-pin${isPinned ? " is-pinned" : ""}`}
          onClick={(ev) => { ev.stopPropagation(); onTogglePin(echoId); }}
          aria-pressed={isPinned}
          title={isPinned ? "Hide this echo in the poem" : "Show this echo in the poem"}
          style={isPinned ? { borderColor: tint, color: tint } : undefined}
        >
          <span className="sound-echo-pin-dot" aria-hidden style={isPinned ? { background: tint } : undefined} />
          {isPinned ? "Shown" : "Show"}
        </button>
      </div>
      <div className="sound-echo-members">
        {preview.map((m, i) => (
          <button
            key={`${m.lineNumber}-${i}`}
            type="button"
            className="sound-echo-chip"
            onClick={() => onMemberClick(m)}
            title={`Select "${m.word}" on line ${m.lineNumber}`}
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
  goToWord,
  onEchoHighlightsChange,
  onLineVowelTintsChange,
  onFlowMarkersChange,
}: SoundMapPanelProps) {
  const [subTab, setSubTab] = useState<SoundSubTab>("echoes");
  const [classFilter, setClassFilter] = useState<SoundClass | "all">("all");
  const [hoveredEchoId, setHoveredEchoId] = useState<string | null>(null);
  const [hoveredVowelLine, setHoveredVowelLine] = useState<number | null>(null);
  const [hoveredFlowLine, setHoveredFlowLine] = useState<number | null>(null);
  const [pinnedEchoes, setPinnedEchoes] = useState<Set<string>>(() => new Set());

  function togglePinnedEcho(id: string) {
    setPinnedEchoes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
    for (const cls of ALL_CLASSES) {
      m[cls].sort((a, b) => {
        if (b.members.length !== a.members.length) return b.members.length - a.members.length;
        return a.minGap - b.minGap;
      });
    }
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

  const vowelVerdict = useMemo(() => {
    const perLine = lineSounds
      .filter((ls) => ls.text.trim().length > 0)
      .map((ls) => ({
        lineNumber: ls.lineNumber,
        bucket: ls.dominantVowel ? (VOWEL_BUCKET[ls.dominantVowel] ?? null) : null,
      }));
    return computeVowelVerdict(perLine);
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

  const dominantClass = useMemo(() => pickDominantClass(byClass), [byClass]);

  function membersToHighlights(echo: SoundEcho): EditorEchoHighlight[] {
    const out: EditorEchoHighlight[] = [];
    const color = echoColor(echo);
    for (const m of echo.members) {
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
      });
    }
    return out;
  }

  // Echo highlights are a union of:
  //   • every echo the user has toggled on (persistent)
  //   • the currently hovered echo (transient preview)
  // No pinned echoes + no hover ⇒ nothing in the editor.
  const editorEchoHighlights = useMemo<EditorEchoHighlight[] | null>(() => {
    if (subTab !== "echoes") return null;
    const usedIds = new Set<string>();
    const out: EditorEchoHighlight[] = [];
    for (const id of pinnedEchoes) {
      const e = echoesById.get(id);
      if (!e) continue;
      usedIds.add(id);
      out.push(...membersToHighlights(e));
    }
    if (hoveredEchoId && !usedIds.has(hoveredEchoId)) {
      const e = echoesById.get(hoveredEchoId);
      if (e) out.push(...membersToHighlights(e));
    }
    return out.length > 0 ? out : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, hoveredEchoId, echoesById, pinnedEchoes, lineSoundsByLine]);

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
          {dominantClass && (
            <section
              className="sound-echo-summary"
              style={{ ["--echo-hue" as string]: SOUND_CLASS_HUES[dominantClass] }}
            >
              <header className="sound-echo-summary-head">
                <span
                  className="sound-echo-summary-dot"
                  style={{ background: SOUND_CLASS_HUES[dominantClass] }}
                  aria-hidden
                />
                <span className="sound-echo-summary-eyebrow">At a glance</span>
              </header>
              <p className="sound-echo-summary-line">{CLASS_HEADLINE[dominantClass]}</p>
            </section>
          )}

          {echoes.length > 0 && (
            <p className="sound-echo-purpose muted small">
              Echoes shows words that share a sound. Use it to spot patterns you didn&apos;t
              notice, strengthen the ones you like, or find lines where adding sound would help.
            </p>
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
                            onMemberClick={(m) => {
                              const ls = lineSoundsByLine.get(m.lineNumber);
                              const tok = ls?.tokens[m.tokenIndex];
                              if (tok && goToWord) {
                                goToWord(m.lineNumber, tok.start, tok.end);
                              } else {
                                goToLine(m.lineNumber);
                              }
                            }}
                            echoId={id}
                            isActive={hoveredEchoId === id}
                            isPinned={pinnedEchoes.has(id)}
                            onTogglePin={togglePinnedEcho}
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
          {usedVowels.length === 0 ? (
            <EmptyState title="Not enough words yet">
              <p className="muted small">Write a few words and the shape will appear.</p>
            </EmptyState>
          ) : (
            <>
              {vowelVerdict && (
                <section
                  className={`sound-echo-summary sound-vowel-summary${
                    vowelVerdict.dominant ? ` sound-vowel-summary-${vowelVerdict.dominant}` : ""
                  }`}
                  style={{
                    ["--echo-hue" as string]: vowelVerdict.dominant
                      ? VOWEL_BUCKET_HUE[vowelVerdict.dominant]
                      : "var(--border)",
                  }}
                >
                  <header className="sound-echo-summary-head">
                    <span
                      className="sound-echo-summary-dot"
                      style={{
                        background: vowelVerdict.dominant
                          ? VOWEL_BUCKET_HUE[vowelVerdict.dominant]
                          : "var(--muted)",
                      }}
                      aria-hidden
                    />
                    <span className="sound-echo-summary-eyebrow">At a glance</span>
                  </header>
                  <p className="sound-echo-summary-line">{vowelVerdict.sentence}</p>
                </section>
              )}

              {vowelVerdict && (
                <div className="sound-flow-summary" aria-label="Vowel mood statistics">
                  <div className="sound-flow-stat sound-vowel-stat-bright">
                    <span className="sound-flow-stat-value">{vowelVerdict.pct.bright}%</span>
                    <span className="sound-flow-stat-label">bright</span>
                  </div>
                  <div className="sound-flow-stat sound-vowel-stat-mid">
                    <span className="sound-flow-stat-value">{vowelVerdict.pct.mid}%</span>
                    <span className="sound-flow-stat-label">mid</span>
                  </div>
                  <div className="sound-flow-stat sound-vowel-stat-dark">
                    <span className="sound-flow-stat-value">{vowelVerdict.pct.dark}%</span>
                    <span className="sound-flow-stat-label">dark</span>
                  </div>
                  <div className="sound-flow-stat sound-vowel-stat-turn">
                    <span className="sound-flow-stat-value">
                      {vowelVerdict.turnAt !== null
                        ? `${vowelVerdict.turnDirection === "brightening" ? "↗" : "↘"} L${vowelVerdict.turnAt}`
                        : "→"}
                    </span>
                    <span className="sound-flow-stat-label">
                      {vowelVerdict.turnAt !== null ? "tonal turn" : "no turn"}
                    </span>
                  </div>
                </div>
              )}

              <div className="sound-vowel-legend sound-vowel-legend-plain" aria-label="Vowel colour key">
                {(["bright", "mid", "dark"] as const).map((b) => (
                  <span key={b} className="sound-vowel-legend-item">
                    <span
                      className={`sound-vowel-legend-swatch sound-vowel-legend-swatch-${b}`}
                      style={{ background: VOWEL_BUCKET_HUE[b] }}
                      aria-hidden
                    />
                    <span className="sound-vowel-legend-label">
                      {b === "bright" ? "Bright — open, sharp" :
                       b === "mid"    ? "Mid — neutral" :
                                        "Dark — deep, hushed"}
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
