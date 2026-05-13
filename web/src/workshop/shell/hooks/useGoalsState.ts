import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { loadWorkshopGoals, saveWorkshopGoals } from "@/workshop/goals/storage";
import { FORM_PRESETS, type WorkshopGoals } from "@/workshop/goals/types";
import { parseGoalInput } from "@/workshop/shell/workshop-helpers";

const GOALS_STORAGE_MSG =
  "Could not save your writing goals to browser storage.";

export interface GoalsState {
  goals: WorkshopGoals;
  updateGoal: (key: keyof WorkshopGoals) => (e: ChangeEvent<HTMLInputElement>) => void;
  setGoalValue: (key: keyof WorkshopGoals, value: number | undefined) => void;
  setRhymeSchemeGoal: (scheme: string | undefined) => void;
  setRhymeSchemePerStanza: (perStanza: boolean) => void;
  resetGoals: () => void;
  setSyllablePattern: (pattern: number[] | undefined) => void;
  toggleGoalSoft: (key: string) => void;
  applyGoalPreset: (presetKey: string | null) => void;
}

export function useGoalsState(
  onPersistenceError: (msg: string) => void,
  clearPersistenceErrorIfMatches: (msg: string) => void,
): GoalsState {
  const [goals, setGoals] = useState<WorkshopGoals>(() => loadWorkshopGoals());

  useEffect(() => {
    if (!saveWorkshopGoals(goals)) {
      onPersistenceError(GOALS_STORAGE_MSG);
      return;
    }
    clearPersistenceErrorIfMatches(GOALS_STORAGE_MSG);
  }, [goals, onPersistenceError, clearPersistenceErrorIfMatches]);

  const updateGoal =
    (key: keyof WorkshopGoals) => (e: ChangeEvent<HTMLInputElement>) => {
      const v = parseGoalInput(e.target.value);
      setGoals((g) => ({ ...g, [key]: v }));
    };

  const setGoalValue = useCallback(
    (key: keyof WorkshopGoals, value: number | undefined) => {
      setGoals((g) => ({ ...g, [key]: value }));
    },
    [],
  );

  const setRhymeSchemeGoal = useCallback((scheme: string | undefined) => {
    setGoals((g) => ({ ...g, targetRhymeScheme: scheme }));
  }, []);

  const setRhymeSchemePerStanza = useCallback((perStanza: boolean) => {
    setGoals((g) => ({
      ...g,
      targetRhymeSchemePerStanza: perStanza ? true : undefined,
    }));
  }, []);

  const resetGoals = useCallback(() => {
    setGoals({});
  }, []);

  const setSyllablePattern = useCallback((pattern: number[] | undefined) => {
    setGoals((g) => ({ ...g, syllablePattern: pattern, preset: undefined }));
  }, []);

  const toggleGoalSoft = useCallback((key: string) => {
    setGoals((g) => {
      const soft = new Set(g.softGoals ?? []);
      if (soft.has(key)) soft.delete(key); else soft.add(key);
      return { ...g, softGoals: soft.size > 0 ? [...soft] : undefined };
    });
  }, []);

  const applyGoalPreset = useCallback((presetKey: string | null) => {
    if (presetKey === null) {
      setGoals((g) => ({ softGoals: g.softGoals }));
      return;
    }
    const preset = FORM_PRESETS.find((p) => p.key === presetKey);
    if (preset) {
      setGoals((g) => ({
        ...preset.goals,
        preset: presetKey,
        softGoals: g.softGoals,
      }));
    }
  }, []);

  return {
    goals,
    updateGoal,
    setGoalValue,
    setRhymeSchemeGoal,
    setRhymeSchemePerStanza,
    resetGoals,
    setSyllablePattern,
    toggleGoalSoft,
    applyGoalPreset,
  };
}
