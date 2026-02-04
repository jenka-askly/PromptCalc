/**
 * Purpose: Ensure AI scan issue handling only blocks disallowed categories and allows inline patterns.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it } from "vitest";

import { partitionAiScanIssues } from "../src/generation/aiScan";

describe("AI scan policy handling", () => {
  it("treats inline JS, postMessage, and unsafe-inline CSP as allowed", () => {
    const { disallowed, allowed } = partitionAiScanIssues([
      {
        category: "inline_script",
        message: "Inline script used for calculations.",
        evidence: "<script>calculate()</script>",
      },
      {
        category: "postmessage",
        message: "Uses postMessage handshake.",
        evidence: "window.postMessage('ready', '*')",
      },
      {
        category: "unsafe_inline_csp",
        message: "CSP allows unsafe-inline.",
        evidence: "script-src 'unsafe-inline'",
      },
    ]);

    expect(disallowed).toHaveLength(0);
    expect(allowed).toHaveLength(3);
  });

  it("flags disallowed categories for refusal", () => {
    const { disallowed } = partitionAiScanIssues([
      {
        category: "dynamic_code",
        message: "Uses eval.",
        evidence: "eval(userInput)",
      },
      {
        category: "networking",
        message: "Calls fetch.",
        evidence: "fetch('https://example.com')",
      },
    ]);

    expect(disallowed).toHaveLength(2);
  });

  it("classifies string issues with disallowed patterns", () => {
    const { disallowed } = partitionAiScanIssues([
      "Found fetch('https://example.com') in script.",
    ]);

    expect(disallowed).toHaveLength(1);
  });
});
