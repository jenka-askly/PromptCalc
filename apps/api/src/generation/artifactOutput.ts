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
  return null;
};

export const parseArtifactGenerationOutput = (value: unknown): ParseResult => {
  let parsed: unknown;
  try {
    parsed = parseJsonFlexible(value);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  if (!isRecord(parsed)) {
    return { ok: false, reason: "result_not_object" };
  }

  const unwrapped = unwrapWrapperObject(parsed);
  const normalized = normalizeArtifactPayload(unwrapped);

  const artifactHtml = normalized.artifactHtml;
  if (typeof artifactHtml !== "string" || artifactHtml.trim().length === 0) {
    return { ok: false, reason: "artifactHtml_missing" };
  }

  const manifest = normalized.manifest;
  if (!isRecord(manifest)) {
    return { ok: false, reason: "manifest_missing" };
  }

  const manifestIssue = validateManifestShape(manifest);
  if (manifestIssue) {
    return { ok: false, reason: manifestIssue };
  }

  const notes = typeof normalized.notes === "string" ? normalized.notes : undefined;
  return {
    ok: true,
    value: {
      artifactHtml,
      manifest,
      ...(notes ? { notes } : {}),
    },
  };
};
