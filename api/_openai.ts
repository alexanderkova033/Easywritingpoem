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
  },
  res: VercelResponse,
): Promise<OpenAICallResult | null> {
  let upstream: Response;

  try {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.max_tokens,
      temperature: opts.temperature,
    };
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

export function sendParsedResponse(
  res: VercelResponse,
  rawContent: string,
  resolvedModel: string,
): boolean {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error("Failed to parse OpenAI JSON:", err);
    console.error("Raw OpenAI content:", rawContent);

    res.status(502).json({
      error: "OpenAI returned invalid JSON.",
    });

    return false;
  }

  (parsed as Record<string, unknown>).meta = {
    model: resolvedModel,
    analyzedAt: new Date().toISOString(),
  };

  res.status(200).json(parsed);
  return true;
}