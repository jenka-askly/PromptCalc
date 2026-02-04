<!--
Purpose: Provide canonical regression prompts for PromptCalc generation flows.
Persists: None.
Security Risks: None.
-->

# PromptCalc Canonical Prompts

## How to use these prompts
Use these prompts for regression testing across iterations. Compare generated artifacts and manifests against `spec/SPEC.md`, and note whether the expected execution mode matches.

## Form-mode prompts
- Tip calculator: "Create a tip calculator with bill amount, tip percentage, and total, with clear labels and a reset button."
- CNC feed rate: "Build a CNC feed rate calculator with inputs for spindle RPM and chip load, outputting feed rate in IPM."
- Mortgage: "Create a mortgage calculator with loan amount, interest rate, term (years), and monthly payment output."

## Expression-mode prompts
- Simple standard calculator: "Build a simple standard calculator with buttons for digits, +, -, ×, ÷, clear, and equals."
  - Expected: failing until the safe evaluator mode is implemented (next milestone).
