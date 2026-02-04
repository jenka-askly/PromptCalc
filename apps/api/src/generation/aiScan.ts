/**
 * Purpose: Normalize and format AI scan issue payloads for logging and client responses.
 * Persists: None.
 * Security Risks: Handles AI scan findings that may include snippets of generated HTML; keep truncation to avoid log sprawl.
 */

export type AiScanIssueSummary = {
  code?: string;
  severity?: string;
  message?: string;
  summary?: string;
  evidence?: string;
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
  const code = coerceIssueText(record.code ?? record.id);
  const severity = coerceIssueText(record.severity ?? record.level);
  const message = coerceIssueText(record.message ?? record.reason);
  const summary = coerceIssueText(record.summary ?? record.description);
  const evidence = coerceIssueText(record.evidence ?? record.snippet);

  if (code || severity || message || summary || evidence) {
    return {
      code,
      severity,
      message,
      summary,
      evidence,
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
  return parts.length > 0 ? parts.join(" | ") : "Unknown AI scan issue.";
};

export const stringifyAiScanIssueSummaries = (
  summaries: AiScanIssueSummary[],
  maxLength = 4096
): string => safeJsonStringify(summaries, maxLength) ?? "[]";
