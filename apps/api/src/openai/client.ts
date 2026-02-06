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

export type OpenAIInputContent = {
  type: "input_text";
  text: string;
};

export type OpenAITextFormat =
  | {
      type: "json_schema";
      name: string;
      schema: Record<string, unknown>;
      strict: boolean;
    }
  | {
      type: "json_object";
    }
  | {
      type: "text";
    };

type LegacyResponseFormat =
  | {
      type: "json_schema";
      name?: string;
      schema?: Record<string, unknown>;
      strict?: boolean;
      json_schema?: {
        name?: string;
        schema?: Record<string, unknown>;
        strict?: boolean;
      };
    }
  | {
      type: "json_object";
    }
  | {
      type: "text";
    };

export type OpenAIRequest = {
  input: Array<{ role: "system" | "user"; content: OpenAIInputContent[] }>;
  max_output_tokens?: number;
  model?: string;
  text?: {
    format?: OpenAITextFormat;
  };
  response_format?: LegacyResponseFormat;
};

export type OpenAIRequestOptions = {
  maxAttempts?: number;
  jsonSchemaFallback?: boolean;
  devLogOutputExtraction?: boolean;
};

export type OpenAIResponse = {
  id?: string;
  model?: string;
  error?: { message?: string };
  output?: Array<{
    content?: Array<{ type?: string; text?: string; value?: unknown }>;
  }>;
  output_text?: string;
  usage?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class OpenAIBadRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "OpenAIBadRequestError";
    this.status = status;
  }
}

export class OpenAIParseError extends Error {
  rawText: string;
  attempt: number;
  parseErrorMessage: string;
  parseErrorStack?: string;
  snippetPrefix: string;
  snippetSuffix: string;

  constructor(
    message: string,
    rawText: string,
    attempt: number,
    details?: { parseErrorMessage?: string; parseErrorStack?: string; snippetPrefix?: string; snippetSuffix?: string }
  ) {
    super(message);
    this.name = "OpenAIParseError";
    this.rawText = rawText;
    this.attempt = attempt;
    this.parseErrorMessage = details?.parseErrorMessage ?? message;
    this.parseErrorStack = details?.parseErrorStack;
    this.snippetPrefix = details?.snippetPrefix ?? "";
    this.snippetSuffix = details?.snippetSuffix ?? "";
  }
}

const extractOutputObject = (payload: OpenAIResponse): unknown | null => {
  const output = payload.output ?? [];
  for (const item of output) {
    const content = item.content ?? [];
    for (const part of content) {
      const value = (part as { value?: unknown }).value;
      if (value && typeof value === "object") {
        return value;
      }
    }
  }
  return null;
};

const extractModelText = (
  payload: OpenAIResponse,
  traceId: string,
  op: string,
  devLogOutputExtraction = false
): string | null => {
  if (typeof payload.output_text === "string") {
    if (devLogOutputExtraction) {
      logEvent({
        level: "info",
        op,
        traceId,
        event: "openai.responses.output_text_path",
        path: "output_text",
      });
    }
    return payload.output_text;
  }
  const output = payload.output ?? [];
  const parts: string[] = [];
  for (const item of output) {
    const content = item.content ?? [];
    for (const part of content) {
      const text = (part as { text?: string }).text;
      if (typeof text === "string") {
        parts.push(text);
      }
    }
  }
  if (parts.length > 0) {
    const joined = parts.join("");
    if (devLogOutputExtraction) {
      logEvent({
        level: "info",
        op,
        traceId,
        event: "openai.responses.output_text_path",
        path: "output_content_text",
      });
    }
    return joined;
  }
  if (devLogOutputExtraction) {
    logEvent({
      level: "info",
      op,
      traceId,
      event: "openai.responses.output_text_path",
      path: "missing",
    });
  }
  return null;
};

const truncateMessage = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;

const extractSchemaLogDetails = (
  format?: OpenAITextFormat
): {
  schemaName?: string;
  schemaProperties?: string[];
  schemaRequired?: string[];
} => {
  if (!format || format.type !== "json_schema") {
    return {};
  }
  const schema = format.schema;
  if (!schema || typeof schema !== "object") {
    return { schemaName: format.name };
  }
  const properties =
    typeof (schema as { properties?: unknown }).properties === "object"
      ? (schema as { properties?: Record<string, unknown> }).properties
      : undefined;
  const required = Array.isArray((schema as { required?: unknown }).required)
    ? ((schema as { required?: unknown }).required as Array<unknown>).map(String)
    : undefined;
  return {
    schemaName: format.name,
    schemaProperties: properties ? Object.keys(properties) : undefined,
    schemaRequired: required,
  };
};

const extractFirstJsonObject = (value: string): string | null => {
  const start = value.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
};

const stripCodeFences = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  const withoutOpeningFence = trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/u, "");
  const withoutClosingFence = withoutOpeningFence.replace(/\s*```$/u, "");
  return withoutClosingFence.trim();
};

const parseJsonLenient = <T>(value: string): T => {
  const cleaned = stripCodeFences(value);
  const trimmed = cleaned.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch (error) {
    const candidate = extractFirstJsonObject(trimmed);
    if (!candidate) {
      throw error;
    }
    return JSON.parse(candidate) as T;
  }
};

const parseJsonFlexible = <T>(value: unknown): T => {
  if (value && typeof value === "object") {
    return value as T;
  }
  if (typeof value === "string") {
    return parseJsonLenient<T>(value);
  }
  throw new Error("OpenAI response did not contain JSON text or object content.");
};

const extractErrorMessage = (payload: OpenAIResponse): string | undefined => {
  const message = payload.error?.message;
  if (typeof message !== "string") {
    return undefined;
  }
  return truncateMessage(message, 200);
};

const buildJsonObjectFormat = (): OpenAITextFormat => ({ type: "json_object" });

const resolveLegacyTextFormat = (legacy?: LegacyResponseFormat): OpenAITextFormat | undefined => {
  if (!legacy || typeof legacy !== "object") {
    return undefined;
  }
  if (legacy.type === "json_object") {
    return { type: "json_object" };
  }
  if (legacy.type === "text") {
    return { type: "text" };
  }
  if (legacy.type !== "json_schema") {
    return undefined;
  }
  const legacySchema = legacy.json_schema;
  const name = legacySchema?.name ?? legacy.name;
  const schema = legacySchema?.schema ?? legacy.schema;
  const strict = legacySchema?.strict ?? legacy.strict ?? true;
  if (!name || !schema) {
    return buildJsonObjectFormat();
  }
  return {
    type: "json_schema",
    name,
    schema,
    strict,
  };
};

const resolveTextFormat = (requestBody: OpenAIRequest): OpenAITextFormat | undefined =>
  requestBody.text?.format ?? resolveLegacyTextFormat(requestBody.response_format);

export const buildOpenAIResponsesPayload = (
  config: OpenAIClientConfig,
  requestBody: OpenAIRequest,
  formatOverride?: OpenAITextFormat
): {
  model: string;
  input: OpenAIRequest["input"];
  max_output_tokens: number;
  text?: OpenAIRequest["text"];
} => {
  const format = formatOverride ?? resolveTextFormat(requestBody);
  const text = format ? { ...(requestBody.text ?? {}), format } : requestBody.text;
  return {
    model: requestBody.model ?? config.model,
    input: requestBody.input,
    max_output_tokens: requestBody.max_output_tokens ?? config.maxTokens,
    text,
  };
};

const isJsonSchemaUnsupported = (errorMessage?: string): boolean => {
  if (!errorMessage) {
    return false;
  }
  const message = errorMessage.toLowerCase();
  return (
    message.includes("response_format") ||
    message.includes("text.format") ||
    message.includes("json_schema")
  );
};

export const callOpenAIResponses = async <T>(
  traceId: string,
  config: OpenAIClientConfig,
  requestBody: OpenAIRequest,
  op: string,
  options: OpenAIRequestOptions = {}
): Promise<{ parsed: T; raw: OpenAIResponse }> => {
  const baseUrl = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  const url = new URL("responses", baseUrl).toString();

  let maxAttempts = options.maxAttempts ?? 3;
  let lastError: Error | null = null;
  let usedJsonFallback = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const requestPayload = buildOpenAIResponsesPayload(
      config,
      requestBody,
      usedJsonFallback ? buildJsonObjectFormat() : undefined
    );
    const body = JSON.stringify(requestPayload);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const startedAt = Date.now();
    let shouldRetry = false;

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
      let payload: OpenAIResponse = {};
      try {
        payload = (await response.json()) as OpenAIResponse;
      } catch {
        payload = {};
      }
      const outputText = extractModelText(
        payload,
        traceId,
        op,
        options.devLogOutputExtraction ?? false
      );
      const outputObject = extractOutputObject(payload);

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
        if (response.status === 400) {
          const errorMessage = extractErrorMessage(payload);
          const schemaLogDetails = extractSchemaLogDetails(requestPayload.text?.format);
          logEvent({
            level: "warn",
            op,
            traceId,
            event: "openai.responses.bad_request",
            status: response.status,
            model: payload.model ?? requestPayload.model,
            requestKeys: Object.keys(requestPayload),
            errorMessage,
            inputKeys: requestPayload.input.map((item) => ({
              keys: Object.keys(item),
              contentKeys: item.content.map((content) => Object.keys(content)),
            })),
            ...schemaLogDetails,
          });
          if (
            !usedJsonFallback &&
            options.jsonSchemaFallback !== false &&
            requestBody.text?.format?.type === "json_schema" &&
            isJsonSchemaUnsupported(errorMessage)
          ) {
            logEvent({
              level: "info",
              op,
              traceId,
              event: "openai.responses.format_fallback",
              message: "Retrying with json_object format after 400.",
            });
            usedJsonFallback = true;
            if (attempt >= maxAttempts) {
              maxAttempts += 1;
            }
            shouldRetry = true;
            continue;
          }
          throw new OpenAIBadRequestError(
            "OpenAI request invalid (400). Check server configuration.",
            response.status
          );
        }
        lastError = new Error(`OpenAI responded with status ${response.status}`);
        shouldRetry = RETRYABLE_STATUSES.has(response.status);
      } else if (requestPayload.text?.format?.type === "text") {
        if (!outputText) {
          lastError = new Error("OpenAI response missing output text");
          shouldRetry = true;
        } else {
          return {
            parsed: outputText as T,
            raw: payload,
          };
        }
      } else if (!outputText && !outputObject) {
        lastError = new Error("OpenAI response missing output text");
        shouldRetry = true;
      } else {
        try {
          const jsonCandidate = outputObject ?? outputText;
          return {
            parsed: parseJsonFlexible<T>(jsonCandidate),
            raw: payload,
          };
        } catch (error) {
          const parseErrorMessage = error instanceof Error ? error.message : "JSON parse failed";
          const snippetPrefix =
            typeof outputText === "string" ? outputText.slice(0, 200) : "";
          const snippetSuffix =
            typeof outputText === "string" && outputText.length > 200
              ? outputText.slice(-200)
              : typeof outputText === "string"
                ? outputText
                : "";
          const message = `JSON parse failed. parseError=${parseErrorMessage}`;
          logEvent({
            level: "warn",
            op,
            traceId,
            event: "openai.responses.parse_failed",
            attempt,
            message: parseErrorMessage,
            outputPrefixSample: snippetPrefix || undefined,
            outputSuffixSample: snippetSuffix || undefined,
          });
          lastError = new OpenAIParseError(message, outputText ?? "", attempt, {
            parseErrorMessage,
            parseErrorStack: error instanceof Error ? error.stack : undefined,
            snippetPrefix,
            snippetSuffix,
          });
          shouldRetry = true;
        }
      }
    } catch (error) {
      if (error instanceof OpenAIBadRequestError) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error("OpenAI request failed");
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "openai.responses.error",
        message: lastError.message,
        attempt,
      });
      shouldRetry = true;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < maxAttempts && shouldRetry) {
      await sleep(150 * 2 ** (attempt - 1));
      continue;
    }
    if (!shouldRetry) {
      break;
    }
  }

  throw lastError ?? new Error("OpenAI request failed");
};
