/**
 * Purpose: Normalize and format AI scan issue payloads for logging and client responses.
 * Persists: None.
 * Security Risks: Handles AI scan findings that may include snippets of generated HTML; keep truncation to avoid log sprawl.
 */

export type AiScanIssueSummary = {
  category?: string;
  code?: string;
  severity?: string;
  message?: string;
  summary?: string;
  evidence?: string;
  allowed?: boolean;
};

const MAX_FIELD_LENGTH = 400;

const truncateText = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;

const coerceIssueText = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? truncateText(trimmed, MAX_FIELD_LENGTH) : undefined;
};

const safeJsonStringify = (value: unknown, maxLength: number): string | undefined => {
  try {
    const serialized = JSON.stringify(value);
    return truncateText(serialized, maxLength);
  } catch {
    return undefined;
  }
};

const normalizeIssueObject = (record: Record<string, unknown>): AiScanIssueSummary => {
  const category = coerceIssueText(record.category ?? record.type ?? record.kind);
  const code = coerceIssueText(record.code ?? record.id);
  const severity = coerceIssueText(record.severity ?? record.level);
  const message = coerceIssueText(record.message ?? record.reason);
  const summary = coerceIssueText(record.summary ?? record.description);
  const evidence = coerceIssueText(record.evidence ?? record.snippet);
  const allowed = typeof record.allowed === "boolean" ? record.allowed : undefined;

  if (category || code || severity || message || summary || evidence || allowed !== undefined) {
    return {
      category,
      code,
      severity,
      message,
      summary,
      evidence,
      allowed,
    };
  }

  const fallback = safeJsonStringify(record, MAX_FIELD_LENGTH);
  return fallback ? { message: fallback } : { message: "Unrecognized AI scan issue." };
};

export const summarizeAiScanIssues = (issues: unknown[]): AiScanIssueSummary[] =>
  issues.map((issue) => {
    if (typeof issue === "string") {
      return { message: truncateText(issue, MAX_FIELD_LENGTH) };
    }
    if (issue && typeof issue === "object") {
      return normalizeIssueObject(issue as Record<string, unknown>);
    }
    if (issue === null || issue === undefined) {
      return { message: "Unknown AI scan issue." };
    }
    return { message: truncateText(String(issue), MAX_FIELD_LENGTH) };
  });

export const formatAiScanIssueSummary = (summary: AiScanIssueSummary): string => {
  const parts: string[] = [];
  if (summary.category) {
    parts.push(`category=${summary.category}`);
  }
  if (summary.code) {
    parts.push(`code=${summary.code}`);
  }
  if (summary.severity) {
    parts.push(`severity=${summary.severity}`);
  }
  const message = summary.message ?? summary.summary;
  if (message) {
    parts.push(`message=${message}`);
  }
  if (summary.summary && summary.summary !== summary.message) {
    parts.push(`summary=${summary.summary}`);
  }
  if (summary.evidence) {
    parts.push(`evidence=${summary.evidence}`);
  }
  if (summary.allowed !== undefined) {
    parts.push(`allowed=${summary.allowed}`);
  }
  return parts.length > 0 ? parts.join(" | ") : "Unknown AI scan issue.";
};

export const stringifyAiScanIssueSummaries = (
  summaries: AiScanIssueSummary[],
  maxLength = 4096
): string => safeJsonStringify(summaries, maxLength) ?? "[]";

const normalizeCategory = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s-]+/g, "_");

export const DISALLOWED_AI_SCAN_CATEGORIES = new Set([
  "networking",
  "external_resource",
  "dynamic_code",
  "navigation",
  "credential_capture",
  "data_exfiltration",
]);

export const ALLOWED_AI_SCAN_CATEGORIES = new Set([
  "inline_script",
  "inline_event_handler",
  "unsafe_inline_csp",
  "postmessage",
]);

const detectCategoryFromText = (text: string): string | undefined => {
  const normalized = text.toLowerCase();
  if (/(fetch|xmlhttprequest|websocket|sendbeacon|eventsource)\b/.test(normalized)) {
    return "networking";
  }
  if (/(<script\s+src|<img\s+src|<link\s+href|@import|url\()/.test(normalized)) {
    return "external_resource";
  }
  if (/\beval\s*\(|\bnew function\b|\bfunction\s*\(/.test(normalized)) {
    return "dynamic_code";
  }
  if (/(window\.open|top\.location|parent\.location|target=_top)/.test(normalized)) {
    return "navigation";
  }
  if (/(password|credential|login|sign[-\s]?in)/.test(normalized)) {
    return "credential_capture";
  }
  if (/(exfil|encode|base64|leak|transmit)/.test(normalized)) {
    return "data_exfiltration";
  }
  if (/postmessage/.test(normalized)) {
    return "postmessage";
  }
  if (/(inline script|inline javascript)/.test(normalized)) {
    return "inline_script";
  }
  if (/inline event handler/.test(normalized)) {
    return "inline_event_handler";
  }
  if (/unsafe-inline/.test(normalized)) {
    return "unsafe_inline_csp";
  }
  return undefined;
};

type AiScanIssuePartition = {
  disallowed: unknown[];
  allowed: unknown[];
  uncategorized: unknown[];
};

export const partitionAiScanIssues = (issues: unknown[]): AiScanIssuePartition => {
  const disallowed: unknown[] = [];
  const allowed: unknown[] = [];
  const uncategorized: unknown[] = [];

  for (const issue of issues) {
    if (typeof issue === "string") {
      const category = detectCategoryFromText(issue);
      if (category && DISALLOWED_AI_SCAN_CATEGORIES.has(category)) {
        disallowed.push(issue);
      } else if (category && ALLOWED_AI_SCAN_CATEGORIES.has(category)) {
        allowed.push(issue);
      } else {
        uncategorized.push(issue);
      }
      continue;
    }

    if (issue && typeof issue === "object") {
      const record = issue as Record<string, unknown>;
      const rawCategory = coerceIssueText(record.category ?? record.type ?? record.kind);
      const category = rawCategory ? normalizeCategory(rawCategory) : undefined;
      const allowedFlag = typeof record.allowed === "boolean" ? record.allowed : undefined;

      if (category && DISALLOWED_AI_SCAN_CATEGORIES.has(category) && allowedFlag !== true) {
        disallowed.push(issue);
        continue;
      }
      if (allowedFlag === true || (category && ALLOWED_AI_SCAN_CATEGORIES.has(category))) {
        allowed.push(issue);
        continue;
      }
      uncategorized.push(issue);
      continue;
    }

    uncategorized.push(issue);
  }

  return { disallowed, allowed, uncategorized };
};
