// Purpose: Provide structured logging helpers for the API.
// Persists: None.
// Security Risks: None.

using Microsoft.Extensions.Logging;

namespace PromptCalc.Api.Core.Observability;

public static class Logging
{
  public static void LogRequest(ILogger logger, string operation, string requestId)
  {
    logger.LogInformation("operation={Operation} requestId={RequestId} outcome=received", operation, requestId);
  }

  public static void LogStub(ILogger logger, string operation, string requestId)
  {
    logger.LogWarning("operation={Operation} requestId={RequestId} outcome=not_implemented", operation, requestId);
  }
}
