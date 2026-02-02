<!--
Purpose: Document baseline security expectations for PromptCalc.
Persists: None.
Security Risks: Handling API keys and untrusted input.
-->

# Security

- Keys live only in Azure Functions configuration.
- Never ship keys to the client.
- Avoid `eval` or dynamic execution.
- Sanitize and validate all text inputs.
