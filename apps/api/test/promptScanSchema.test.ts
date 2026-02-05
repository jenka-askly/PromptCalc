/**
 * Purpose: Validate PromptScanDecision JSON schema requirements for OpenAI Responses.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it } from "vitest";

import { promptScanSchema } from "../src/functions/calcs";

describe("promptScanSchema", () => {
  it("requires all properties and disallows additional properties", () => {
    const properties = promptScanSchema.properties ?? {};
    const propertyKeys = Object.keys(properties);
    expect(promptScanSchema.additionalProperties).toBe(false);
    expect(promptScanSchema.required).toEqual(expect.arrayContaining(propertyKeys));
  });

  it("allows null refusalCode", () => {
    const refusalCode =
      promptScanSchema.properties &&
      (promptScanSchema.properties as Record<string, { type?: unknown }>).refusalCode;
    expect(refusalCode).toBeDefined();
    expect(refusalCode?.type).toEqual(expect.arrayContaining(["string", "null"]));
  });
});
