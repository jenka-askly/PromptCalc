<!--
Purpose: Outline the high-level system flow for PromptCalc.
Persists: None.
Security Risks: None.
-->

# Architecture

```
Web UI → Azure Functions → Blob Storage → OpenAI
```

The web frontend calls Azure Functions for generation and retrieval. Functions coordinate storage in blobs and, later, model calls.
