// Purpose: Provide correlation helpers for request IDs.
// Persists: None.
// Security Risks: None.

using Microsoft.Azure.Functions.Worker.Http;

namespace PromptCalc.Api.Core.Observability;

public static class Correlation
{
  private const string HeaderName = "x-request-id";

  public static string GetRequestId(HttpRequestData request)
  {
    if (request.Headers.TryGetValues(HeaderName, out var values))
    {
      var value = values.FirstOrDefault();
      if (!string.IsNullOrWhiteSpace(value))
      {
        return value;
      }
    }

    return Guid.NewGuid().ToString("n");
  }
}
