<!--
Purpose: Provide repository-specific guardrails for contributors and automation.
Persists: None.
Security Risks: None.
-->

# PromptCalc Guardrails

- Do not change `docs/SPEC.md` without an explicit issue.
- No model-generated code execution ever; spec-driven only.
- One renderer entry point (later): `CalculatorRenderer`.
- One compute entry point (later): `SafeEvaluator`.
- All PRs must keep CI green and add tests for new behavior.
