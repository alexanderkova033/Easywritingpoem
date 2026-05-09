/**
 * Vercel serverless function — POST /api/generate-background
 *
 * Accepts { prompt } (a scene description or poem), calls OpenAI, and returns
 * a CustomBackgroundTheme JSON object with CSS variable values for the backdrop.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit } from "./_rate-limit";
import { callOpenAI } from "./_openai";

const SYSTEM_PROMPT = `You are a visual designer creating CSS colour themes for a poetry writing app. Given a description or poem, generate a cohesive colour palette that captures its mood and atmosphere.

Return ONLY this JSON object (no markdown fences, no explanation):
{
  "colorScheme": "dark" or "light",
  "label": "<2–4 word poetic name for this theme>",
  "bg": "<hex — deepest page background>",
  "surface": "<hex — panel/card background, slightly lighter than bg>",
  "surface2": "<hex — secondary surface, slightly lighter than surface>",
  "border": "<hex — subtle border colour>",
  "text": "<hex — main body text, high contrast against bg>",
  "muted": "<hex — secondary/muted text>",
  "accent": "<hex — highlight/interactive accent>",
  "ambientA": "<rgba(R,G,B,A) — A between 0.05–0.09>",
  "ambientB": "<rgba(R,G,B,A) — A between 0.04–0.07>",
  "ambientC": "<rgba(R,G,B,A) — A between 0.04–0.07>",
  "ambientD": "<rgba(R,G,B,A) — A between 0.03–0.05>",
  "shineTop": "<rgba(R,G,B,A)>",
  "shineMid": "<rgba(R,G,B,A) — A between 0.02–0.05>",
  "netLine": "<rgba(R,G,B,A) — very subtle grid line, A between 0.02–0.05>"
}

Rules:
• Choose dark (bg in range #080808–#181818) for night, moody, dramatic, or intimate scenes. Choose light (bg in range #e8e8e8–#f6f6f6) for day, airy, fresh, or open scenes.
• surface must be noticeably but not dramatically lighter than bg. surface2 slightly lighter than surface.
• text must have WCAG AA contrast (4.5:1 ratio minimum) against bg.
• accent should be the emotional "colour" of the poem/scene — one that fits the mood, not merely vivid.
• Ambient rgba values use colours harmonious with the accent; they are nearly transparent atmospheric washes.
• shineTop for dark themes: rgba with A 0.04–0.06. For light themes: rgba(255,255,255,0.35–0.50).
• Return ONLY the JSON — no extra text, no code block.`;

interface GeneratedTheme {
  colorScheme: unknown;
  label: unknown;
  bg: unknown;
  surface: unknown;
  surface2: unknown;
  border: unknown;
  text: unknown;
  muted: unknown;
  accent: unknown;
  ambientA: unknown;
  ambientB: unknown;
  ambientC: unknown;
  ambientD: unknown;
  shineTop: unknown;
  shineMid: unknown;
  netLine: unknown;
}

const REQUIRED_FIELDS: (keyof GeneratedTheme)[] = [
  "colorScheme", "label", "bg", "surface", "surface2", "border",
  "text", "muted", "accent", "ambientA", "ambientB", "ambientC",
  "ambientD", "shineTop", "shineMid", "netLine",
];

function validateTheme(obj: Record<string, unknown>): string | null {
  for (const field of REQUIRED_FIELDS) {
    if (typeof obj[field] !== "string" || !(obj[field] as string).trim()) {
      return `Missing or empty field: ${field}`;
    }
  }
  if (obj.colorScheme !== "light" && obj.colorScheme !== "dark") {
    return `colorScheme must be "light" or "dark"`;
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkRateLimit(req.headers["x-forwarded-for"])) {
    return res.status(429).json({ error: "Too many requests — please wait a moment." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is not configured with an OpenAI API key." });
  }

  const body = req.body as { prompt?: unknown };
  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    return res.status(400).json({ error: "Missing or empty `prompt` in request body." });
  }

  const prompt = body.prompt.trim().slice(0, 2000);

  const result = await callOpenAI(
    apiKey,
    {
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 2000,
      temperature: 0.7,
      reasoningEffort: "minimal",
    },
    res,
  );
  if (!result) return;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result.content) as Record<string, unknown>;
  } catch {
    return res.status(502).json({ error: "OpenAI returned invalid JSON." });
  }

  const validationError = validateTheme(parsed);
  if (validationError) {
    return res.status(502).json({ error: `Invalid theme from AI: ${validationError}` });
  }

  return res.status(200).json(parsed);
}
