import type { CustomBackgroundTheme } from "./presets";
import { parseAiErrorAndNotify } from "../../ai-cost/aiBudgetBus";

/**
 * Calls POST /api/generate-background with a description or poem text and
 * returns a CustomBackgroundTheme with CSS variable values for the backdrop.
 */
export async function generateBackground(
  prompt: string,
  signal?: AbortSignal,
): Promise<CustomBackgroundTheme> {
  const response = await fetch("/api/generate-background", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const { message } = await parseAiErrorAndNotify(response, "generate-background");
    throw new Error(message);
  }

  return response.json() as Promise<CustomBackgroundTheme>;
}
