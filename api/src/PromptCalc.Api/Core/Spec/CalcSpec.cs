// Purpose: Define POCO models for calculator specification payloads.
// Persists: None.
// Security Risks: Models may carry user-provided text.

namespace PromptCalc.Api.Core.Spec;

public sealed class CalcSpec
{
  public string Kind { get; init; } = string.Empty;
  public string Title { get; init; } = string.Empty;
  public IReadOnlyList<CalcField> Fields { get; init; } = Array.Empty<CalcField>();
}

public sealed class CalcField
{
  public string Id { get; init; } = string.Empty;
  public string Label { get; init; } = string.Empty;
  public string Type { get; init; } = string.Empty;
}
