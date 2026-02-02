// Purpose: Provide a health check endpoint for the API.
// Persists: None.
// Security Risks: None.

using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using PromptCalc.Api.Core.Observability;

namespace PromptCalc.Api.Functions;

public sealed class HealthFunction
{
  private readonly ILogger<HealthFunction> _logger;

  public HealthFunction(ILogger<HealthFunction> logger)
  {
    _logger = logger;
  }

  [Function("Health")]
  public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "health")] HttpRequestData req)
  {
    var requestId = Correlation.GetRequestId(req);
    Logging.LogRequest(_logger, "health", requestId);

    var response = req.CreateResponse(HttpStatusCode.OK);
    await response.WriteAsJsonAsync(new { status = "ok" });
    return response;
  }
}
