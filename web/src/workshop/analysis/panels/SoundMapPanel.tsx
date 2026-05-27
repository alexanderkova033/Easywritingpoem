import { useMemo, useState } from "react";
import {
  buildLineSounds,
  buildRhymeWebPairs,
  SOUND_CLASS_HUES,
  SOUND_CLASS_LABELS,
  VOWEL_HUES,
  type SoundClass,
} from "@/workshop/sound/sound-map-analysis";
import { NoLinesYetHint } from "@/workshop/analysis/tools/shared";
import { LiveSectionTitle } from "../ToolTabBar";

export interface SoundMapPanelProps {
  poemLines: string[];
  stressLexicon: ReadonlyMap<string, string> | null;
  stressLexiconReady: boolean;
  heavyToolsStale: boolean;
  goToLine: (line1Based: number) => void;
}

const ALL_CLASSES: SoundClass[] = ["alliteration", "assonance", "consonance", "sibilance", "plosive", "liquid"];

export function SoundMapPanel({
  poemLines,
  stressLexicon,
  stressLexiconReady,
  heavyToolsStale,
  goToLine,
}: SoundMapPanelProps) {
  const [activeClasses, setActiveClasses] = useState<Set<SoundClass>>(
    () => new Set<SoundClass>(["alliteration", "assonance"]),
  );
  const [showRhymeWeb, setShowRhymeWeb] = useState(true);
  const [showMarks, setShowMarks] = useState(true);
  const [showVowelArc, setShowVowelArc] = useState(true);

  const toggleClass = (c: SoundClass) => {
    setActiveClasses((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };

  const lineSounds = useMemo(
    () => buildLineSounds(poemLines, stressLexicon),
    [poemLines, stressLexicon],
  );
  const rhymeWeb = useMemo(
    () => (showRhymeWeb ? buildRhymeWebPairs(lineSounds) : []),
    [lineSounds, showRhymeWeb],
  );

  const nonEmpty = lineSounds.some((l) => l.tokens.length > 0);

  return (
    <div
      className="tool-block tool-block-live tool-block-soundmap"
      id="tool-panel-soundmap"
      role="tabpanel"
      aria-labelledby="tool-tab-soundmap"
    >
      <LiveSectionTitle>Sound map</LiveSectionTitle>
      {!nonEmpty ? <NoLinesYetHint /> : null}
      {!stressLexiconReady && (
        <p className="muted small soundmap-status" aria-busy="true">
          Using letter heuristics — stress dictionary still loading…
        </p>
      )}
      {heavyToolsStale ? (
        <p className="tools-stale-hint muted small" role="status" aria-live="polite">Updating…</p>
      ) : null}

      <div className="soundmap-toggles" role="group" aria-label="Sound highlight filters">
        {ALL_CLASSES.map((c) => {
          const active = activeClasses.has(c);
          return (
            <button
              key={c}
              type="button"
              className={`soundmap-toggle soundmap-toggle-${c}${active ? " is-active" : ""}`}
              onClick={() => toggleClass(c)}
              aria-pressed={active}
              style={active ? { borderColor: SOUND_CLASS_HUES[c], color: SOUND_CLASS_HUES[c] } : undefined}
              title={SOUND_CLASS_LABELS[c]}
            >
              <span className="soundmap-toggle-dot" style={{ background: SOUND_CLASS_HUES[c] }} aria-hidden />
              {SOUND_CLASS_LABELS[c]}
            </button>
          );
        })}
      </div>

      <div className="soundmap-extra-toggles">
        <label className="soundmap-mini-toggle">
          <input
            type="checkbox"
            checked={showRhymeWeb}
            onChange={(e) => setShowRhymeWeb(e.target.checked)}
          />
          Rhyme web
        </label>
        <label className="soundmap-mini-toggle">
          <input
            type="checkbox"
            checked={showMarks}
            onChange={(e) => setShowMarks(e.target.checked)}
          />
          Caesura · enjambment
        </label>
        <label className="soundmap-mini-toggle">
          <input
            type="checkbox"
            checked={showVowelArc}
            onChange={(e) => setShowVowelArc(e.target.checked)}
          />
          Vowel arc
        </label>
      </div>

      <ul className="soundmap-lines" aria-label="Sound highlights per line">
        {lineSounds.map((ls) => {
          if (ls.text.trim().length === 0) {
            return <li key={ls.lineNumber} className="soundmap-line soundmap-line-blank" aria-hidden />;
          }
          const arcColor = ls.dominantVowel ? VOWEL_HUES[ls.dominantVowel] ?? "transparent" : "transparent";
          return (
            <li
              key={ls.lineNumber}
              className="soundmap-line"
              onClick={() => goToLine(ls.lineNumber)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goToLine(ls.lineNumber); }
              }}
              title={`Line ${ls.lineNumber} — click to jump`}
            >
              <span className="soundmap-line-num">{ls.lineNumber}</span>
              {showVowelArc && (
                <span
                  className="soundmap-vowel-arc"
                  style={{ background: arcColor }}
                  aria-hidden
                />
              )}
              <span className="soundmap-line-text">
                {ls.tokens.length === 0 ? (
                  <span className="soundmap-token-blank">{ls.text}</span>
                ) : (
                  ls.tokens.map((tok, ti) => {
                    const hits = ALL_CLASSES.filter((c) => activeClasses.has(c) && tok.classes.has(c));
                    const color = hits.length > 0 ? SOUND_CLASS_HUES[hits[0]!] : undefined;
                    const isPair = rhymeWeb.some(
                      (p) =>
                        (p.fromLine === ls.lineNumber && p.fromToken === ti) ||
                        (p.toLine === ls.lineNumber && p.toToken === ti),
                    );
                    const titleParts = hits.map((c) => SOUND_CLASS_LABELS[c]);
                    if (isPair) titleParts.push("Rhyme echo");
                    return (
                      <span key={ti}>
                        {ti > 0 && " "}
                        <span
                          className={`soundmap-token${hits.length > 0 ? " is-marked" : ""}${isPair ? " is-rhyme-pair" : ""}`}
                          style={
                            color
                              ? {
                                  color,
                                  textDecorationColor: color,
                                  borderBottomColor: color,
                                }
                              : undefined
                          }
                          title={titleParts.join(" · ") || undefined}
                        >
                          {tok.word}
                        </span>
                        {showMarks && ls.caesuraAt === ti ? (
                          <span className="soundmap-caesura-mark" aria-label="caesura" title="Caesura">‖</span>
                        ) : null}
                      </span>
                    );
                  })
                )}
              </span>
              {showMarks && (
                <span
                  className={`soundmap-end-mark soundmap-end-${ls.endStop}`}
                  aria-label={
                    ls.endStop === "hard" ? "end-stop"
                    : ls.endStop === "soft" ? "soft pause"
                    : "enjambment"
                  }
                  title={
                    ls.endStop === "hard" ? "End-stopped line"
                    : ls.endStop === "soft" ? "Soft pause"
                    : "Enjambed — flows to next line"
                  }
                >
                  {ls.endStop === "hard" ? "■" : ls.endStop === "soft" ? "·" : "↵"}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <p className="muted small soundmap-foot">
        Pure visualisation — no AI, no tokens spent. Toggle filters above to highlight where
        sounds repeat.
      </p>
    </div>
  );
}
