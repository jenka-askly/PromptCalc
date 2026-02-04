/**
 * Purpose: Define response helpers and types for calculator generation endpoints.
 * Persists: None.
 * Security Risks: Shapes refusal payloads returned to clients; avoid exposing secrets.
 */

import type { RefusalCode } from "@promptcalc/types";

export type RefusalReason = {
  code: RefusalCode | string;
  message: string;
  safeAlternative: string;
  matchIndex?: number;
  contextSnippet?: string;
};

export type GenerateOkResponse = {
  status: "ok";
  calcId: string;
  versionId: string;
  manifest: Record<string, unknown>;
  artifactHtml: string;
};

export type GenerateRefusedResponse = {
  status: "refused";
  refusalReason: RefusalReason;
};

export type GenerateResponse = GenerateOkResponse | GenerateRefusedResponse;

export const buildGenerateOkResponse = (
  calcId: string,
  versionId: string,
  manifest: Record<string, unknown>,
  artifactHtml: string
): GenerateOkResponse => ({
  status: "ok",
  calcId,
  versionId,
  manifest,
  artifactHtml,
});

export const buildGenerateRefusedResponse = (reason: RefusalReason): GenerateRefusedResponse => ({
  status: "refused",
  refusalReason: reason,
});
