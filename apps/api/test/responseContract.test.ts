/**
 * Purpose: Validate the shape of generation API responses for ok and refusal payloads.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it } from "vitest";

import {
  buildGenerateOkResponse,
  buildGenerateRefusedResponse,
} from "../src/generation/response";

describe("generation response contract", () => {
  it("builds ok responses with required fields", () => {
    const response = buildGenerateOkResponse(
      "calc-1",
      "ver-1",
      { title: "Test" },
      "<html></html>"
    );
    expect(response.status).toBe("ok");
    expect(response.calcId).toBe("calc-1");
    expect(response.versionId).toBe("ver-1");
    expect(response.manifest).toEqual({ title: "Test" });
    expect(response.artifactHtml).toBe("<html></html>");
  });

  it("builds refusal responses with required fields", () => {
    const response = buildGenerateRefusedResponse({
      code: "DISALLOWED_NETWORK",
      message: "No network.",
      safeAlternative: "Use offline data.",
    });
    expect(response.status).toBe("refused");
    expect(response.refusalReason.code).toBe("DISALLOWED_NETWORK");
  });
});
