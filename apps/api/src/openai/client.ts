/**
 * Purpose: Call the OpenAI Responses API with retries, timeouts, and structured output parsing.
 * Persists: None.
 * Security Risks: Handles OpenAI API keys and model configuration; never log raw prompts.
 */

import { logEvent } from "@promptcalc/logger";

export type OpenAIClientConfig = {
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
};

export type OpenAIRequest = {
  input: Array<{ role: "system" | "user"; content: string }>;
  response_format: unknown;
  max_output_tokens?: number;
  model?: string;
};

export type OpenAIResponse = {
  id?: string;
  model?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string } | { type?: string; value?: string }>;
  }>;
  output_text?: string;
  usage?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const extractOutputText = (payload: OpenAIResponse): string | null => {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }
  const output = payload.output ?? [];
  for (const item of output) {
    const content = item.content ?? [];
    for (const part of content) {
      if (typeof (part as { text?: string }).text === "string") {
        return (part as { text: string }).text;
      }
      if (typeof (part as { value?: string }).value === "string") {
        return (part as { value: string }).value;
      }
    }
  }
  return null;
};

export const callOpenAIResponses = async <T>(
  traceId: string,
  config: OpenAIClientConfig,
  requestBody: OpenAIRequest,
  op: string
): Promise<{ parsed: T; raw: OpenAIResponse }> => {
  const baseUrl = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  const url = new URL("responses", baseUrl).toString();
  const body = JSON.stringify({
    model: requestBody.model ?? config.model,
    input: requestBody.input,
    response_format: requestBody.response_format,
    max_output_tokens: requestBody.max_output_tokens ?? config.maxTokens,
  });

  const maxAttempts = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey ?? ""}`,
          "content-type": "application/json",
        },
        body,
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      const payload = (await response.json()) as OpenAIResponse;
      const outputText = extractOutputText(payload);

      logEvent({
        level: response.ok ? "info" : "warn",
        op,
        traceId,
        event: "openai.responses",
        status: response.status,
        model: payload.model ?? config.model,
        latencyMs,
        inputTokens: payload.usage?.input_tokens,
        outputTokens: payload.usage?.output_tokens,
        totalTokens: payload.usage?.total_tokens,
        attempt,
      });

      if (!response.ok) {
        lastError = new Error(`OpenAI responded with status ${response.status}`);
      } else if (!outputText) {
        lastError = new Error("OpenAI response missing output text");
      } else {
        return {
          parsed: JSON.parse(outputText) as T,
          raw: payload,
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("OpenAI request failed");
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "openai.responses.error",
        message: lastError.message,
        attempt,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < maxAttempts) {
      await sleep(150 * 2 ** (attempt - 1));
    }
  }

  throw lastError ?? new Error("OpenAI request failed");
};
