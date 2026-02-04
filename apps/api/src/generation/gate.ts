/**
 * Purpose: Gate OpenAI generation based on feature flags and configuration presence.
 * Persists: None.
 * Security Risks: Evaluates availability of OpenAI API keys; do not log secrets.
 */

import type { GenerationConfig } from "./config";
import type { RefusalReason } from "./response";

export const resolveGenerationGate = (config: GenerationConfig): RefusalReason | null => {
  if (!config.enabled) {
    return {
      code: "GENERATION_DISABLED",
      message: "Generation is currently disabled.",
      safeAlternative: "Use a saved calculator or try again later.",
    };
  }

  if (!config.apiKey) {
    return {
      code: "MISSING_OPENAI_KEY",
      message: "OpenAI generation is not configured.",
      safeAlternative: "Save an existing calculator or configure an OpenAI key.",
    };
  }

  return null;
};
