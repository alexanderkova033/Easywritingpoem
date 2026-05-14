import type { WorkshopGoals } from "@/workshop/goals/types";
import { ALL_GOAL_KEYS, FORM_PRESETS, hasAnyGoalSet } from "@/workshop/goals/types";
import type { GoalEvaluation } from "@/workshop/goals/metrics";
import type { DocumentStats } from "@/workshop/analysis/line-stats";
import { IdeasNotebook } from "@/workshop/goals/IdeasNotebook";
import {
  MetricGoalCard,
  RhymeSchemeCard,
  SyllableCapCard,
} from "@/workshop/analysis/tools/GoalCards";

export interface GoalsPanelProps {
  goals: WorkshopGoals;
  goalEvaluation: GoalEvaluation;
  docStats: DocumentStats;
  goToLine: (line1Based: number) => void;
  setGoalValue: (key: keyof WorkshopGoals, value: number | undefined) => void;
  setRhymeSchemeGoal: (scheme: string | undefined) => void;
  setRhymeSchemePerStanza: (perStanza: boolean) => void;
  resetGoals: () => void;
  toggleGoalSoft: (key: string) => void;
  applyGoalPreset: (presetKey: string | null) => void;
}

export function GoalsPanel({
  goals,
  goalEvaluation,
  docStats,
  goToLine,
  setGoalValue,
  setRhymeSchemeGoal,
  setRhymeSchemePerStanza,
  resetGoals,
  toggleGoalSoft,
  applyGoalPreset,
}: GoalsPanelProps) {
  return (
    <div
      className="tool-block"
      id="tool-panel-goals"
      role="tabpanel"
      aria-labelledby="tool-tab-goals"
    >
      <h3 className="tool-heading-you">
        <span className="you-marker" aria-hidden />
        <span className="tool-heading-you-text">Goals</span>
      </h3>

      <IdeasNotebook />

      <div className="goals-panel-divider" aria-hidden="true" />

      <div className="goal-presets-row">
        <div className="goal-presets" role="group" aria-label="Form presets">
          {FORM_PRESETS.map((p) => {
            const isActive = goals.preset === p.key;
            // Detect drift: compare each preset goal key to current value.
            const drifted =
              isActive &&
              ALL_GOAL_KEYS.some((k) => {
                const presetVal = (p.goals as Record<string, unknown>)[k];
                const curVal = (goals as Record<string, unknown>)[k];
                return (presetVal ?? null) !== (curVal ?? null);
              });
            return (
              <button
                key={p.key}
                type="button"
                className={`goal-preset-chip${isActive ? " goal-preset-chip--active" : ""}${drifted ? " goal-preset-chip--drifted" : ""}`}
                title={
                  drifted
                    ? `${p.description} (modified — click to re-apply)`
                    : p.description
                }
                onClick={() =>
                  isActive && !drifted
                    ? applyGoalPreset(null)
                    : applyGoalPreset(p.key)
                }
              >
                {p.label}
                {drifted ? (
                  <span className="goal-preset-chip-modified" aria-hidden>
                    ●
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {hasAnyGoalSet(goals) ? (
          <button
            type="button"
            className="goal-reset-btn linkish"
            onClick={resetGoals}
            title="Clear every goal target"
          >
            Reset all
          </button>
        ) : null}
      </div>

      {!hasAnyGoalSet(goals) ? (
        <p className="muted small goal-empty-hint">
          Pick a form preset above, or set your own targets below.
        </p>
      ) : null}

      <div className="goal-cards">
        <MetricGoalCard
          label="Lines"
          current={docStats.nonEmptyLines}
          isSoft={!!goals.softGoals?.includes("targetLines")}
          onToggleSoft={() => toggleGoalSoft("targetLines")}
          targetValue={goals.targetLines}
          rangeMin={goals.minLines}
          rangeMax={goals.maxLines}
          onSetTarget={(v) => setGoalValue("targetLines", v)}
          onSetRange={(min, max) => {
            setGoalValue("minLines", min);
            setGoalValue("maxLines", max);
          }}
        />
        <MetricGoalCard
          label="Stanzas"
          current={docStats.stanzaCount}
          hint="Stanzas are blocks of lines separated by blank lines"
          isSoft={!!goals.softGoals?.includes("targetStanzas")}
          onToggleSoft={() => toggleGoalSoft("targetStanzas")}
          targetValue={goals.targetStanzas}
          rangeMin={goals.minStanzas}
          rangeMax={goals.maxStanzas}
          onSetTarget={(v) => setGoalValue("targetStanzas", v)}
          onSetRange={(min, max) => {
            setGoalValue("minStanzas", min);
            setGoalValue("maxStanzas", max);
          }}
        />
        <MetricGoalCard
          label="Words"
          current={docStats.totalWords}
          isSoft={!!goals.softGoals?.includes("targetWords")}
          onToggleSoft={() => toggleGoalSoft("targetWords")}
          targetValue={goals.targetWords}
          rangeMin={goals.minWords}
          rangeMax={goals.maxWords}
          onSetTarget={(v) => setGoalValue("targetWords", v)}
          onSetRange={(min, max) => {
            setGoalValue("minWords", min);
            setGoalValue("maxWords", max);
          }}
        />
        <SyllableCapCard
          cap={goals.maxSyllablesPerLine}
          overLines={goalEvaluation.syllableOverLines}
          goToLine={goToLine}
          isSoft={!!goals.softGoals?.includes("maxSyllablesPerLine")}
          onToggleSoft={() => toggleGoalSoft("maxSyllablesPerLine")}
          onSet={(v) => setGoalValue("maxSyllablesPerLine", v)}
        />
        <RhymeSchemeCard
          target={goals.targetRhymeScheme ?? ""}
          perStanza={!!goals.targetRhymeSchemePerStanza}
          matches={goalEvaluation.rhymeSchemeMatches}
          schemePerLine={goalEvaluation.schemePerLine}
          onSet={setRhymeSchemeGoal}
          onSetPerStanza={setRhymeSchemePerStanza}
          isSoft={!!goals.softGoals?.includes("targetRhymeScheme")}
          onToggleSoft={() => toggleGoalSoft("targetRhymeScheme")}
        />
      </div>

      {goalEvaluation.softHints.length > 0 && (
        <ul className="goal-soft-hints">
          {goalEvaluation.softHints.map((h, i) => (
            <li key={i} className="goal-soft-hint">◇ {h}</li>
          ))}
        </ul>
      )}

      {goalEvaluation.warnings.length === 0 &&
      goalEvaluation.softHints.length === 0 &&
      hasAnyGoalSet(goals) ? (
        <p className="goal-on-target">✓ All goals met</p>
      ) : null}
    </div>
  );
}
