/**
 * Purpose: Ensure generated artifacts include required CSP meta tags and safety banner text.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it } from "vitest";

import { getPromptCalcPolicy } from "../src/policy/policy";
import { scanArtifactHtml } from "../src/policy/scanner";

const cspMeta =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; connect-src 'none'; img-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'\">";

describe("scanArtifactHtml safety requirements", () => {
  it("fails when CSP meta is missing", async () => {
    const policy = await getPromptCalcPolicy();
    const html = "<html><body>Generated calculator (offline). Do not enter passwords.</body></html>";
    const result = scanArtifactHtml(html, policy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("MISSING_CSP");
    }
  });

  it("fails when banner text is missing", async () => {
    const policy = await getPromptCalcPolicy();
    const html = `<html><head>${cspMeta}</head><body><h1>Calc</h1></body></html>`;
    const result = scanArtifactHtml(html, policy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("MISSING_CSP");
    }
  });

  it("passes when CSP and banner are present", async () => {
    const policy = await getPromptCalcPolicy();
    const html = `<html><head>${cspMeta}</head><body>Generated calculator (offline). Do not enter passwords.</body></html>`;
    const result = scanArtifactHtml(html, policy);
    expect(result.ok).toBe(true);
  });
});
