<!--
Purpose: Describe the PromptCalc scaffold and point to the canonical specification.
Persists: None.
Security Risks: None.
-->

# PromptCalc

PromptCalc is a spec-driven prototype for turning prompts into constrained, offline calculator UIs. The canonical specification lives in [`spec/SPEC.md`](spec/SPEC.md) and is the single source of truth.

## Local development
- Use Node.js 20 and Azure Functions Core Tools v4 for the API.
- Install dependencies: `npm install`
- Start the web app and API together: `npm run dev`
- Three-terminal flow (Windows-friendly):
  1) `scripts\\azurite.cmd`
  2) `npm run dev`
  3) Open `http://localhost:5173`

## Persistence (local)
- PromptCalc uses Azure Table + Blob storage for calculator persistence.
- Local development defaults to Azurite via `UseDevelopmentStorage=true`.
- Copy `apps/api/local.settings.example.json` to `apps/api/local.settings.json` with:
  - `AzureWebJobsStorage=UseDevelopmentStorage=true`
  - `PROMPTCALC_STORAGE_CONNECTION=UseDevelopmentStorage=true`
  - `PROMPTCALC_TABLE_NAME=PromptCalcMeta`
  - `PROMPTCALC_CONTAINER=promptcalc`
  - `DEV_USER_ID=dev-user`
- To run Azurite locally:
  - Install Azurite (`npm install -g azurite`) or run it via Docker.
  - Start it before `npm run dev` if you want persistence.
  - If you see “API version not supported”, ensure `--skipApiVersionCheck` is used.
- Optional smoke test: `pwsh scripts/dev-smoke.ps1` (requires the API host running).

## Quick sanity check
- Open the web app in your browser.
- Click **Check health** to call `/api/health`.
- Confirm the response shows `ok`, `service`, `build`, and a `traceId` (also returned in the `x-trace-id` header).
