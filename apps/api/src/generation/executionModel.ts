/**
 * Purpose: Select the execution model for artifact generation based on prompt heuristics.
 * Persists: None.
 * Security Risks: Influences how untrusted artifacts are generated; keep selection deterministic.
 */

export type ExecutionModel = "form" | "expression";

const FORCE_FORM_KEYWORDS = ["cnc", "mortgage", "beam"];
const EXPRESSION_KEYWORDS = [
  "standard calculator",
  "expression",
  "evaluate",
  "formula input",
  "type an expression",
];

export const selectExecutionModelFromPrompt = (prompt: string): ExecutionModel => {
  const normalized = prompt.toLowerCase();

  if (FORCE_FORM_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "form";
  }

  if (EXPRESSION_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "expression";
  }

  return "form";
};

export const getExecutionModelRuleText = (): string =>
  [
    `Force "form" when prompt includes: ${FORCE_FORM_KEYWORDS.join(", ")}.`,
    `Choose "expression" when prompt includes: ${EXPRESSION_KEYWORDS.join(", ")}.`,
    'Otherwise default to "form".',
  ].join(" ");
