<!--
Purpose: Describe the PromptCalc experiment scaffold, local development steps, and stubbed behavior.
Persists: None.
Security Risks: None.
-->

# PromptCalc

PromptCalc is an experiment scaffold for turning prompts into constrained calculator UIs with a minimal web frontend and an Azure Functions (.NET isolated) backend.

## Prerequisites
- .NET 8 SDK
- Node.js 18+

## Run the API locally
```bash
dotnet restore
cd api

dotnet build -c Release
cd src/PromptCalc.Api
func start
```

## Run the web locally
```bash
cd web
npm install
npm run dev
```

## Notes
- Key features (OTP auth, OpenAI integration, blob storage, calculator rendering) are intentionally stubbed in this scaffold.
