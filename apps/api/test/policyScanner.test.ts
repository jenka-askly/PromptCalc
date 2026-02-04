/**
 * Purpose: Validate deterministic policy scanning for banned patterns and tags.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it } from "vitest";

import { getPromptCalcPolicy } from "../src/policy/policy";
import { scanArtifactHtml } from "../src/policy/scanner";

const baseHtml = (body: string) =>
  `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'"></head><body>Generated calculator (offline). Do not enter passwords.${body}</body></html>`;

describe("scanArtifactHtml", () => {
  it("blocks fetch calls", async () => {
    const policy = await getPromptCalcPolicy();
    const result = scanArtifactHtml(baseHtml("<script>fetch('x')</script>"), policy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DISALLOWED_NETWORK");
    }
  });

  it("blocks external script tags", async () => {
    const policy = await getPromptCalcPolicy();
    const result = scanArtifactHtml(baseHtml("<script src=\"https://cdn\"></script>"), policy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DISALLOWED_EXTERNAL_DEPENDENCY");
    }
  });

  it("blocks eval", async () => {
    const policy = await getPromptCalcPolicy();
    const result = scanArtifactHtml(baseHtml("<script>eval('2+2')</script>"), policy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DISALLOWED_EVAL");
    }
  });
});
