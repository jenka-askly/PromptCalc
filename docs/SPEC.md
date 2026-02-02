<!--
Purpose: Define the planned constrained JSON spec and allowed kinds.
Persists: None.
Security Risks: None.
-->

# Spec

PromptCalc plans a restricted JSON spec that describes calculator layout and intent. The spec will include a top-level `kind` with allowed values:

- `keypad`
- `form`
- `converter`

Additional fields (labels, inputs, validation rules) will be added as the spec matures.
