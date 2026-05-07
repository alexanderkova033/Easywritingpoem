import type { CustomBackgroundTheme } from "./presets";

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
    let msg = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  return response.json() as Promise<CustomBackgroundTheme>;
}
