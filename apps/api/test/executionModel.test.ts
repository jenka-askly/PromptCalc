/**
 * Purpose: Verify execution model selection heuristics and artifact safety expectations.
 * Persists: None.
 * Security Risks: Ensures test artifacts comply with deterministic scanner rules.
 */

import { describe, expect, it } from "vitest";

import { selectExecutionModelFromPrompt } from "../src/generation/executionModel";
import { getPromptCalcPolicy } from "../src/policy/policy";
import { scanArtifactHtml } from "../src/policy/scanner";

const CSP_CONTENT =
  "default-src 'none'; connect-src 'none'; img-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'";

const buildArtifactHtml = ({ includeEvaluator }: { includeEvaluator: boolean }): string => `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}">
  </head>
  <body>
    <div>Generated calculator (offline). Do not enter passwords.</div>
    <script id="promptcalc-ready">window.parent.postMessage({type:"ready"},"*");</script>
    <script>
      ${includeEvaluator ? "function computeExpr(input){return Number(input)||0;}" : ""}
    </script>
  </body>
</html>`;

describe("execution model selection", () => {
  it("selects expression for standard calculator prompts", async () => {
    const prompt = "Simple standard calculator";
    expect(selectExecutionModelFromPrompt(prompt)).toBe("expression");

    const html = buildArtifactHtml({ includeEvaluator: true });
    const policy = await getPromptCalcPolicy();
    const scanResult = scanArtifactHtml(html, policy);

    expect(scanResult.ok).toBe(true);
    expect(html.includes("eval")).toBe(false);
    expect(html.includes("new Function")).toBe(false);
    expect(html.includes("Function(")).toBe(false);
  });

  it("selects form for CNC prompts and skips evaluator markers", async () => {
    const prompt = "CNC feed rate calculator: RPM, flutes, chip load -> feed";
    expect(selectExecutionModelFromPrompt(prompt)).toBe("form");

    const html = buildArtifactHtml({ includeEvaluator: false });
    const policy = await getPromptCalcPolicy();
    const scanResult = scanArtifactHtml(html, policy);

    expect(scanResult.ok).toBe(true);
    expect(html.includes("computeExpr(")).toBe(false);
  });
});
