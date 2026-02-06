/**
 * Purpose: Normalize and validate OpenAI artifact generation outputs.
 * Persists: None.
 * Security Risks: Handles model-generated HTML and manifest data; avoid logging full HTML.
 */

export type ArtifactGenerationOutput = {
  artifactHtml: string;
  manifest: Record<string, unknown>;
  notes?: string;
};

export type ArtifactValidationError = {
  kind: "parse_error" | "schema_error";
  code: string;
  path?: string;
  message: string;
  expected?: string;
  actual?: string;
};

export type ArtifactOutputAnalysis = {
  parsedJson?: unknown;
  extractedArtifactHtml?: string;
  validationErrors: ArtifactValidationError[];
  result?: ArtifactGenerationOutput;
};

type ParseResult =
  | { ok: true; value: ArtifactGenerationOutput }
  | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractFirstJsonObject = (value: string): string | null => {
  const start = value.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
};

const parseJsonFlexible = (value: unknown): unknown => {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string") {
    throw new Error("Expected JSON string or object.");
  }

  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    const candidate = extractFirstJsonObject(trimmed);
    if (!candidate) {
      throw error;
    }
    return JSON.parse(candidate) as unknown;
  }
};

const unwrapWrapperObject = (value: Record<string, unknown>): Record<string, unknown> => {
  const preferredKeys = ["result", "data", "output"];
  for (const key of preferredKeys) {
    const candidate = value[key];
    if (isRecord(candidate)) {
      return candidate;
    }
  }

  const keys = Object.keys(value);
  if (keys.length === 1) {
    const candidate = value[keys[0]];
    if (isRecord(candidate)) {
      return candidate;
    }
  }

  return value;
};

const normalizeArtifactPayload = (value: Record<string, unknown>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = { ...value };

  if (normalized.artifactHtml === undefined && typeof value.html === "string") {
    normalized.artifactHtml = value.html;
  }

  if (normalized.manifest === undefined) {
    const manifestJson = value.manifestJson;
    if (isRecord(manifestJson)) {
      normalized.manifest = manifestJson;
    } else if (typeof manifestJson === "string") {
      try {
        const parsed = parseJsonFlexible(manifestJson);
        if (isRecord(parsed)) {
          normalized.manifest = parsed;
        }
      } catch {
        // Ignore manifestJson parse failures and let validation handle missing manifest.
      }
    }
  }

  return normalized;
};

const validateManifestShape = (manifest: Record<string, unknown>): string | null => {
  if (typeof manifest.specVersion !== "string" || manifest.specVersion.trim().length === 0) {
    return "manifest.specVersion_missing";
  }
  if (typeof manifest.title !== "string" || manifest.title.trim().length === 0) {
    return "manifest.title_missing";
  }
  const capabilities = manifest.capabilities;
  if (!isRecord(capabilities)) {
    return "manifest.capabilities_missing";
  }
  if (typeof capabilities.network !== "boolean") {
    return "manifest.capabilities.network_missing";
  }
  if (typeof capabilities.storage !== "boolean") {
    return "manifest.capabilities.storage_missing";
  }
  if (typeof capabilities.dynamicCode !== "boolean") {
    return "manifest.capabilities.dynamicCode_missing";
  }
  return null;
};

export const analyzeArtifactGenerationOutput = (value: unknown): ArtifactOutputAnalysis => {
  let parsed: unknown;
  try {
    parsed = parseJsonFlexible(value);
  } catch (error) {
    return {
      validationErrors: [
        {
          kind: "parse_error",
          code: "invalid_json",
          path: "$",
          message: error instanceof Error ? error.message : "JSON parse failed",
          expected: "object",
          actual: typeof value,
        },
      ],
    };
  }

  if (!isRecord(parsed)) {
    return {
      parsedJson: parsed,
      validationErrors: [
        {
          kind: "schema_error",
          code: "result_not_object",
          path: "$",
          message: "Root JSON value must be an object.",
          expected: "object",
          actual: Array.isArray(parsed) ? "array" : typeof parsed,
        },
      ],
    };
  }

  const unwrapped = unwrapWrapperObject(parsed);
  const normalized = normalizeArtifactPayload(unwrapped);
  const errors: ArtifactValidationError[] = [];

  const artifactHtml = normalized.artifactHtml;
  const extractedArtifactHtml = typeof artifactHtml === "string" ? artifactHtml : undefined;
  if (typeof artifactHtml !== "string" || artifactHtml.trim().length === 0) {
    errors.push({
      kind: "schema_error",
      code: "artifactHtml_missing",
      path: "$.artifactHtml",
      message: "artifactHtml is required and must be a non-empty string.",
      expected: "non-empty string",
      actual: typeof artifactHtml,
    });
  }

  const manifest = normalized.manifest;
  if (!isRecord(manifest)) {
    errors.push({
      kind: "schema_error",
      code: "manifest_missing",
      path: "$.manifest",
      message: "manifest is required and must be an object.",
      expected: "object",
      actual: Array.isArray(manifest) ? "array" : typeof manifest,
    });
  } else {
    const manifestIssue = validateManifestShape(manifest);
    if (manifestIssue) {
      errors.push({
        kind: "schema_error",
        code: manifestIssue,
        path: "$.manifest",
        message: `Manifest validation failed: ${manifestIssue}`,
      });
    }
  }

  if (errors.length > 0) {
    return {
      parsedJson: parsed,
      extractedArtifactHtml,
      validationErrors: errors,
    };
  }

  const notes = typeof normalized.notes === "string" ? normalized.notes : undefined;
  return {
    parsedJson: parsed,
    extractedArtifactHtml,
    validationErrors: [],
    result: {
      artifactHtml: artifactHtml as string,
      manifest: manifest as Record<string, unknown>,
      ...(notes ? { notes } : {}),
    },
  };
};

export const parseArtifactGenerationOutput = (value: unknown): ParseResult => {
  const analyzed = analyzeArtifactGenerationOutput(value);
  if (analyzed.validationErrors.length > 0) {
    return { ok: false, reason: analyzed.validationErrors[0]?.code ?? "invalid_output" };
  }
  if (!analyzed.result) {
    return { ok: false, reason: "invalid_output" };
  }
  return {
    ok: true,
    value: analyzed.result,
  };
};
