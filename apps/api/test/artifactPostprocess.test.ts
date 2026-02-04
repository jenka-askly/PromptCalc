/**
 * Purpose: Verify deterministic artifact post-processing for form safety and submit prevention.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it } from "vitest";

import { ensureFormSafety } from "../src/generation/artifactPostprocess";

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
