/**
 * Purpose: Define the minimal PromptCalc manifest shape from the schema.
 * Persists: None.
 * Security Risks: None.
 */

export type ExecutionModel = "expression" | "eventHandlers" | "customJS";

export interface PromptCalcManifest {
  specVersion: "1.0";
  title: string;
  description: string;
  executionModel: ExecutionModel;
  capabilities: string[];
  inputs: string[];
  outputs: string[];
  limitations: string[];
  safetyNotes: string[];
  hash: string;
}
