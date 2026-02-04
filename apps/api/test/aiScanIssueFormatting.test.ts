/**
 * Purpose: Validate AI scan issue normalization and formatting for stable log summaries.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it } from "vitest";

import {
  formatAiScanIssueSummary,
  summarizeAiScanIssues,
} from "../src/generation/aiScan";

describe("AI scan issue formatting", () => {
  it("formats issue objects into stable summary strings", () => {
    const summaries = summarizeAiScanIssues([
      {
        code: "DISALLOWED_EVAL",
        severity: "high",
        message: "Uses eval",
        snippet: "eval(userInput)",
      },
      {
        id: "NET-1",
        level: "medium",
        summary: "Attempts network access",
        evidence: "fetch('https://example.com')",
      },
    ]);

    expect(formatAiScanIssueSummary(summaries[0])).toBe(
      "code=DISALLOWED_EVAL | severity=high | message=Uses eval | evidence=eval(userInput)"
    );
    expect(formatAiScanIssueSummary(summaries[1])).toBe(
      "code=NET-1 | severity=medium | message=Attempts network access | evidence=fetch('https://example.com')"
    );
  });

  it("formats string issues as message summaries", () => {
    const summaries = summarizeAiScanIssues(["Contains suspicious script tag"]);
    expect(formatAiScanIssueSummary(summaries[0])).toBe(
      "message=Contains suspicious script tag"
    );
  });
});
