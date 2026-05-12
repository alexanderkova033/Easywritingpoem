/**
 * Vercel serverless function — POST /api/suggest
 *
 * Receives { title, lines, type, context?, targetLine?, model? } and returns writing suggestions.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit } from "./_rate-limit";
import { callOpenAI } from "./_openai";
import { cooldownFor, precheckSpend, recordSpend } from "./_usage-cap";

type SuggestType = "idea" | "continue" | "words" | "rhyme" | "spark" | "line";

const PROMPTS: Record<SuggestType, string> = {
  idea: `Generate 3 distinct poem concepts for a writer starting from scratch. Each concept is one plain string: a specific scene or image, the emotional undercurrent, and an optional opening phrase — all woven into 2 sentences. Make concepts concrete and surprising, not generic. Return valid JSON: { "suggestions": ["string1", "string2", "string3"] } where every element is a plain string, not an object. No markdown fences.`,

  continue: `The user is writing a poem and is stuck on what comes next. Study the poem's tone, imagery, and direction, then suggest 3 possible next lines or short stanzas that feel natural and continue the poem. Each suggestion should be distinct in approach. Return valid JSON: { "suggestions": ["...", "...", "..."] }. Each suggestion is 1-2 lines of verse. No markdown fences.`,

  words: `The user is writing a poem and wants more interesting word choices. Analyze the existing lines and suggest 6 evocative, specific words or short phrases (nouns, verbs, or adjectives) that would fit the poem's theme and mood. Return valid JSON: { "suggestions": ["word1", "word2", "word3", "word4", "word5", "word6"] }. No explanations, just the words. No markdown fences.`,

  rhyme: `The user needs rhyme suggestions for their poem. Look at the last word of the final line and suggest 6 words that rhyme with it (exact or near-rhyme), preferably fitting the poem's subject and tone. Return valid JSON: { "suggestions": ["word1", "word2", "word3", "word4", "word5", "word6"], "rhymes_with": "<the word you found>" }. No markdown fences.`,

  spark: `The user needs a creative spark to break out of a rut. Based on the poem's existing theme and mood, suggest 3 unexpected creative directions, images, or "what if" prompts that could take the poem somewhere surprising and memorable. Return valid JSON: { "suggestions": ["...", "...", "..."] }. Each is 1 sentence. No markdown fences.`,

  line: `The user wants to improve a specific line in their poem. Study the poem's full context — its tone, imagery, rhythm, and voice — then suggest 4 distinct rewrites of the target line. Each rewrite should take a different approach: vary the imagery, rhythm, or angle while staying true to the poem's overall voice. Keep each to 1-2 lines. Return valid JSON: { "suggestions": ["...", "...", "...", "..."] }. No markdown fences. If a syllable count is specified, match it closely.`,
};

function buildPrompt(title: string, lines: string[], context: string, targetLine?: string, syllableTarget?: number, syllableTolerance?: number): string {
  const parts: string[] = [];
  if (title.trim()) parts.push(`Title: ${title.trim()}`);
  if (lines.length > 0) {
    parts.push("Poem so far:\n" + lines.map((l, i) => `${i + 1}: ${l}`).join("\n"));
  }
  if (targetLine) parts.push(`Line to rewrite: "${targetLine}"`);
  if (syllableTarget != null && syllableTarget > 0) {
    if (syllableTolerance != null && syllableTolerance > 0) {
      const lo = Math.max(1, syllableTarget - syllableTolerance);
      const hi = syllableTarget + syllableTolerance;
      parts.push(`Target syllable range: ${lo}–${hi} syllables (centered on ${syllableTarget}). Each rewrite must fall inside this range.`);
    } else {
      parts.push(`Target syllable count: ${syllableTarget} syllables. Each rewrite should match this count as closely as possible.`);
    }
  }
  if (context.trim()) parts.push(`User note: ${context.trim()}`);
  return parts.join("\n\n");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!(await checkRateLimit(req.headers["x-forwarded-for"]))) {
    return res.status(429).json({ error: "Too many requests — please wait a moment." });
  }

  const spend = await precheckSpend({
    rawIp: req.headers["x-forwarded-for"],
    endpoint: "suggest",
    cooldownMs: cooldownFor("suggest"),
  });
  if (!spend.ok) {
    if (spend.retryAfterSec) res.setHeader("Retry-After", String(spend.retryAfterSec));
    return res.status(spend.status).json(spend.body);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is not configured with an OpenAI API key." });
  }

  const body = req.body as {
    title?: unknown;
    lines?: unknown;
    type?: unknown;
    context?: unknown;
    targetLine?: unknown;
    syllableTarget?: unknown;
    syllableTolerance?: unknown;
    model?: unknown;
  };

  const suggestType = (typeof body.type === "string" ? body.type : "continue") as SuggestType;
  if (!PROMPTS[suggestType]) {
    return res.status(400).json({ error: "Invalid suggestion type." });
  }

  const title = typeof body.title === "string" ? body.title : "";
  const lines = Array.isArray(body.lines) ? (body.lines as unknown[]).map((l) => String(l ?? "")) : [];
  const context = typeof body.context === "string" ? body.context.slice(0, 1000) : "";
  const targetLine = typeof body.targetLine === "string" ? body.targetLine.slice(0, 500) : undefined;
  const syllableTarget = typeof body.syllableTarget === "number" && body.syllableTarget > 0 ? body.syllableTarget : undefined;
  const syllableTolerance = typeof body.syllableTolerance === "number" && body.syllableTolerance >= 0 ? Math.min(10, Math.round(body.syllableTolerance)) : undefined;
  const model = typeof body.model === "string" ? body.model : "gpt-5-nano";

  const totalChars = lines.reduce((sum, l) => sum + l.length, 0) + title.length;
  if (totalChars > 20_000) {
    return res.status(400).json({ error: "Poem too long (max 20000 characters)." });
  }
  if (lines.length > 500) {
    return res.status(400).json({ error: "Too many lines (max 500)." });
  }

  const result = await callOpenAI(
    apiKey,
    {
      model,
      messages: [
        { role: "system", content: PROMPTS[suggestType] },
        { role: "user", content: buildPrompt(title, lines, context, targetLine, syllableTarget, syllableTolerance) },
      ],
      max_tokens: suggestType === "line" ? 2000 : 1500,
      temperature: 0.85,
      reasoningEffort: "minimal",
    },
    res,
  );

  if (!result) return;

  await recordSpend(spend.ip, result.model, result.usage.promptTokens, result.usage.completionTokens);

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    return res.status(502).json({ error: "OpenAI returned invalid JSON." });
  }

  // Normalize: if suggestions are objects (e.g. {image, mood, opening}), join their values into a string
  if (
    parsed != null &&
    typeof parsed === "object" &&
    Array.isArray((parsed as Record<string, unknown>).suggestions)
  ) {
    const raw = (parsed as Record<string, unknown>).suggestions as unknown[];
    (parsed as Record<string, unknown>).suggestions = raw.map((s) => {
      if (typeof s === "string") return s;
      if (s != null && typeof s === "object") {
        return Object.values(s as Record<string, unknown>)
          .map((v) => String(v ?? ""))
          .filter(Boolean)
          .join("\n");
      }
      return String(s ?? "");
    });
  }

  return res.status(200).json(parsed);
}
