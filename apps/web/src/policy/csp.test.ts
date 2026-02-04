/**
 * Purpose: Verify the CSP template includes required directives for sandboxing.
 * Persists: None.
 * Security Risks: Confirms CSP stays aligned with platform security policy.
 */

import { describe, expect, it } from "vitest";

import { getCspTemplate } from "./csp";

describe("getCspTemplate", () => {
  it("includes required directives", () => {
    const csp = getCspTemplate();

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("style-src 'unsafe-inline'");
  });
});
