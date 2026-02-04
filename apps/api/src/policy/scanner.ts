/**
 * Purpose: Deterministically scan generated calculator artifacts for forbidden patterns and required safety markers.
 * Persists: None.
 * Security Risks: Processes untrusted HTML content to enforce sandbox policies.
 */

import type { PromptCalcPolicy } from "./policy";

export type ScanResult =
  | { ok: true }
  | {
      ok: false;
      code: string;
      message: string;
      ruleId?: string;
      matchIndex?: number;
      contextSnippet?: string;
    };

const normalize = (value: string): string => value.toLowerCase();

const isCaseSensitivePattern = (pattern: string): boolean => pattern.includes("Function(");

const findPatternIndex = (
  artifactHtml: string,
  normalizedHtml: string,
  pattern: string
): number => {
  if (isCaseSensitivePattern(pattern)) {
    return artifactHtml.indexOf(pattern);
  }
  return normalizedHtml.indexOf(normalize(pattern));
};

const makeSnippet = (text: string, index: number, patternLength: number, radius = 80): string => {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + patternLength + radius);
  return text.slice(start, end);
};

const hasRequiredCspMarkers = (normalizedHtml: string, directives: string[]): boolean => {
  const markers = ["content-security-policy", ...directives];
  return markers.every((marker) => normalizedHtml.includes(normalize(marker)));
};

export const scanArtifactHtml = (
  artifactHtml: string,
  policy: PromptCalcPolicy
): ScanResult => {
  const normalizedHtml = normalize(artifactHtml);

  if (!hasRequiredCspMarkers(normalizedHtml, policy.requiredCspDirectives)) {
    return {
      ok: false,
      code: "MISSING_CSP",
      message: "Artifact is missing the required CSP directives.",
    };
  }

  if (!normalizedHtml.includes(normalize(policy.requiredBannerText))) {
    return {
      ok: false,
      code: "MISSING_CSP",
      message: "Artifact is missing the required safety banner.",
    };
  }

  for (const rule of policy.bannedPatterns) {
    const patterns = rule.patterns ?? [];
    for (const pattern of patterns) {
      const matchIndex = findPatternIndex(artifactHtml, normalizedHtml, pattern);
      if (matchIndex >= 0) {
        return {
          ok: false,
          code: rule.id,
          ruleId: pattern,
          message: `Artifact contains banned pattern: ${pattern}`,
          matchIndex,
          contextSnippet: makeSnippet(artifactHtml, matchIndex, pattern.length),
        };
      }
    }
  }

  for (const rule of policy.bannedTags) {
    const tags = rule.tags ?? [];
    for (const tag of tags) {
      const pattern = `<${tag}`;
      const matchIndex = findPatternIndex(artifactHtml, normalizedHtml, pattern);
      if (matchIndex >= 0) {
        return {
          ok: false,
          code: rule.id,
          ruleId: tag,
          message: `Artifact contains banned tag: ${tag}`,
          matchIndex,
          contextSnippet: makeSnippet(artifactHtml, matchIndex, pattern.length),
        };
      }
    }
  }

  return { ok: true };
};
