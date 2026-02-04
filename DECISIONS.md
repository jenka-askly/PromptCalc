<!--
Purpose: Capture lightweight, date-stamped decisions that explain PromptCalc design constraints.
Persists: None.
Security Risks: None.
-->

# PromptCalc Decisions

## 2026-02-04
- Generated calculators must be offline and sandboxed.
- No network access or external dependencies in artifacts.
- Deterministic scanner bans `eval` / `Function` / `new Function` and must remain.
- Artifacts are contract/spec-driven; `spec/SPEC.md` is the source of truth.
- Plan: two execution modes (form vs expression via a safe evaluator) to cover both UI-first and standard calculator prompts.
