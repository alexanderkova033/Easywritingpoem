/**
 * Vercel serverless function — POST /api/suggest
 *
 * Receives { title, lines, type, context?, targetLine?, cursorLine?, selectedText?, steer?, model? } and returns writing suggestions.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit } from "./_rate-limit";
import { callOpenAI } from "./_openai";
import { cooldownFor, precheckSpend, recordSpend } from "./_usage-cap";
import { gibberishGuard } from "./_gibberish";

type SuggestType = "idea" | "continue" | "words" | "rhyme" | "spark" | "line";

const PROMPTS: Record<SuggestType, string> = {
  idea: `You generate poem CONCEPTS for a writer starting from scratch. A concept is a specific scene + an emotional undercurrent + an optional opening phrase, woven into 1–2 sentences. Concepts must be CONCRETE and SURPRISING — never abstract themes like "loss" or "hope alone." Anchor in a particular image, place, person, or moment.

Return valid JSON: { "suggestions": ["string1", "string2", "string3"] }. Each element is a plain string (NOT an object). No markdown fences.

Good examples:
- "A grandmother folding the same shirt for the third time at 4am — the laundry room as a confession booth, light buzzing."
- "The hour the highway empties: a hitchhiker counting the gap between cars like prayer beads, deciding if she'll go home."
- "A boy who has memorized every constellation but cannot find his street at night — borrowed maps and small humiliations."

Bad examples (do NOT produce these):
- "A poem about love." (too abstract)
- "Reflections on the passage of time." (vague theme, no scene)`,

  continue: `You suggest 3 distinct next lines or short stanzas to continue an in-progress poem. Study the poem's tone, imagery, rhythm, and direction. Each of the 3 suggestions must take a different APPROACH — vary the rhythm (e.g. one shorter, one longer), the imagery, or the angle. Stay TRUE to the poem's voice — don't introduce themes not present.

Return valid JSON: { "suggestions": ["...", "...", "..."] }. Each suggestion is 1–3 lines of verse. Use "\\n" inside a suggestion for a line break. No markdown fences, no explanations, no labels.

Bad outputs (do NOT produce these):
- A generic moralizing closer like "And so we go on."
- Three near-identical lines.
- A new topic the existing poem hasn't established.`,

  words: `The user is writing a poem and wants more interesting word choices. Analyze the existing lines and suggest 6 evocative, specific words or short phrases (nouns, verbs, or adjectives) that would fit the poem's theme and mood. Avoid generic poetic vocabulary ("soul," "heart," "whisper," "shadow") unless the poem already uses that register. Return valid JSON: { "suggestions": ["word1", "word2", "word3", "word4", "word5", "word6"] }. No explanations, just the words. No markdown fences.`,

  rhyme: `The user needs rhyme suggestions for their poem. Find the last word of the final line (or use the targetLine if provided), then return rhymes grouped by type:
- exact: strict perfect rhymes (same final stressed vowel + following consonants)
- near: near-rhymes (same vowel sound, slightly different consonants)
- slant: slant/imperfect rhymes (consonance or assonance only)

Each group should contain words that would actually fit the poem's subject and tone — avoid generic filler. Return valid JSON: { "rhymes_with": "<the word you found>", "exact": ["...", "..."], "near": ["...", "..."], "slant": ["...", "..."], "suggestions": ["..."] } — also include a "suggestions" array containing all rhymes flattened (exact first, then near, then slant) for backward compatibility. Up to 4 per group; if a group has no good candidates, return an empty array. No markdown fences.`,

  spark: `The user has a poem in progress and needs a CREATIVE SPARK — a directional jolt to break a rut. You must NOT suggest starting concepts, scenes, or topics (that is the "idea" tool's job). Instead suggest 3 STRUCTURAL or ANGULAR pivots that take what they already have and twist it. Each suggestion is one sentence, written as an imperative or "What if…" prompt.

Valid forms:
- A constraint ("Cut every adjective from the next stanza.")
- A swap ("Rewrite the speaker as the object they're looking at.")
- A what-if ("What if the third line were a lie the speaker is trying to believe?")
- A reversal ("Tell the same scene in reverse — last image first.")
- A formal pivot ("Break the longest line in two; let the silence carry meaning.")

Return valid JSON: { "suggestions": ["...", "...", "..."] }. Each suggestion is 1 sentence, imperative or interrogative. No new themes, scenes, or starting concepts. No markdown fences.

Bad outputs (do NOT produce these):
- "A poem about the sea at dawn." (that's an idea, not a spark)
- "Try writing about your grandmother." (new topic, not a pivot on what exists)
- Anything that doesn't reference, transform, or reframe the existing draft.`,

  line: `The user wants to improve a specific line in their poem. Study the poem's full context — its tone, imagery, rhythm, and voice — then suggest 4 distinct rewrites of the target line. Each rewrite should take a different approach: vary the imagery, rhythm, or angle while staying true to the poem's overall voice. Keep each to 1-2 lines. Return valid JSON: { "suggestions": ["...", "...", "...", "..."] }. No markdown fences. If a syllable count is specified, match it closely.`,
};

interface BuildPromptArgs {
  title: string;
  lines: string[];
  context: string;
  targetLine?: string;
  cursorLine?: number;
  selectedText?: string;
  steer?: string;
  syllableTarget?: number;
  syllableTolerance?: number;
  type: SuggestType;
}

function buildPrompt(args: BuildPromptArgs): string {
  const { title, lines, context, targetLine, cursorLine, selectedText, steer, syllableTarget, syllableTolerance, type } = args;
  const parts: string[] = [];
  if (title.trim()) parts.push(`Title: ${title.trim()}`);
  if (lines.length > 0) {
    parts.push("Poem so far:\n" + lines.map((l, i) => `${i + 1}: ${l}`).join("\n"));
  }
  if (targetLine) parts.push(`Line to rewrite: "${targetLine}"`);

  // For "continue", indicate the anchor (selection or cursor line).
  if (type === "continue") {
    if (selectedText && selectedText.trim()) {
      parts.push(`The user has SELECTED this passage as the anchor — continue from immediately after it (not from the end of the poem):\n"""\n${selectedText.trim()}\n"""`);
    } else if (cursorLine != null && cursorLine > 0 && cursorLine < lines.length) {
      // Only flag a mid-poem cursor; if cursor is at the last line, the default "continue from end" behaviour is fine.
      parts.push(`The user's cursor is at line ${cursorLine}. Continue from immediately after line ${cursorLine}, not from the end of the poem. Your suggestions should bridge into line ${cursorLine + 1} naturally.`);
    }
  }

  if (syllableTarget != null && syllableTarget > 0) {
    if (syllableTolerance != null && syllableTolerance > 0) {
      const lo = Math.max(1, syllableTarget - syllableTolerance);
      const hi = syllableTarget + syllableTolerance;
      parts.push(`Target syllable range: ${lo}–${hi} syllables (centered on ${syllableTarget}). Each rewrite must fall inside this range.`);
    } else {
      parts.push(`Target syllable count: ${syllableTarget} syllables. Each rewrite should match this count as closely as possible.`);
    }
  }

  if (steer && steer.trim()) parts.push(`Steering: ${steer.trim()}`);
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
    cursorLine?: unknown;
    selectedText?: unknown;
    steer?: unknown;
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
  const cursorLine = typeof body.cursorLine === "number" && body.cursorLine > 0 ? Math.floor(body.cursorLine) : undefined;
  const selectedText = typeof body.selectedText === "string" ? body.selectedText.slice(0, 1000) : undefined;
  const steer = typeof body.steer === "string" ? body.steer.slice(0, 200) : undefined;
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

  // Skip the gibberish guard for `idea`/`spark` types — the user may have
  // nothing typed at all and is asking for a starting concept.
  if (suggestType !== "idea" && suggestType !== "spark") {
    const guardText = [title, lines.join("\n"), targetLine ?? "", context]
      .filter(Boolean)
      .join("\n");
    if (guardText.length >= 40) {
      const gib = await gibberishGuard({
        rawIp: req.headers["x-forwarded-for"],
        text: guardText,
        apiKey,
      });
      if (!gib.ok) {
        if (gib.retryAfterSec) res.setHeader("Retry-After", String(gib.retryAfterSec));
        return res.status(gib.status).json(gib.body);
      }
    }
  }

  const result = await callOpenAI(
    apiKey,
    {
      model,
      messages: [
        { role: "system", content: PROMPTS[suggestType] },
        {
          role: "user",
          content: buildPrompt({
            title,
            lines,
            context,
            targetLine,
            cursorLine,
            selectedText,
            steer,
            syllableTarget,
            syllableTolerance,
            type: suggestType,
          }),
        },
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

  // For rhyme, if the model returned grouped exact/near/slant, synthesize the
  // flat suggestions array (some clients still read it). If suggestions is
  // already populated, leave it alone.
  if (
    suggestType === "rhyme" &&
    parsed != null &&
    typeof parsed === "object"
  ) {
    const obj = parsed as Record<string, unknown>;
    const exact = Array.isArray(obj.exact) ? (obj.exact as unknown[]).map((s) => String(s ?? "")).filter(Boolean) : [];
    const near = Array.isArray(obj.near) ? (obj.near as unknown[]).map((s) => String(s ?? "")).filter(Boolean) : [];
    const slant = Array.isArray(obj.slant) ? (obj.slant as unknown[]).map((s) => String(s ?? "")).filter(Boolean) : [];
    if (!Array.isArray(obj.suggestions) || (obj.suggestions as unknown[]).length === 0) {
      obj.suggestions = [...exact, ...near, ...slant];
    }
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
