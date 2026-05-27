import { useMemo, useState } from "react";
import {
  buildLineSounds,
  endStopLabel,
  findEchoes,
  SOUND_CLASS_BLURB,
  SOUND_CLASS_HUES,
  SOUND_CLASS_LABELS,
  summarisePauses,
  VOWEL_FRIENDLY_LABEL,
  VOWEL_HUES,
  type SoundClass,
  type SoundEcho,
} from "@/workshop/sound/sound-map-analysis";
import { EmptyState, NoLinesYetHint } from "@/workshop/analysis/tools/shared";
import { LiveSectionTitle } from "../ToolTabBar";

export interface SoundMapPanelProps {
  poemLines: string[];
  stressLexicon: ReadonlyMap<string, string> | null;
  stressLexiconReady: boolean;
  heavyToolsStale: boolean;
  goToLine: (line1Based: number) => void;
}

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
}: {
  echo: SoundEcho;
  goToLine: (line: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const previewMax = 6;
  const preview = open ? echo.members : echo.members.slice(0, previewMax);
  const tint = SOUND_CLASS_HUES[echo.className];
  return (
    <li className="rep-card sound-echo-card" style={{ borderLeftColor: tint }}>
      <div className="rep-card-header">
        <span
          className="sound-echo-badge"
          style={{ background: tint, color: "#fff" }}
        >
          {SOUND_CLASS_LABELS[echo.className]}
        </span>
        <span className="rep-card-title">
          <span className="sound-echo-key">/{echo.key}/</span>
        </span>
        <span className="rep-card-count">×{echo.members.length}</span>
        {echo.minGap > 0 && (
          <span className="rep-card-gap muted small">
            {echo.minGap === 1
              ? "adjacent lines"
              : echo.span <= 3
                ? "tight cluster"
                : `over ${echo.span + 1} lines`}
          </span>
        )}
      </div>
      <p className="sound-echo-blurb muted small">{SOUND_CLASS_BLURB[echo.className]}</p>
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

function FlowRow({
  lineNumber,
  text,
  endStop,
  caesuraAt,
  caesuraColumn,
  goToLine,
}: {
  lineNumber: number;
  text: string;
  endStop: "hard" | "soft" | "open";
  caesuraAt: number | null;
  caesuraColumn: number | null;
  goToLine: (line: number) => void;
}) {
  const display = text.trim();
  const before = caesuraColumn !== null ? display.slice(0, caesuraColumn) : display;
  const after = caesuraColumn !== null ? display.slice(caesuraColumn) : "";
  const endIcon = endStop === "hard" ? "■" : endStop === "soft" ? "·" : "↵";
  const endTitle = endStopLabel(endStop);
  return (
    <li
      className={`sound-flow-row sound-flow-row-${endStop}`}
      onClick={() => goToLine(lineNumber)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          goToLine(lineNumber);
        }
      }}
      title={`Line ${lineNumber} — ${endTitle}${caesuraAt !== null ? " · pause inside line" : ""}`}
    >
      <span className="sound-flow-num">L{lineNumber}</span>
      <span className="sound-flow-text">
        {before}
        {after && (
          <>
            <span className="sound-flow-caesura" aria-label="pause">‖</span>
            {after}
          </>
        )}
      </span>
      <span className={`sound-flow-end sound-flow-end-${endStop}`} aria-label={endTitle}>
        {endIcon}
      </span>
    </li>
  );
}

export function SoundMapPanel({
  poemLines,
  stressLexicon,
  stressLexiconReady,
  heavyToolsStale,
  goToLine,
}: SoundMapPanelProps) {
  const [subTab, setSubTab] = useState<SoundSubTab>("echoes");
  const [classFilter, setClassFilter] = useState<SoundClass | "all">("all");

  const lineSounds = useMemo(
    () => buildLineSounds(poemLines, stressLexicon),
    [poemLines, stressLexicon],
  );

  const nonEmpty = lineSounds.some((l) => l.tokens.length > 0);
  const echoes = useMemo(() => findEchoes(lineSounds), [lineSounds]);
  const pauseStats = useMemo(() => summarisePauses(lineSounds), [lineSounds]);
  const filteredEchoes = useMemo(
    () => (classFilter === "all" ? echoes : echoes.filter((e) => e.className === classFilter)),
    [echoes, classFilter],
  );
  const classCounts = useMemo(() => {
    const counts: Record<SoundClass, number> = {
      alliteration: 0, assonance: 0, consonance: 0,
      sibilance: 0, plosive: 0, liquid: 0,
    };
    for (const e of echoes) counts[e.className]++;
    return counts;
  }, [echoes]);

  // For vowel-arc legend: which vowels actually appear in this poem?
  const usedVowels = useMemo(() => {
    const seen = new Set<string>();
    for (const ls of lineSounds) if (ls.dominantVowel) seen.add(ls.dominantVowel);
    return [...seen].sort();
  }, [lineSounds]);

  // For caesura column: convert token index → column in line text.
  const caesuraColumnsByLine = useMemo(() => {
    const m = new Map<number, number | null>();
    for (const ls of lineSounds) {
      if (ls.caesuraAt === null) { m.set(ls.lineNumber, null); continue; }
      const tok = ls.tokens[ls.caesuraAt];
      m.set(ls.lineNumber, tok ? tok.end : null);
    }
    return m;
  }, [lineSounds]);

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
            Groups of words that <strong>share a sound</strong>. Sound echoes give a poem its
            inner music — tighter gaps between members mean a more concentrated echo.
            Click any chip to jump to the line.
          </p>

          {echoes.length > 0 && (
            <div className="sound-filter-chips" role="group" aria-label="Filter echoes by sound type">
              <button
                type="button"
                className={`sound-filter-chip${classFilter === "all" ? " is-active" : ""}`}
                onClick={() => setClassFilter("all")}
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
                Sound echoes appear once three or more words in your poem share an initial
                consonant (alliteration) or vowel sound (assonance). Keep writing —
                they'll surface here as your lines fill in.
              </p>
            </EmptyState>
          ) : filteredEchoes.length === 0 ? (
            <p className="muted small">No echoes of this type. Try another filter.</p>
          ) : (
            <ul className="rep-card-list sound-echo-list">
              {filteredEchoes.map((e, i) => (
                <EchoCard key={`${e.className}-${e.key}-${i}`} echo={e} goToLine={goToLine} />
              ))}
            </ul>
          )}
        </>
      )}

      {/* ── Vowel music ── */}
      {subTab === "vowels" && (
        <>
          <p className="muted small sound-help">
            Each line is tinted by its <strong>dominant vowel sound</strong>. Look for shape
            across the poem — bright vowels (ee, ay, i) often feel sharp or hopeful;
            dark vowels (oo, oh, ah) feel weighted or sombre.
          </p>

          {usedVowels.length === 0 ? (
            <EmptyState title="Not enough words yet">
              <p className="muted small">
                Write at least a few words on a line and the vowel arc will appear.
              </p>
            </EmptyState>
          ) : (
            <>
              <div className="sound-vowel-legend" aria-label="Vowel colour key">
                {usedVowels.map((v) => (
                  <span key={v} className="sound-vowel-legend-item">
                    <span
                      className="sound-vowel-legend-swatch"
                      style={{ background: VOWEL_HUES[v] ?? "#888" }}
                      aria-hidden
                    />
                    <span className="sound-vowel-legend-label">
                      {VOWEL_FRIENDLY_LABEL[v] ?? v}
                    </span>
                  </span>
                ))}
              </div>

              <ol className="sound-vowel-arc" aria-label="Dominant vowel per line">
                {lineSounds.map((ls) => {
                  if (ls.text.trim().length === 0) {
                    return (
                      <li
                        key={ls.lineNumber}
                        className="sound-vowel-arc-row sound-vowel-arc-blank"
                        aria-hidden
                      />
                    );
                  }
                  const hue = ls.dominantVowel ? VOWEL_HUES[ls.dominantVowel] ?? "#888" : "#888";
                  const label = ls.dominantVowel
                    ? VOWEL_FRIENDLY_LABEL[ls.dominantVowel] ?? ls.dominantVowel
                    : "—";
                  return (
                    <li
                      key={ls.lineNumber}
                      className="sound-vowel-arc-row"
                      onClick={() => goToLine(ls.lineNumber)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          goToLine(ls.lineNumber);
                        }
                      }}
                      title={`Line ${ls.lineNumber} — dominant vowel: ${label}`}
                    >
                      <span className="sound-vowel-arc-num">L{ls.lineNumber}</span>
                      <span
                        className="sound-vowel-arc-bar"
                        style={{ background: hue }}
                        aria-hidden
                      />
                      <span className="sound-vowel-arc-line-text">
                        {ls.text.trim().slice(0, 60)}
                        {ls.text.trim().length > 60 ? "…" : ""}
                      </span>
                      <span className="sound-vowel-arc-tag" style={{ color: hue }}>
                        {ls.dominantVowel ?? "—"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </>
      )}

      {/* ── Pause & flow ── */}
      {subTab === "flow" && (
        <>
          <p className="muted small sound-help">
            Where each line <strong>breaks or flows</strong>. An end-stopped line ends with
            a clean stop (. ! ?); a soft pause uses a comma or dash; an enjambed line
            spills into the next without punctuation. A <strong>caesura</strong> (‖) is a
            mid-line pause.
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
                  <span className="sound-flow-stat-label">end-stopped</span>
                </div>
                <div className="sound-flow-stat sound-flow-stat-soft">
                  <span className="sound-flow-stat-value">{pauseStats.soft}</span>
                  <span className="sound-flow-stat-label">soft pause</span>
                </div>
                <div className="sound-flow-stat sound-flow-stat-open">
                  <span className="sound-flow-stat-value">{pauseStats.enjambed}</span>
                  <span className="sound-flow-stat-label">enjambed</span>
                </div>
                <div className="sound-flow-stat sound-flow-stat-cae">
                  <span className="sound-flow-stat-value">{pauseStats.caesuras}</span>
                  <span className="sound-flow-stat-label">caesuras</span>
                </div>
              </div>

              <ul className="sound-flow-list" aria-label="Per-line flow">
                {lineSounds.map((ls) => {
                  if (ls.text.trim().length === 0) {
                    return (
                      <li key={ls.lineNumber} className="sound-flow-row sound-flow-row-blank" aria-hidden />
                    );
                  }
                  return (
                    <FlowRow
                      key={ls.lineNumber}
                      lineNumber={ls.lineNumber}
                      text={ls.text}
                      endStop={ls.endStop}
                      caesuraAt={ls.caesuraAt}
                      caesuraColumn={caesuraColumnsByLine.get(ls.lineNumber) ?? null}
                      goToLine={goToLine}
                    />
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
