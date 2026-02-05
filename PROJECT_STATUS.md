<!--
Purpose: Provide a single source of truth status snapshot for PromptCalc and a bootstrap block for new chats.
Persists: None.
Security Risks: None.
-->

# PromptCalc Project Status

## New Chat Bootstrap
Copy/paste the block below into a new chat to resume work quickly.

```
Repo: https://github.com/jenka-askly/PromptCalc
Branch: main (or short-lived branch + PR)
Stage: Step 5 — End-to-end prototype validation
Focus: Offline, spec-driven calculator artifacts; two execution modes (form vs expression) to avoid eval/new Function while enabling a standard calculator experience.
Known Issues: WATCHDOG_TIMEOUT intermittency/load stability (mostly mitigated), DISALLOWED_PATTERN when models emit new Function, OpenAI Responses schema-format retries (text.format strictness) with json_object fallback.
Process: After every CODEX merge, update PROJECT_STATUS.md and append to CODEX_LOG.md.
```

## Current Stage
Step 5 — End-to-end prototype validation (per README).

## Current Known-Good Local Run Commands
- Install dependencies: `npm install`
- Start web + API: `npm run dev`
- Optional local storage emulator: `scripts\\azurite.cmd` (Windows) or Azurite via Docker
- Optional smoke test: `pwsh scripts/dev-smoke.ps1` (requires API host running)

## Current Behavior Summary
- PromptCalc generates offline calculator HTML artifacts based on the spec in `spec/SPEC.md`.
- Artifacts run in a sandboxed iframe, and policy scanning rejects disallowed patterns.
- The API supports generating calculators and managing versions for saved calculators.
- AI scan rubric + post-processing guardrails align with the sandbox model; offline warnings, DOM event wiring, inline JS, postMessage, and CSP unsafe-inline are allowed while true violations are refused.
- Generated artifacts now avoid `<form>` tags and include deterministic safeguards that prevent form submission in sandboxed iframes.

## Open Issues
- Intermittent WATCHDOG_TIMEOUT during artifact load under certain conditions (mostly mitigated; continue monitoring).
- Viewer load intermittency due to race; resolved by single-flight loadId + iframe key + message correlation.
- DISALLOWED_PATTERN refusals when model output includes `new Function` for a standard calculator.
- OpenAI Responses schema strictness (text.format) causes retries; currently falling back to `json_object`.

## How to debug viewer load pipeline
Look for the following dev logs in sequence:
- `CalculatorViewer load.start` (loadId, artifactHash, len)
- `CalculatorViewer srcdoc.assigned` (loadId, len)
- `CalculatorViewer iframe.load` (loadId)
- `CalculatorViewer ping.sent` (loadId)
- `CalculatorViewer message.recv` (loadId/token + accepted flag)
- `CalculatorViewer watchdog.timeout` (loadId)

## Next Tasks (Top 3)
1. Validate AI scan guardrails against real-world calculator prompts (confirm false positives stay suppressed).
2. Implement two execution modes (form vs expression) with a safe evaluator for standard calculator prompts.
3. Improve stability tests for iframe watchdog timing and load behavior.

## Non-Negotiable Invariants
- Calculators are offline and sandboxed; no network or external dependencies.
- Deterministic scanning must block `eval`, `Function`, `new Function`, and other banned constructs.
- `spec/SPEC.md` is the contract source of truth; all outputs must align.

## Process
- After every CODEX merge: update PROJECT_STATUS.md and append to CODEX_LOG.md.
