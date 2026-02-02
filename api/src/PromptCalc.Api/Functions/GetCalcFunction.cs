// Purpose: Stub the calculator retrieval endpoint.
// Persists: None.
// Security Risks: Reads identifiers; no persistence in stub.

using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using PromptCalc.Api.Core.Observability;

namespace PromptCalc.Api.Functions;

public sealed class GetCalcFunction
{
  private readonly ILogger<GetCalcFunction> _logger;

  public GetCalcFunction(ILogger<GetCalcFunction> logger)
  {
    _logger = logger;
  }

  [Function("GetCalc")]
  public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "calcs/{id}")] HttpRequestData req, string id)
  {
    var requestId = Correlation.GetRequestId(req);
    Logging.LogRequest(_logger, "get_calc", requestId);
    Logging.LogStub(_logger, "get_calc", requestId);

    var response = req.CreateResponse(HttpStatusCode.NotImplemented);
    await response.WriteAsJsonAsync(new { error = "not_implemented", message = "GetCalc is not implemented." });
    return response;
  }
}
