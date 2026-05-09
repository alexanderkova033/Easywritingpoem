/**
 * Shared helpers for Vercel serverless functions that call the OpenAI API.
 */

import type { VercelResponse } from "@vercel/node";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAICallResult {
  ok: true;
  content: string;
  model: string;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  timeoutMs = 30000,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;

      console.error(`OpenAI fetch attempt ${attempt + 1} failed:`, err);

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastError;
}

export async function callOpenAI(
  apiKey: string,
  opts: {
    model: string;
    messages: OpenAIMessage[];
    max_tokens: number;
    temperature: number;
    jsonMode?: boolean;
    /** GPT-5 reasoning budget. "minimal" sends nearly all tokens to output. */
    reasoningEffort?: "minimal" | "low" | "medium" | "high";
  },
  res: VercelResponse,
): Promise<OpenAICallResult | null> {
  let upstream: Response;

  try {
    // GPT-5 / o-series models reject `max_tokens` and require
    // `max_completion_tokens`. They also reject custom `temperature` (only
    // default 1 allowed). And they consume tokens internally for reasoning,
    // so without an explicit `reasoning_effort` the entire budget can be eaten
    // before any visible output is produced. Default to "minimal" so tokens
    // go to the answer.
    void opts.temperature;
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      max_completion_tokens: opts.max_tokens,
    };
    if (opts.model.startsWith("gpt-5") || opts.model.startsWith("o")) {
      body.reasoning_effort = opts.reasoningEffort ?? "minimal";
    }
    if (opts.jsonMode !== false) {
      body.response_format = { type: "json_object" };
    }

    upstream = await fetchWithRetry(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("OpenAI fetch failed completely:", err);

    res.status(502).json({
      error: `Could not reach OpenAI: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });

    return null;
  }

  if (!upstream.ok) {
    let msg = `OpenAI returned HTTP ${upstream.status}`;

    try {
      const errBody = (await upstream.json()) as {
        error?: { message?: string };
      };

      if (errBody?.error?.message) {
        msg = errBody.error.message;
      }
    } catch {
      /* ignore */
    }

    console.error("OpenAI returned an error:", msg);

    const status = upstream.status === 429 ? 429 : 502;
    res.status(status).json({ error: msg });
    return null;
  }

  const data = (await upstream.json()) as {
    choices?: { message?: { content?: string } }[];
    model?: string;
  };

  const content = data.choices?.[0]?.message?.content ?? "";

  if (!content) {
    console.error("OpenAI returned empty content:", data);

    res.status(502).json({
      error: "Empty response from OpenAI.",
    });

    return null;
  }

  return {
    ok: true,
    content,
    model: data.model ?? opts.model,
  };
}

/**
 * Strict JSON parse first, then a salvage pass for the common failure mode:
 * the model truncates mid-array (max_tokens hit) leaving unbalanced braces.
 * We strip code fences, trim partial trailing strings/keys, and close any
 * still-open brackets so partial responses still render most of the result.
 */
function tolerantJsonParse(raw: string): unknown | null {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  let s = raw.trim();
  // Strip optional ```json ... ``` fences.
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // Drop trailing commas before } or ].
  s = s.replace(/,\s*([\]}])/g, "$1");
  try { return JSON.parse(s); } catch { /* fall through */ }
  let inStr = false;
  let esc = false;
  let openCurly = 0;
  let openSquare = 0;
  for (const ch of s) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === "\"") { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") openCurly++;
    else if (ch === "}") openCurly--;
    else if (ch === "[") openSquare++;
    else if (ch === "]") openSquare--;
  }
  if (inStr) {
    const lastQuote = s.lastIndexOf("\"");
    if (lastQuote > -1) s = s.slice(0, lastQuote);
    s = s.replace(/,?\s*"[^"]*"\s*:\s*$/, "");
    s = s.replace(/,\s*$/, "");
  }
  while (openSquare > 0) { s += "]"; openSquare--; }
  while (openCurly > 0) { s += "}"; openCurly--; }
  s = s.replace(/,\s*([\]}])/g, "$1");
  try { return JSON.parse(s); } catch { return null; }
}

export function sendParsedResponse(
  res: VercelResponse,
  rawContent: string,
  resolvedModel: string,
): boolean {
  const parsed = tolerantJsonParse(rawContent);
  if (parsed === null || typeof parsed !== "object") {
    console.error("Failed to parse OpenAI JSON. Raw content:", rawContent);
    res.status(502).json({ error: "OpenAI returned invalid JSON." });
    return false;
  }

  (parsed as Record<string, unknown>).meta = {
    model: resolvedModel,
    analyzedAt: new Date().toISOString(),
  };

  res.status(200).json(parsed);
  return true;
}