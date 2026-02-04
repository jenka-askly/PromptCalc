/**
 * Purpose: Resolve OpenAI generation configuration and feature flags for PromptCalc.
 * Persists: None.
 * Security Risks: Reads OpenAI API keys and feature flags from environment variables.
 */

import { getMaxArtifactBytes } from "../storage";

export type GenerationConfig = {
  enabled: boolean;
  apiKey?: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxTokens: number;
  maxArtifactBytes: number;
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

export const getGenerationConfig = async (): Promise<GenerationConfig> => ({
  enabled: parseBoolean(process.env.GENERATION_ENABLED, true),
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || "gpt-4.1",
  baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  timeoutMs: parseNumber(process.env.OPENAI_TIMEOUT_MS, 25_000),
  maxTokens: parseNumber(process.env.OPENAI_MAX_TOKENS, 2_500),
  maxArtifactBytes: await getMaxArtifactBytes(),
});
