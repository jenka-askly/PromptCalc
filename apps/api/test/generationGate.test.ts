/**
 * Purpose: Validate generation gating behavior for disabled or misconfigured OpenAI settings.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it } from "vitest";

import { resolveGenerationGate } from "../src/generation/gate";

const baseConfig = {
  enabled: true,
  apiKey: "key",
  model: "gpt-4.1",
  baseUrl: "https://api.openai.com/v1",
  timeoutMs: 1000,
  maxTokens: 2500,
  maxArtifactBytes: 200000,
};

describe("resolveGenerationGate", () => {
  it("returns refused when generation is disabled", () => {
    const result = resolveGenerationGate({ ...baseConfig, enabled: false });
    expect(result?.code).toBe("GENERATION_DISABLED");
  });

  it("returns refused when missing OpenAI key", () => {
    const result = resolveGenerationGate({ ...baseConfig, apiKey: undefined });
    expect(result?.code).toBe("MISSING_OPENAI_KEY");
  });
});
