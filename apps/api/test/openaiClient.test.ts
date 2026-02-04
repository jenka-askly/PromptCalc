/**
 * Purpose: Validate OpenAI Responses payload construction for legacy response_format inputs.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it } from "vitest";

import { buildOpenAIResponsesPayload, type OpenAIRequest } from "../src/openai/client";

const baseConfig = {
  apiKey: "test-key",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1",
  timeoutMs: 1_000,
  maxTokens: 128,
};

const baseInput: OpenAIRequest["input"] = [
  {
    role: "user",
    content: [{ type: "input_text", text: "Hello" }],
  },
];

describe("buildOpenAIResponsesPayload", () => {
  it("maps legacy response_format to text.format without emitting response_format", () => {
    const request = {
      input: baseInput,
      response_format: { type: "json_object" },
    } as OpenAIRequest;

    const payload = buildOpenAIResponsesPayload(baseConfig, request);

    expect("response_format" in payload).toBe(false);
    expect(payload.text?.format?.type).toBe("json_object");
  });

  it("preserves legacy json_schema format when provided", () => {
    const request = {
      input: baseInput,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "PromptScanDecision",
          schema: { type: "object" },
          strict: true,
        },
      },
    } as OpenAIRequest;

    const payload = buildOpenAIResponsesPayload(baseConfig, request);

    expect(payload.text?.format?.type).toBe("json_schema");
    expect(payload.text?.format).toMatchObject({
      type: "json_schema",
      name: "PromptScanDecision",
      schema: { type: "object" },
      strict: true,
    });
  });
});
