<!--
Purpose: Maintain an append-only log of CODEX-driven merges for continuity.
Persists: None.
Security Risks: None.
-->

# CODEX Log

## 2026-02-05
**Summary**
- Fixed PromptScanDecision schema strictness (required + additionalProperties) to resolve OpenAI 400 OPENAI_BAD_REQUEST and unblock generation.
- Pinned OpenAI Responses model to gpt-4o-mini-2024-07-18 and added schema-focused 400 logging for prompt scan failures.
- Added schema validation test coverage and updated continuity status notes (traceId example: 942e901d...).

**Files Touched**
- apps/api/src/functions/calcs.ts
- apps/api/src/openai/client.ts
- apps/api/src/generation/config.ts
- apps/api/test/promptScanSchema.test.ts
- PROJECT_STATUS.md
- CODEX_LOG.md

**Commit/PR**
- <commit-hash-or-pr-link>

**Notes**
- TraceId example from bug report: 942e901d...

## 2026-02-05
**Summary**
- Removed legacy load gating refs, simplified retry flow, and made iframe load/ping idempotent per load to prevent regressions.
- Tightened handshake handling to ignore non-handshake messages and wrong tokens without flipping status to error.
- Updated viewer tests and continuity status notes for the cleanup.

**Commit/PR**
- <commit-hash-or-pr-link>

**Notes**
- Monitor watchdog timeouts to confirm they are the only error path during load failures.

## 2026-02-04
**Summary**
- Stabilized calculator viewer loads with loadId/token single-flight handling, fresh iframes per load, and watchdog/message correlation.
- Updated srcdoc bootstrap to echo loadId/token on READY and added dev logging for the viewer load pipeline.
- Added tests for message filtering and canceled load handling, plus continuity status updates.

**Commit/PR**
- <commit-hash-or-pr-link>

**Notes**
- Monitor watchdog timeouts to ensure only current loads time out and stale READY messages are ignored.

## 2026-02-04
**Summary**
- Updated generation instructions to avoid `<form>` tags and enforce button click handlers for calculators.
- Added deterministic artifact post-processing to rewrite form buttons, prevent submit navigation, and log form presence.
- Added unit coverage for form safety rewrites plus continuity status updates.

**Commit/PR**
- <commit-hash-or-pr-link>

**Notes**
- Revalidate CNC/tip calculators in sandboxed iframe to confirm no blocked form submission warnings.

## 2026-02-04
**Summary**
- Refined AI scan rubric to explicitly allow warning banners, DOM event wiring, and clarified dynamic code execution scope.
- Added deterministic post-processing guardrails plus tests to suppress known false positives while reporting disallowed evidence.
- Updated AI scan refusal messaging with targeted alternatives and logged ignored/allowed issue groups.

**Commit/PR**
- <commit-hash-or-pr-link>

**Notes**
- Confirm offline warning banner text no longer triggers credential-capture refusals.

## 2026-02-05
**Summary**
- Aligned AI artifact scan rubric with sandbox policy to allow inline JS, postMessage, and unsafe-inline CSP while still refusing true violations.
- Added AI scan policy handling tests and updated status/decision notes.

**Commit/PR**
- <commit-hash-or-pr-link>

**Notes**
- Verify CNC calculator prompts no longer fail AI_SCAN_FAILED when only inline JS/postMessage/unsafe-inline are present.

## 2026-02-04
**Summary**
- Added continuity documentation (status, decisions, prompts, runbook, codex log).
- Linked continuity docs from the README.

**Commit/PR**
- <commit-hash-or-pr-link>

**Notes**
- Validate continuity docs after next merge and update PROJECT_STATUS.md + CODEX_LOG.md.

## 2026-02-04
**Summary**
- Expanded AI scan refusal logging to include issue summaries and returned readable refusal details to the UI.
- Added AI scan issue formatting test coverage and refreshed runbook/status notes for AI_SCAN_FAILED.

**Commit/PR**
- <commit-hash-or-pr-link>

**Notes**
- Verify AI scan issue summaries appear in `artifact.aiScan.failed` logs when generation is refused.

## 2026-02-05
**Summary**
- Added dev-only red-team prompt scan policy resolution (`enforce`/`warn`/`off`) with PROMPTCALC_REDKIT + PROMPTCALC_SCAN_OFF gating and runtime arming checks.
- Implemented scan warning/scan skipped structured responses, per-request proceed override flow, and metadata-only scan policy logging.
- Added web interstitial + red-team typed phrase controls (session-scoped arming) and post-proceed scan banners.
- Added scan-policy/pipeline unit tests for enforce/warn/off behavior and response contract updates.

**Files Touched**
- apps/api/src/functions/calcs.ts
- apps/api/src/functions/health.ts
- apps/api/src/generation/response.ts
- apps/api/src/generation/scanPolicy.ts
- apps/api/src/generation/scanOverrideFlow.ts
- apps/api/src/generation/pipeline.ts
- apps/api/test/responseContract.test.ts
- apps/api/test/redTeamPipeline.test.ts
- apps/api/test/scanPolicyConfig.test.ts
- apps/web/src/App.tsx
- apps/web/src/index.css
- PROJECT_STATUS.md
- CODEX_LOG.md

**How to run tests**
- `npm --workspace apps/api test`
- `npm --workspace apps/web run build`

## 2026-02-05 (America/Los_Angeles)
**Summary**
- Replaced the red-team typed arming phrase with a Yes/No control plus an explicit confirmation modal before arming.
- Kept safety behavior intact: dev-only gating, metadata-only logging, and per-request “Proceed anyway” interstitials for warn/off flows.
- Hardened server request handling to ignore crafted proceed overrides when red-team capability is unavailable; updated UI/API tests accordingly.

## 2026-02-05 (America/Los_Angeles)
- Added dev-only red-team artifact dumping gated by `PROMPTCALC_REDKIT=1` via `isRedTeamEnabled()`.
- Added `.promptcalc_artifacts/` local dump layout (`requests/`, `responses/`, `html/`, `logs/`) with runtime creation and gitignore coverage.
- Wired dump capture into `calcs/generate` scan + generation + error paths and logged dump file locations with `[redteam_dump]` lines.
- Added `.promptcalc_artifacts/index.log` append entries for quick per-trace retrieval.
- Files changed: `.gitignore`, `apps/api/src/generation/scanPolicy.ts`, `apps/api/src/generation/dumpRedTeamArtifacts.ts`, `apps/api/src/functions/calcs.ts`, `apps/api/types/node/index.d.ts`, `PROJECT_STATUS.md`, `CODEX_LOG.md`.
- Enable by running API with `PROMPTCALC_REDKIT=1`.

## 2026-02-05
**Summary**
- Introduced shared red-team debug profile utilities (`defaultProfile`, `normalizeProfile`, `profileId`) and wired client/server payload contracts.
- Replaced single red-team bypass control with a full “Dev red-team debug checks” panel and added a “Copy debug header” helper.
- Added env-gated effective profile handling in generation with per-step skip wiring and profile-aware trace metadata.
- Added full collateral bundle dumping under `.promptcalc_artifacts/<traceId>/` when `dumpCollateral` is enabled.

**Files Touched**
- shared/types/redteam.ts
- shared/types/index.ts
- apps/web/src/App.tsx
- apps/web/src/App.test.tsx
- apps/web/src/index.css
- apps/api/src/functions/calcs.ts
- apps/api/src/generation/dumpRedTeamArtifacts.ts
- apps/api/test/redTeamProfile.test.ts
- PROJECT_STATUS.md
- CODEX_LOG.md

**How to use toggles**
- Enable `PROMPTCALC_REDKIT=1`.
- In the web app, open “Dev red-team debug checks”, set scan mode/toggles, and optionally enable “Generate all collateral when generating”.
- Use “Copy debug header” to capture `traceId`, `profileId`, and compact effective profile JSON.

**Artifacts**
- Full bundle path: `.promptcalc_artifacts/<traceId>/`.
- Legacy stage dumps (when full collateral is off): `.promptcalc_artifacts/{requests,responses,html}/` and index log `.promptcalc_artifacts/index.log`.

## 2026-02-05 (America/Los_Angeles)
**Summary**
- Enforced single red-team env gate: `PROMPTCALC_REDKIT=1` now controls both UI visibility and server honor/ignore behavior for debug profile toggles.
- Added sessionStorage persistence for dev debug profile (`promptcalc.redteam.profile`) with normalization on restore and a Reset button to clear persisted values.
- Standardized full collateral dump paths under `.promptcalc_artifacts/<traceId>/` with deterministic filenames and surfaced `traceId` + `dumpDir`/`dumpPaths` in generation responses for UI display.
- Hardened client generate payload construction to plain JSON and fixed event-object leakage by avoiding direct handler argument forwarding.

**Files touched**
- apps/api/src/functions/calcs.ts
- apps/api/src/generation/scanPolicy.ts
- apps/api/src/generation/dumpRedTeamArtifacts.ts
- apps/api/test/scanPolicyConfig.test.ts
- apps/api/test/dumpRedTeamArtifacts.test.ts
- apps/api/test/generateProfileGate.test.ts
- apps/web/src/App.tsx
- apps/web/src/App.test.tsx
- PROJECT_STATUS.md
- CODEX_LOG.md

**How to use**
- Set `PROMPTCALC_REDKIT=1` for API runtime.
- Open web app and use "Dev red-team debug checks" toggles.
- Enable "Generate all collateral when generating" to dump artifacts.
- Use the UI result/error area to read `Trace ID` and `Dump folder` path, then inspect `.promptcalc_artifacts/<traceId>/`.

## 2026-02-05 (America/Los_Angeles)
**Summary**
- Audited workspace imports for `@promptcalc/types` and `shared/types/dist` usage; confirmed there were no default imports and no direct dist-path imports in tracked source files.
- Rebuilt `@promptcalc/types` so `shared/types/dist/*` stays aligned with named-export source entrypoint.
- Cleared Vite cache directories when present and re-ran verification scans for default import patterns.

**Files Touched**
- PROJECT_STATUS.md
- CODEX_LOG.md

**Commands Used**
- `rg "import\\s+[\\w$]+\\s+from\\s+['\\\"]@promptcalc/types['\\\"]" -n`
- `rg "shared/types/dist|/@fs/.+shared/types/dist|from\\s+['\\\"].*types/dist" -n`
- `rg "@promptcalc/types|types/dist" -n`
- `npm -w @promptcalc/types run build`
- `python - <<'PY' ...` (remove `node_modules/.vite` and `apps/web/node_modules/.vite` if present)
- `npm run dev` (failed in this environment because `concurrently` is not installed and npm registry access is blocked)
- `rg "import\\s+[\\w$]+\\s+from\\s+['\\\"]@promptcalc/types['\\\"]" -n`

## 2026-02-05 (America/Los_Angeles)
**Summary**
- Fixed `@promptcalc/types` entrypoint exports so web runtime imports resolve: `defaultProfile`, `normalizeProfile`, and `profileId` are now explicitly re-exported from `shared/types/index.ts` (with `RedTeamDebugProfile` as a type export).
- Rebuilt `shared/types` to refresh `dist/index.js` and `dist/index.d.ts` with runtime export bindings from the package entrypoint.
- Verified build output contains `defaultProfile` in `shared/types/dist/index.js`; dev-server runtime verification is blocked in this environment because required dev tools (`concurrently`, `vite`) are not installed and npm registry access is forbidden (403).

**Files changed**
- shared/types/index.ts
- shared/types/dist/index.js (rebuilt)
- shared/types/dist/index.d.ts (rebuilt)
- PROJECT_STATUS.md
- CODEX_LOG.md

**Commands used to verify**
- `npm --workspace shared/types run build`
- `npm run dev`

## 2026-02-05 (America/Los_Angeles)
**Summary**
- Updated `shared/types/tsconfig.json` to override workspace CommonJS defaults and emit ESM (`module: ES2022`, `moduleResolution: Bundler`) for Vite runtime compatibility.
- Rebuilt `@promptcalc/types`, regenerating `shared/types/dist/*` as ESM output with `export` statements.
- Cleared Vite cache directories when present.
- Dev server runtime verification is environment-blocked: `npm run dev` fails because `concurrently` is unavailable, and installing dependencies is blocked by npm registry 403.

**Files changed**
- shared/types/tsconfig.json
- shared/types/dist/index.js
- shared/types/dist/index.d.ts
- shared/types/dist/manifest.js
- shared/types/dist/redteam.js
- shared/types/dist/refusal.js
- shared/types/dist/tsconfig.tsbuildinfo
- PROJECT_STATUS.md
- CODEX_LOG.md

**Commands used**
- `npm --workspace shared/types run build`
- `python - <<'PY' ...` (remove `apps/web/node_modules/.vite` and `node_modules/.vite` if present)
- `npm run dev`
- `npm install`


## 2026-02-05 (America/Los_Angeles)
**Objective**
- Reduce vertical UI stacking and improve debugging workflow by moving to a workbench-style layout.

**Approach**
- Reorganized `App.tsx` into a fixed top bar, split left/right workbench panes, and a collapsed bottom history drawer while preserving existing fetch/API and red-team logic paths.
- Kept existing controls/components and moved them into new layout containers with collapsible sections and output tabs (Output, Logs/errors, Generated HTML in dev).
- Updated CSS layout primitives to isolate scrolling (left pane, right tab content, bottom drawer) and keep viewer primary.

**Files changed**
- apps/web/src/App.tsx
- apps/web/src/index.css
- apps/web/src/App.test.tsx
- PROJECT_STATUS.md
- CODEX_LOG.md

**Commands used to verify**
- `npm --workspace apps/web test` (fails in this environment: `vitest: not found`)
- `npm run dev` (fails in this environment: `concurrently: not found`)

**Known follow-ups**
- Add visual polish and responsive/mobile behavior after structural validation on a fully provisioned dev machine.

## 2026-02-06 (UTC)
**Objective**
- Fix generator/manifest schema mismatch for standard pocket calculator output and make red-team dumps diagnosable on schema/parse failures.

**Approach**
- Tightened generation schema + manifest validation to require full `capabilities` booleans (`network`, `storage`, `dynamicCode`) and updated generator system prompt with an explicit JSON skeleton and required-field directive.
- Added structured artifact output analysis (`parse_error`/`schema_error`) so validation paths produce explicit error records including codes and JSON paths.
- Wired generation failure handling to emit `SCHEMA_VALIDATION_FAILED`, keep trace/dump metadata, and in red-team mode include validator summary text.
- Enhanced error-path dumping so collateral mode writes extracted HTML plus validation diagnostics even when schema validation fails.

**Files changed**
- apps/api/src/functions/calcs.ts
- apps/api/src/generation/artifactOutput.ts
- apps/api/test/artifactGenerationParsing.test.ts
- apps/api/test/dumpRedTeamArtifacts.test.ts
- apps/web/src/App.tsx
- PROJECT_STATUS.md
- CODEX_LOG.md

**Commands run + outcomes**
- `npm -w apps/api test -- --runInBand` ❌ failed (`vitest: not found` in environment)
- `npm install` ❌ failed (`403 Forbidden` from npm registry in environment)

**Follow-ups**
- Re-run API test suite in a provisioned dev environment with dependencies installed.
- Execute live generate call for “Standard pocket calculator” and red-team failure drill with a deliberately broken manifest.

## 2026-02-05 (America/Los_Angeles)
**Objective**
- Prevent truncation-driven calculator generation failures and make JSON parse failures fully diagnosable in red-team artifact dumps.

**Approach**
- Increased generation output budget by raising default `OPENAI_MAX_TOKENS` fallback from 2500 to 7000 while keeping model pinning unchanged.
- Extended OpenAI parse-error metadata capture with parse message/stack and output prefix/suffix snippets; propagated this into generation error dumps.
- Classified generation parse failures as `MODEL_OUTPUT_JSON_INVALID` (API + UI handling), and added dedicated dump files `06_model_output_raw.txt` and `09_parse_error.json` in collateral mode.

**Files changed**
- apps/api/src/generation/config.ts
- apps/api/src/openai/client.ts
- apps/api/src/generation/dumpRedTeamArtifacts.ts
- apps/api/src/functions/calcs.ts
- apps/api/test/dumpRedTeamArtifacts.test.ts
- apps/web/src/App.tsx
- PROJECT_STATUS.md
- CODEX_LOG.md

**Commands run + outcomes**
- `npm -w apps/api test -- dumpRedTeamArtifacts.test.ts` ❌ failed (`vitest: not found` in environment)
- `npm -w apps/api test -- openaiClient.test.ts` ❌ failed (`vitest: not found` in environment)

**Follow-ups**
- Run end-to-end `/api/calcs/generate` with red-team `dumpCollateral=true` and a real OpenAI key to validate the standard pocket calculator path and forced truncation drill.
