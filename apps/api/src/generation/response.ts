/**
 * Purpose: Define response helpers and types for calculator generation endpoints.
 * Persists: None.
 * Security Risks: Shapes refusal payloads returned to clients; avoid exposing secrets.
 */

import type { RefusalCode } from "@promptcalc/types";

import type { AiScanIssueSummary } from "./aiScan";

export type RefusalReason = {
  code: RefusalCode | string;
  message: string;
  safeAlternative: string;
  matchIndex?: number;
  contextSnippet?: string;
  details?: AiScanIssueSummary[];
};

export type GenerateOkResponse = {
  kind: "ok";
  status: "ok";
  calcId: string;
  versionId: string;
  manifest: Record<string, unknown>;
  artifactHtml: string;
  overrideUsed: boolean;
  scanOutcome: "allow" | "deny" | "skipped";
};

export type GenerateScanBlockResponse = {
  kind: "scan_block";
  status: "refused";
  refusalReason: RefusalReason;
};

export type GenerateScanWarnResponse = {
  kind: "scan_warn";
  status: "scan_warn";
  requiresUserProceed: true;
  scanDecision: {
    refusalCode: string | null;
    categories: string[];
    reason: string;
  };
};

export type GenerateScanSkippedResponse = {
  kind: "scan_skipped";
  status: "scan_skipped";
  requiresUserProceed: true;
};

export type GenerateErrorResponse = {
  kind: "error";
  status: "error";
  errorCode: string;
  message: string;
};

export type GenerateResponse =
  | GenerateOkResponse
  | GenerateScanBlockResponse
  | GenerateScanWarnResponse
  | GenerateScanSkippedResponse
  | GenerateErrorResponse;

export const buildGenerateOkResponse = (
  calcId: string,
  versionId: string,
  manifest: Record<string, unknown>,
  artifactHtml: string,
  scanOutcome: "allow" | "deny" | "skipped",
  overrideUsed: boolean
): GenerateOkResponse => ({
  kind: "ok",
  status: "ok",
  calcId,
  versionId,
  manifest,
  artifactHtml,
  scanOutcome,
  overrideUsed,
});

export const buildGenerateScanBlockResponse = (
  reason: RefusalReason
): GenerateScanBlockResponse => ({
  kind: "scan_block",
  status: "refused",
  refusalReason: reason,
});

export const buildGenerateScanWarnResponse = (params: {
  refusalCode: string | null;
  categories: string[];
  reason: string;
}): GenerateScanWarnResponse => ({
  kind: "scan_warn",
  status: "scan_warn",
  requiresUserProceed: true,
  scanDecision: {
    refusalCode: params.refusalCode,
    categories: params.categories,
    reason: params.reason,
  },
});

export const buildGenerateScanSkippedResponse = (): GenerateScanSkippedResponse => ({
  kind: "scan_skipped",
  status: "scan_skipped",
  requiresUserProceed: true,
});

export const buildGenerateErrorResponse = (
  errorCode: string,
  message: string
): GenerateErrorResponse => ({
  kind: "error",
  status: "error",
  errorCode,
  message,
});
