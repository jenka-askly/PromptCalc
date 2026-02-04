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
  - `OPENAI_API_KEY=...`
  - `OPENAI_MODEL=gpt-4.1`
  - `OPENAI_BASE_URL=https://api.openai.com/v1`
  - `GENERATION_ENABLED=true`
  - `MAX_ARTIFACT_BYTES=200000`
  - `OPENAI_TIMEOUT_MS=25000`
  - `OPENAI_MAX_TOKENS=2500`
- To run Azurite locally:
  - Install Azurite (`npm install -g azurite`) or run it via Docker.
  - Start it before `npm run dev` if you want persistence.
  - If you see “API version not supported”, ensure `--skipApiVersionCheck` is used.
- Optional smoke test: `pwsh scripts/dev-smoke.ps1` (requires the API host running).

## Authentication (Easy Auth)
- Production runs with Azure App Service Authentication / Static Web Apps Easy Auth using Microsoft identity.
- Enable Easy Auth in Azure (high-level):
  - Turn on App Service Authentication (or SWA auth) with Microsoft as the identity provider.
  - Require authentication for API endpoints; `/api/health` remains anonymous for diagnostics.
  - Configure redirect URIs and allowed tenant(s) in Entra ID.
- Local dev options:
  - Set `DEV_USER_ID` to bypass auth for local testing.
  - For Easy Auth header simulation, set `PROMPTCALC_ACCEPT_FAKE_EASYAUTH=true` and send
    `X-PROMPTCALC-FAKE-PRINCIPAL-ID` to the API.
- User IDs are stored as stable, hashed identifiers:
  - `userId = "u_" + base64url(sha256(principalId))` to avoid persisting raw principal IDs.

## Required app settings (API)
- `PROMPTCALC_STORAGE_CONNECTION`
- `PROMPTCALC_TABLE_NAME`
- `PROMPTCALC_CONTAINER`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL`
- `GENERATION_ENABLED`
- `MAX_ARTIFACT_BYTES`
- `OPENAI_TIMEOUT_MS`
- `OPENAI_MAX_TOKENS`
- Do not set `DEV_USER_ID` in production.

## Quick sanity check
- Open the web app in your browser.
- Click **Check health** to call `/api/health`.
- Confirm the response shows `ok`, `service`, `build`, and a `traceId` (also returned in the `x-trace-id` header).
