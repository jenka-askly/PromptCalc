<!--
Purpose: Describe the allowed and disallowed behavior for PromptCalc V1 calculators and user-facing warnings.
Persists: None.
Security Risks: Enumerates refusal codes for unsafe or disallowed artifacts.
-->

# PromptCalc V1 Allowed Behavior

## What calculators can do
- Perform offline math and transformations using user-provided inputs.
- Render a local UI with input fields, labels, buttons, and output values.
- Display safety notes and limitations inline in the UI.

## What calculators cannot do
- Access the network or external dependencies.
- Prompt for credentials, secrets, or personal data beyond the calculator inputs.
- Scrape, crawl, or embed external content.
- Open popups, navigate, or change the top-level location.
- Use timers, loops, or other constructs that create unbounded work.

## Refusal codes
- `DISALLOWED_NETWORK_ACCESS`
- `DISALLOWED_DYNAMIC_CODE`
- `DISALLOWED_RESOURCE_CONSUMPTION`
- `DISALLOWED_NAVIGATION`
- `DISALLOWED_EXTERNAL_DEPENDENCIES`
- `DISALLOWED_CREDENTIAL_PROMPT`

## In-calculator disclaimer
“Generated calculator (offline). Do not enter passwords.”
