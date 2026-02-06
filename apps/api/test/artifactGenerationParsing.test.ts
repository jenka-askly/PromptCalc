/**
 * Purpose: Verify artifact generation parsing, normalization, and schema strictness.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it } from "vitest";

import { analyzeArtifactGenerationOutput, parseArtifactGenerationOutput } from "../src/generation/artifactOutput";
import { generationSchema } from "../src/functions/calcs";

const buildManifest = () => ({
  specVersion: "1.1",
  title: "Feed rate calc",
  executionModel: "form",
  capabilities: { network: false, storage: false, dynamicCode: false },
});

describe("parseArtifactGenerationOutput", () => {
  it("parses a valid JSON string", () => {
    const manifest = buildManifest();
    const input = JSON.stringify({
      artifactHtml: "<html></html>",
      manifest,
    });

    const result = parseArtifactGenerationOutput(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.artifactHtml).toBe("<html></html>");
      expect(result.value.manifest).toEqual(manifest);
    }
  });

  it("unwraps JSON with wrapper keys", () => {
    const manifest = buildManifest();
    const input = JSON.stringify({
      result: {
        artifactHtml: "<html></html>",
        manifest,
      },
    });

    const result = parseArtifactGenerationOutput(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manifest).toEqual(manifest);
    }
  });

  it("parses JSON embedded in surrounding text", () => {
    const manifest = buildManifest();
    const payload = JSON.stringify({
      artifactHtml: "<html></html>",
      manifest,
    });
    const input = `Here is your output: ${payload} Thank you!`;

    const result = parseArtifactGenerationOutput(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.artifactHtml).toBe("<html></html>");
    }
  });

  it("accepts already-parsed objects", () => {
    const manifest = buildManifest();
    const input = {
      artifactHtml: "<html></html>",
      manifest,
    };

    const result = parseArtifactGenerationOutput(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manifest).toEqual(manifest);
    }
  });
});


describe("analyzeArtifactGenerationOutput", () => {
  it("returns structured schema errors for incomplete manifest capabilities", () => {
    const input = {
      artifactHtml: "<html></html>",
      manifest: {
        specVersion: "1.1",
        title: "Bad",
        executionModel: "form",
        capabilities: { network: false },
      },
    };

    const analyzed = analyzeArtifactGenerationOutput(input);

    expect(analyzed.result).toBeUndefined();
    expect(analyzed.extractedArtifactHtml).toBe("<html></html>");
    expect(analyzed.validationErrors[0]?.kind).toBe("schema_error");
    expect(analyzed.validationErrors[0]?.code).toBe("manifest.capabilities.storage_missing");
  });
});

describe("generationSchema", () => {
  it("marks manifest schema as strict with required keys", () => {
    const manifestSchema = (generationSchema as Record<string, unknown>).properties as Record<
      string,
      Record<string, unknown>
    >;
    const manifest = manifestSchema.manifest as Record<string, unknown>;
    const manifestProps = manifest.properties as Record<string, unknown>;
    const capabilities = manifestProps.capabilities as Record<string, unknown>;

    expect(manifest.additionalProperties).toBe(false);
    expect(manifest.required).toEqual(["specVersion", "title", "executionModel", "capabilities"]);
    expect(capabilities.additionalProperties).toBe(false);
    expect(capabilities.required).toEqual(["network", "storage", "dynamicCode"]);
  });
});
