/**
 * Purpose: Register Azure Functions entrypoints for the API host.
 * Persists: None.
 * Security Risks: None.
 */

import { validateOpenAIConfig } from "./generation/config";

validateOpenAIConfig();

import "./functions/health";
import "./functions/calcs";
