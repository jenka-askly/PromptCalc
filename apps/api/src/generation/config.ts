/**
 * Purpose: Resolve OpenAI generation configuration and feature flags for PromptCalc.
 * Persists: None.
 * Security Risks: Reads OpenAI API keys and feature flags from environment variables.
 */

import { logEvent } from "@promptcalc/logger";

import { getMaxArtifactBytes } from "../storage";

export type GenerationConfig = {
  enabled: boolean;
  apiKey?: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxTokens: number;
  maxArtifactBytes: number;
  aiScanFailClosed: boolean;
};

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === "true";
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveOpenAIModel = (): string => (process.env.OPENAI_MODEL ?? "").trim();

const resolveOpenAIBaseUrl = (): string =>
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

export const validateOpenAIConfig = (): void => {
  const model = resolveOpenAIModel();
  if (!model) {
    throw new Error("OPENAI_MODEL must be set for PromptCalc generation.");
  }
  logEvent({
    level: "info",
    op: "openai.config",
    event: "openai.config",
    model,
    baseUrl: resolveOpenAIBaseUrl(),
  });
};

export const getGenerationConfig = async (): Promise<GenerationConfig> => ({
  enabled: parseBoolean(process.env.GENERATION_ENABLED, true),
  apiKey: process.env.OPENAI_API_KEY,
  model: resolveOpenAIModel(),
  baseUrl: resolveOpenAIBaseUrl(),
  timeoutMs: parseNumber(process.env.OPENAI_TIMEOUT_MS, 25_000),
  maxTokens: parseNumber(process.env.OPENAI_MAX_TOKENS, 2_500),
  maxArtifactBytes: await getMaxArtifactBytes(),
  aiScanFailClosed: parseBoolean(process.env.AI_SCAN_FAIL_CLOSED, false),
});
