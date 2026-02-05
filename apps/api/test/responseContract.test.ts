/**
 * Purpose: Validate the shape of generation API responses for ok and refusal payloads.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it } from "vitest";

import {
  buildGenerateOkResponse,
  buildGenerateScanBlockResponse,
  buildGenerateScanSkippedResponse,
  buildGenerateScanWarnResponse,
} from "../src/generation/response";

describe("generation response contract", () => {
  it("builds ok responses with required fields", () => {
    const response = buildGenerateOkResponse(
      "calc-1",
      "ver-1",
      { title: "Test" },
      "<html></html>",
      "allow",
      false
    );
    expect(response.kind).toBe("ok");
    expect(response.status).toBe("ok");
    expect(response.calcId).toBe("calc-1");
    expect(response.versionId).toBe("ver-1");
    expect(response.manifest).toEqual({ title: "Test" });
    expect(response.artifactHtml).toBe("<html></html>");
    expect(response.scanOutcome).toBe("allow");
  });

  it("builds scan-block responses", () => {
    const response = buildGenerateScanBlockResponse({
      code: "DISALLOWED_NETWORK",
      message: "No network.",
      safeAlternative: "Use offline data.",
    });
    expect(response.kind).toBe("scan_block");
    expect(response.status).toBe("refused");
    expect(response.refusalReason.code).toBe("DISALLOWED_NETWORK");
  });

  it("builds scan warn and skipped responses", () => {
    const warnResponse = buildGenerateScanWarnResponse({
      refusalCode: "DISALLOWED_NETWORK",
      categories: ["networking"],
      reason: "Prompt requested network.",
    });
    expect(warnResponse.kind).toBe("scan_warn");
    expect(warnResponse.requiresUserProceed).toBe(true);

    const skippedResponse = buildGenerateScanSkippedResponse();
    expect(skippedResponse.kind).toBe("scan_skipped");
    expect(skippedResponse.requiresUserProceed).toBe(true);
  });
});
