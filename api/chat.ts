/**
 * Vercel serverless function — POST /api/chat
 *
 * Receives { title, lines, message, analysisContext? } and returns { reply: string }.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit, getRateLimitRetrySec } from "./_rate-limit";
import { callOpenAI } from "./_openai";

const SYSTEM_PROMPT = `You are a thoughtful poetry editor and writing coach. The user has just written a poem and received AI feedback on it. They want to have a conversation with you about their poem — asking questions, getting clarification on feedback, brainstorming ideas, or exploring craft.

Be warm, specific, and constructive. Reference lines or images from their poem when relevant. Keep responses concise — 2-4 sentences unless the question genuinely needs more. Focus on helping the poet grow, not just critiquing.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkRateLimit(req.headers["x-forwarded-for"])) {
    const retryAfterSec = getRateLimitRetrySec(req.headers["x-forwarded-for"]);
    if (retryAfterSec > 0) res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({
      error: "Too many requests — please wait a moment.",
      retryAfterSec,
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is not configured with an OpenAI API key." });
  }

  const body = req.body as {
    title?: unknown;
    lines?: unknown;
    message?: unknown;
    analysisContext?: unknown;
    history?: unknown;
    model?: unknown;
  };

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const lines = Array.isArray(body.lines) ? (body.lines as unknown[]).map((l) => String(l ?? "")) : [];
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const analysisContext = typeof body.analysisContext === "string" ? body.analysisContext : "";
  const model = typeof body.model === "string" ? body.model : "gpt-5-nano";

  // Cap forwarded history to keep token usage bounded.
  const MAX_HISTORY_TURNS = 6;
  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history = rawHistory
    .map((entry) => entry as { role?: unknown; content?: unknown })
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role as "user" | "assistant", content: (m.content as string).slice(0, 4000) }))
    .slice(-MAX_HISTORY_TURNS);

  if (!message) {
    return res.status(400).json({ error: "No message provided." });
  }

  // First turn carries the poem in the system message; subsequent turns rely
  // on the chat history to reference it. Saves the full poem on every reply
  // after the first.
  const isFirstTurn = history.length < 2;
  const poemSection = isFirstTurn && lines.length > 0
    ? `\nPoem${title ? ` — "${title}"` : ""}:\n${lines.map((l, i) => `${i + 1}: ${l}`).join("\n")}`
    : "";

  const analysisSection = isFirstTurn && analysisContext
    ? `\nRecent analysis summary:\n${analysisContext}`
    : "";

  const systemContent = `${SYSTEM_PROMPT}${poemSection}${analysisSection}`;

  const result = await callOpenAI(
    apiKey,
    {
      model,
      messages: [
        { role: "system", content: systemContent },
        ...history,
        { role: "user", content: message },
      ],
      max_tokens: 1500,
      temperature: 0.7,
      jsonMode: false,
      reasoningEffort: "minimal",
    },
    res,
  );

  if (!result) return;

  return res.status(200).json({ reply: result.content });
}
