/**
 * Shared helpers for Vercel serverless functions that call the OpenAI API.
 */

import type { VercelResponse } from "@vercel/node";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface OpenAICallResult {
  ok: true;
  content: string;
  model: string;
  usage: OpenAIUsage;
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
    /** Per-attempt fetch timeout in ms. Default 30s. Long reasoning calls
     *  (analyze/compare on "medium") should pass a higher value (e.g. 90_000)
     *  so the OpenAI request isn't aborted mid-thought. */
    timeoutMs?: number;
    /** Number of retries after the initial attempt. Default 2. For long calls
     *  set this to 0 — a slow call rarely turns fast on retry, retries just
     *  multiply the user-visible wait before failure. */
    retries?: number;
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

    upstream = await fetchWithRetry(
      OPENAI_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      opts.retries ?? 2,
      opts.timeoutMs ?? 30000,
    );
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
    usage?: { prompt_tokens?: number; completion_tokens?: number };
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
    usage: {
      promptTokens:     data.usage?.prompt_tokens     ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Streaming variant of callOpenAI. Forwards each content delta to `onChunk`
 * as soon as it arrives so the caller can write it to its HTTP response
 * before the full model output is ready. Returns the fully accumulated
 * content + model + usage at the end for caching / spend accounting.
 *
 * On any pre-stream failure (network, 4xx/5xx upstream, missing body) writes
 * a JSON error to `res` and returns null — the caller should NOT have written
 * any response body before calling. On mid-stream failures the partial body
 * already written is preserved and the function returns null; the caller is
 * responsible for closing the connection.
 */
export async function streamOpenAI(
  apiKey: string,
  opts: {
    model: string;
    messages: OpenAIMessage[];
    max_tokens: number;
    jsonMode?: boolean;
    reasoningEffort?: "minimal" | "low" | "medium" | "high";
    timeoutMs?: number;
  },
  res: VercelResponse,
  onChunk: (delta: string) => void,
): Promise<OpenAICallResult | null> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_completion_tokens: opts.max_tokens,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (opts.model.startsWith("gpt-5") || opts.model.startsWith("o")) {
    body.reasoning_effort = opts.reasoningEffort ?? "minimal";
  }
  if (opts.jsonMode !== false) {
    body.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);

  let upstream: Response;
  try {
    upstream = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    console.error("OpenAI stream fetch failed:", err);
    res.status(502).json({
      error: `Could not reach OpenAI: ${err instanceof Error ? err.message : String(err)}`,
    });
    return null;
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(timeout);
    let msg = `OpenAI returned HTTP ${upstream.status}`;
    try {
      const errBody = (await upstream.json()) as { error?: { message?: string } };
      if (errBody?.error?.message) msg = errBody.error.message;
    } catch {
      /* ignore */
    }
    console.error("OpenAI stream returned an error:", msg);
    const status = upstream.status === 429 ? 429 : 502;
    res.status(status).json({ error: msg });
    return null;
  }

  let content = "";
  let resolvedModel = opts.model;
  let usage: OpenAIUsage = { promptTokens: 0, completionTokens: 0 };

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by blank lines; each event has one or more
      // `data: <json>` lines. We split per-line, ignore comments/empties, and
      // parse each `data:` payload as it arrives.
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const evt = JSON.parse(data) as {
            choices?: { delta?: { content?: string } }[];
            model?: string;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const delta = evt.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
            onChunk(delta);
          }
          if (evt.model) resolvedModel = evt.model;
          if (evt.usage) {
            usage = {
              promptTokens: evt.usage.prompt_tokens ?? 0,
              completionTokens: evt.usage.completion_tokens ?? 0,
            };
          }
        } catch {
          /* skip unparseable SSE frame */
        }
      }
    }
  } catch (err) {
    clearTimeout(timeout);
    console.error("OpenAI stream read failed mid-flight:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!content) {
    console.error("OpenAI stream produced empty content");
    return null;
  }

  return { ok: true, content, model: resolvedModel, usage };
}

/** Marker used to split the streamed analyze body into <model-content> + <meta-json>. */
export const STREAM_META_SEPARATOR = "\n___META___\n";

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
  extra?: Record<string, unknown>,
): boolean {
  const parsed = tolerantJsonParse(rawContent);
  if (parsed === null || typeof parsed !== "object") {
    console.error("Failed to parse OpenAI JSON. Raw content:", rawContent);
    res.status(502).json({ error: "OpenAI returned invalid JSON." });
    return false;
  }

  const out = parsed as Record<string, unknown>;
  out.meta = {
    model: resolvedModel,
    analyzedAt: new Date().toISOString(),
  };
  if (extra) Object.assign(out, extra);

  res.status(200).json(out);
  return true;
}