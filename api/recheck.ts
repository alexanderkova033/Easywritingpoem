/**
 * Vercel serverless function — POST /api/recheck
 *
 * Cheap single-issue re-check. The user clicks "Re-check" on an issue card
 * after editing its line; we send only the changed line(s), the previous
 * version, and the original issue rationale and ask the model to judge if
 * the problem is resolved, partially addressed, or still present.
 *
 * Returns JSON: { status: "resolved"|"partial"|"still", note: "<≤22w>" }.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit, getRateLimitRetrySec } from "./_rate-limit";
import { callOpenAI, sendParsedResponse } from "./_openai";
import { cooldownFor, precheckSpend, recordSpend } from "./_usage-cap";

const SYSTEM_PROMPT = `You are a poetry editor checking whether a single line-level issue was addressed in a revision. You receive: the original issue (rationale + line range), the line text BEFORE, the line text AFTER, and a tiny bit of surrounding context.

Return JSON only (no fences). Keys:
  status: one of "resolved" (issue clearly fixed), "partial" (improved but the underlying weakness still shows), "still" (essentially the same problem), "elsewhere" (the line changed in a way that introduced a NEW problem worth flagging).
  note: ≤22 words. Plain spoken. One sentence. Focus on the specific change in word choice / rhythm / image — quote a word or two from the new line when possible.

Be honest but brief. No preamble, no "Great work!" filler. Just the verdict and a concrete reason.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!(await checkRateLimit(req.headers["x-forwarded-for"]))) {
    const retryAfterSec = await getRateLimitRetrySec(req.headers["x-forwarded-for"]);
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
    oldLine?: unknown;
    newLine?: unknown;
    context?: unknown;
    rationale?: unknown;
    headline?: unknown;
    lineRange?: unknown;
    model?: unknown;
  };

  const oldLine = typeof body.oldLine === "string" ? body.oldLine.slice(0, 400) : "";
  const newLine = typeof body.newLine === "string" ? body.newLine.slice(0, 400) : "";
  const context = typeof body.context === "string" ? body.context.slice(0, 600) : "";
  const rationale = typeof body.rationale === "string" ? body.rationale.slice(0, 800) : "";
  const headline = typeof body.headline === "string" ? body.headline.slice(0, 80) : "";
  const lineRange = typeof body.lineRange === "string" ? body.lineRange.slice(0, 30) : "";
  const model = typeof body.model === "string" ? body.model : "gpt-5-nano";

  if (!rationale.trim()) {
    return res.status(400).json({ error: "Missing `rationale` for the recheck." });
  }
  if (!oldLine.trim() && !newLine.trim()) {
    return res.status(400).json({ error: "Need at least one of `oldLine` or `newLine`." });
  }

  const spend = await precheckSpend({
    rawIp: req.headers["x-forwarded-for"],
    endpoint: "recheck",
    cooldownMs: cooldownFor("recheck", model),
  });
  if (!spend.ok) {
    if (spend.retryAfterSec) res.setHeader("Retry-After", String(spend.retryAfterSec));
    return res.status(spend.status).json(spend.body);
  }

  const sameText = oldLine.trim() === newLine.trim();
  const userMessage = [
    `Issue (${lineRange || "the affected line(s)"}): ${headline || "(no headline)"}.`,
    `Original critique:\n${rationale}`,
    "",
    "BEFORE:",
    oldLine || "(no previous version recorded)",
    "AFTER:",
    newLine || "(line removed)",
    "",
    sameText ? "Note: BEFORE and AFTER are identical." : "",
    context ? `\nSurrounding context (current draft):\n${context}` : "",
    "",
    "Judge if the issue is resolved. Be terse.",
  ].filter(Boolean).join("\n");

  const result = await callOpenAI(
    apiKey,
    {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 400,
      temperature: 0.3,
      reasoningEffort: "minimal",
    },
    res,
  );
  if (!result) return;

  await recordSpend(spend.ip, result.model, result.usage.promptTokens, result.usage.completionTokens);
  sendParsedResponse(res, result.content, result.model);
}
