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
- Web UI shell refactored to a desktop-first workbench layout: fixed top bar, left control stack (generate + debug + collapsible metadata), right output area (viewer/log/html tabs), and a collapsed-by-default bottom drawer for My calculators + API status.
- PromptCalc generates offline calculator HTML artifacts based on the spec in `spec/SPEC.md`.
- Artifacts run in a sandboxed iframe, and policy scanning rejects disallowed patterns.
- The API supports generating calculators and managing versions for saved calculators.
- AI scan rubric + post-processing guardrails align with the sandbox model; offline warnings, DOM event wiring, inline JS, postMessage, and CSP unsafe-inline are allowed while true violations are refused.
- Generated artifacts now avoid `<form>` tags and include deterministic safeguards that prevent form submission in sandboxed iframes.
- Viewer load stability: removed fragile gating refs; ignore non-handshake messages; idempotent ping; optional token strictness.
- Fixed PromptScanDecision schema (required+additionalProperties) causing OpenAI 400 OPENAI_BAD_REQUEST; generation unblocked.
- Added dev-only red-team scan override controls: default enforce remains unchanged, PROMPTCALC_REDKIT=1 enables warn/off capability, Yes/No arming with confirmation modal controls session-scoped override state, and CSP/sandbox/offline constraints remain unchanged.
- Resolved workspace type-import compatibility issue by ensuring consumers use named imports from `@promptcalc/types` entrypoint only (no default import / dist-path imports), then rebuilding shared types output.
- Fixed `@promptcalc/types` entrypoint runtime exports for red-team helpers by explicitly re-exporting `defaultProfile`, `normalizeProfile`, and `profileId` from `shared/types/index.ts`, unblocking Vite browser imports from `shared/types/dist/index.js`.

- Generator system instructions now include an explicit manifest skeleton with full required capabilities booleans (`network`, `storage`, `dynamicCode`) and a strict requirement that all schema-required fields must be present.
- Red-team collateral dumping now captures validation diagnostics for generation/schema failures: raw model output, parsed JSON (when available), extracted HTML, and structured validation errors.
- Schema-validation generation failures now return `SCHEMA_VALIDATION_FAILED` with trace/dump metadata; non-red-team responses remain sanitized while red-team includes validator summary text.
- CSP post-processing now normalizes only trailing punctuation/whitespace in the CSP meta content (`object-src 'none'.` -> `object-src 'none'`) before policy validation and persistence.
- Artifact generation JSON parsing now uses first-valid-object selection for duplicated model outputs, preferring the first balanced JSON object that matches expected artifact shape.
- Red-team validation failure dumps now always include full validation details plus rejected normalized candidate HTML, and parse failures write both compatibility (`06_*`/`09_*`) and canonical (`model_output_raw.txt`/`parse_error.json`) files.
- OpenAI request timeout is configurable via `PROMPTCALC_OPENAI_TIMEOUT_MS` (default 60s, or 180s when `PROMPTCALC_REDKIT=1`), and request aborts are classified as `OPENAI_REQUEST_ABORTED` with red-team dumps capturing timeout/elapsed/model/token diagnostics.
- Artifact generation parsing now selects the first valid JSON payload from ordered OpenAI `output_text` messages (filtering for `artifactHtml` + `manifest`), reducing truncation/duplication issues while keeping prompt logs red-team only.
- Red-team collateral bundles now always include `model_output_raw.txt` (concatenated output_texts) and normalized `extracted_candidate.html` alongside parse/validation error JSON for failed generations.
- Build/version stamping now accompanies generate responses and server logs, and red-team Debug UI + dumps include trace-linked build metadata (see `.promptcalc_artifacts/<traceId>/version.json`).
- API TypeScript builds now explicitly rely on Node typings (`@types/node` + `types: ["node"]`) for diagnostics/build metadata helpers like `buildStamp`.
- Diagnostics build stamp helper now uses explicit `node:` imports to avoid Azure Functions + Node type collisions during build.
- API TypeScript config now uses `module: Node16` + `moduleResolution: Node16` so Azure Functions builds resolve `node:` specifier imports.
## Open Issues

- Manifest/schema mismatches now report structured validation errors and dump collateral in red-team mode for diagnosis.
- Intermittent WATCHDOG_TIMEOUT during artifact load under certain conditions (mostly mitigated; continue monitoring).
- Viewer load intermittency due to race; resolved by single-flight loadId + iframe key + message correlation.
- DISALLOWED_PATTERN refusals when model output includes `new Function` for a standard calculator.
- OpenAI Responses schema strictness (text.format) causes retries; currently falling back to `json_object`.
- INVALID_MODEL_OUTPUT caused by schema invalidation + fragile fallback parsing.

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

## RED TEAM DEBUG DUMPS (DEV ONLY)
- When `PROMPTCALC_REDKIT=1`, PromptCalc now writes raw debugging artifacts (including prompt text, scan/generation requests, raw model responses, generated HTML, and error stacks) to local `.promptcalc_artifacts/` for fast investigation.
- Output paths are logged as `[redteam_dump] traceId=<id> files=<path1>;<path2>;...` and indexed in `.promptcalc_artifacts/index.log`.
- Never ship this behavior; remove or disable red-team dump output before deployment.
- Abort errors now include timeout/elapsed/model/token diagnostics in red-team `error.json` dumps when `dumpCollateral` is enabled.
- Full collateral bundles now also include `version.json` with the build stamp for trace correlation.

## Red-team Debug Profile + collateral dump
- Added a shared `RedTeamDebugProfile` with normalization/defaults and stable `profileId` hashing for request/response tracing.
- Dev red-team panel now supports scan mode and per-step toggles (`strictInstructions`, `promptVerification`, `schemaEnforcement`, `htmlValidation`, `postProcess`) plus `dumpCollateral`.
- Generate requests now carry `redTeamProfile`; server computes env-gated `effectiveProfile` and includes `traceId`, `profileId`, `effectiveProfile`, and skipped-step metadata in responses/logs.
- When `dumpCollateral` is enabled in red-team mode, server writes a full per-trace bundle under `.promptcalc_artifacts/<traceId>/` for permutation debugging.

## 2026-02-05 Supplemental Red-Team Lockdown
- Single env gate is now `PROMPTCALC_REDKIT` only. No additional env flags are honored for scan/dump behavior.
- When `PROMPTCALC_REDKIT!=1`, server forces safe effective profile defaults (`scanMode=enforce`, strict/prompt verification/schema/html/post-process on, dumping off) and debug panel remains hidden.
- Dev debug toggles now persist in-tab via `sessionStorage` and include a Reset action to clear persisted profile state.
- Full collateral dumps now use deterministic per-trace folders at `.promptcalc_artifacts/<traceId>/` and UI surfaces `Trace ID` plus `Dump folder` directly in result/error status.
- Updated `shared/types` TypeScript build target to ESM (`module: ES2022`, `moduleResolution: Bundler`) so Vite can consume named exports from `@promptcalc/types` without CommonJS interop issues.


## 2026-02-05 Generation Parse-Diagnostics Update
- Increased default generation token budget for calculator generation to reduce truncation risk (`OPENAI_MAX_TOKENS` default now 8000).
- Generation JSON parse failures are now classified as `MODEL_OUTPUT_JSON_INVALID` and include trace/dump metadata in API responses.
- In red-team + `dumpCollateral` mode, parse failures now always dump full raw model text (`06_model_output_raw.txt`) and parse exception details (`09_parse_error.json`) alongside existing `gen_response_raw.json`, `validation.json`, and `profile.json`.

## Update (2026-02-06 UTC)
- Added narrow CSP meta normalization in post-processing to trim only trailing `.` from `Content-Security-Policy` meta `content` before HTML validation/scanning and persistence.
- Hardened generator instructions with an exact CSP meta tag line and explicit rule forbidding trailing punctuation/extra characters in CSP content.
- Improved red-team collateral diagnostics: collateral bundles now include `extracted_candidate.html` and `validation_error.json` with validator/error details when validation data is present.
- Added HTML-validation error handling in generation flow to dump validator metadata plus candidate HTML instead of failing silently.
