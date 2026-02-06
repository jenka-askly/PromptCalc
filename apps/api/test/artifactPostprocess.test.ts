/**
 * Purpose: Verify deterministic artifact post-processing for form safety and submit prevention.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it } from "vitest";

import { ensureFormSafety, normalizeCspMetaContent } from "../src/generation/artifactPostprocess";

describe("ensureFormSafety", () => {
  it("rewrites form buttons and injects submit prevention", () => {
    const input =
      "<!doctype html><html><body><form><button>Calculate</button></form></body></html>";
    const result = ensureFormSafety(input);

    expect(result.containsForm).toBe(true);
    expect(result.html).toContain("<button type=\"button\">Calculate</button>");
    expect(result.html).toContain("promptcalc-prevent-form-submit");
    expect(result.html).toContain("document.addEventListener('submit'");
  });

  it("leaves artifacts without forms unchanged", () => {
    const input = "<!doctype html><html><body><div>Ok</div></body></html>";
    const result = ensureFormSafety(input);

    expect(result.containsForm).toBe(false);
    expect(result.html).toBe(input);
  });
});


describe("normalizeCspMetaContent", () => {
  it("removes trailing period from CSP meta content", () => {
    const input = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; object-src 'none'."></head><body>ok</body></html>`;

    const result = normalizeCspMetaContent(input);

    expect(result.normalized).toBe(true);
    expect(result.html).toContain("content=\"default-src 'none'; object-src 'none'\"");
    expect(result.html).not.toContain("object-src 'none'.");
  });

  it("does not change CSP meta content without trailing period", () => {
    const input = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; object-src 'none'"></head><body>ok</body></html>`;

    const result = normalizeCspMetaContent(input);

    expect(result.normalized).toBe(false);
    expect(result.html).toBe(input);
  });
});
