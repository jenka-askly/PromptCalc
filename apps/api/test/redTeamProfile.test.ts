/**
 * Purpose: Verify red-team debug profile normalization and profile ID stability.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it } from "vitest";

import { defaultProfile, normalizeProfile, profileId } from "@promptcalc/types";

describe("red-team debug profile", () => {
  it("normalizes missing values to defaults", () => {
    const profile = normalizeProfile({ enabled: true, scanMode: "warn" });
    expect(profile.enabled).toBe(true);
    expect(profile.scanMode).toBe("warn");
    expect(profile.strictInstructions).toBe(true);
  });

  it("generates stable profile IDs", () => {
    const id1 = profileId(defaultProfile());
    const id2 = profileId(defaultProfile());
    expect(id1).toHaveLength(8);
    expect(id1).toBe(id2);
  });
});
