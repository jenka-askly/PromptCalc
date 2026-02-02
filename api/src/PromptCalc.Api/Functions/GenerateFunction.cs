// Purpose: Stub the prompt-to-calculator generation endpoint.
// Persists: None.
// Security Risks: Accepts user-provided prompts; no processing in stub.

using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using PromptCalc.Api.Core.Observability;

namespace PromptCalc.Api.Functions;

public sealed class GenerateFunction
{
  private readonly ILogger<GenerateFunction> _logger;

  public GenerateFunction(ILogger<GenerateFunction> logger)
  {
    _logger = logger;
  }

  [Function("Generate")]
  public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Function, "post", Route = "generate")] HttpRequestData req)
  {
    var requestId = Correlation.GetRequestId(req);
    Logging.LogRequest(_logger, "generate", requestId);
    Logging.LogStub(_logger, "generate", requestId);

    var response = req.CreateResponse(HttpStatusCode.NotImplemented);
    await response.WriteAsJsonAsync(new { error = "not_implemented", message = "Generate is not implemented." });
    return response;
  }
}
