/**
 * Purpose: Define shared red-team debug profile types and normalization utilities used by client/server generation flows.
 * Persists: None.
 * Security Risks: Controls debug and safety toggle behavior; profile IDs must remain non-secret and deterministic.
 */

export type ScanMode = "enforce" | "warn" | "off";

export type RedTeamDebugProfile = {
  enabled: boolean;
  scanMode: ScanMode;
  strictInstructions: boolean;
  promptVerification: boolean;
  schemaEnforcement: boolean;
  htmlValidation: boolean;
  postProcess: boolean;
  dumpCollateral: boolean;
};

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const normalizeScanMode = (value: unknown): ScanMode => {
  if (value === "warn" || value === "off" || value === "enforce") {
    return value;
  }
  return "enforce";
};

export const defaultProfile = (): RedTeamDebugProfile => ({
  enabled: false,
  scanMode: "enforce",
  strictInstructions: true,
  promptVerification: true,
  schemaEnforcement: true,
  htmlValidation: true,
  postProcess: true,
  dumpCollateral: false,
});

export const normalizeProfile = (input: unknown): RedTeamDebugProfile => {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const defaults = defaultProfile();
  return {
    enabled: toBoolean(raw.enabled, defaults.enabled),
    scanMode: normalizeScanMode(raw.scanMode),
    strictInstructions: toBoolean(raw.strictInstructions, defaults.strictInstructions),
    promptVerification: toBoolean(raw.promptVerification, defaults.promptVerification),
    schemaEnforcement: toBoolean(raw.schemaEnforcement, defaults.schemaEnforcement),
    htmlValidation: toBoolean(raw.htmlValidation, defaults.htmlValidation),
    postProcess: toBoolean(raw.postProcess, defaults.postProcess),
    dumpCollateral: toBoolean(raw.dumpCollateral, defaults.dumpCollateral),
  };
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const profileId = (profile: RedTeamDebugProfile): string => {
  const source = stableStringify(profile);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
};
