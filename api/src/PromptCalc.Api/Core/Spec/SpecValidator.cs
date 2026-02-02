// Purpose: Provide placeholder validation for calculator specs.
// Persists: None.
// Security Risks: None.

namespace PromptCalc.Api.Core.Spec;

public static class SpecValidator
{
  public static (bool IsValid, string Message) Validate(CalcSpec spec)
  {
    return (false, "Spec validation is not implemented.");
  }
}
