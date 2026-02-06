/**
 * Purpose: Verify red-team artifact dumping includes deterministic dump directories when collateral dumping is enabled.
 * Persists: Writes temporary files under .promptcalc_artifacts/<traceId>/ during test and deletes them afterward.
 * Security Risks: Exercises dev-only dump pipeline that can write raw prompt/model output to disk.
 */

import { readFile, rm } from "fs/promises";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { dumpRedTeamArtifacts } from "../src/generation/dumpRedTeamArtifacts";

describe("dumpRedTeamArtifacts", () => {
  const traceId = "trace-test-dump-dir";
  const dumpRoot = path.resolve(process.cwd(), ".promptcalc_artifacts", traceId);

  afterEach(async () => {
    await rm(dumpRoot, { recursive: true, force: true });
  });

  it("returns dumpDir and paths when collateral dumping is enabled", async () => {
    process.env.PROMPTCALC_REDKIT = "1";

    const dumped = await dumpRedTeamArtifacts({
      traceId,
      stage: "error",
      prompt: "demo",
      genResponseRaw: { raw: true },
      html: "<html><body>artifact</body></html>",
      validation: {
        validator: "artifact_generation_output",
        failed: "schema",
        errors: [{ code: "manifest.capabilities.storage_missing" }],
      },
      error: {
        message: "schema validation failed",
        type: "SCHEMA_VALIDATION_FAILED",
      },
      meta: {
        ts: new Date().toISOString(),
        model: "test",
        scanPolicyMode: "warn",
        overrideArmed: true,
        overrideUsed: false,
        dumpCollateral: true,
      },
    });

    expect(dumped).not.toBeNull();
    expect(dumped?.dumpDir).toBe(dumpRoot);
    expect(dumped?.paths.some((entry) => entry.endsWith("profile.json"))).toBe(true);
    const htmlPath = dumped?.paths.find((entry) => entry.endsWith("extracted.html"));
    expect(htmlPath).toBeTruthy();
    const extractedHtml = await readFile(String(htmlPath), "utf8");
    expect(extractedHtml.length).toBeGreaterThan(0);
    const validationPath = dumped?.paths.find((entry) => entry.endsWith("validation.json"));
    const validationPayload = JSON.parse(await readFile(String(validationPath), "utf8")) as {
      validation?: { errors?: Array<{ code?: string }> };
    };
    expect(validationPayload.validation?.errors?.[0]?.code).toBe("manifest.capabilities.storage_missing");
  });
});
