// Purpose: Stub the OTP start endpoint.
// Persists: None.
// Security Risks: Would handle authentication in a future implementation.

using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using PromptCalc.Api.Core.Observability;

namespace PromptCalc.Api.Functions;

public sealed class AuthStartOtpFunction
{
  private readonly ILogger<AuthStartOtpFunction> _logger;

  public AuthStartOtpFunction(ILogger<AuthStartOtpFunction> logger)
  {
    _logger = logger;
  }

  [Function("AuthStartOtp")]
  public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Function, "post", Route = "auth/start-otp")] HttpRequestData req)
  {
    var requestId = Correlation.GetRequestId(req);
    Logging.LogRequest(_logger, "auth_start_otp", requestId);
    Logging.LogStub(_logger, "auth_start_otp", requestId);

    var response = req.CreateResponse(HttpStatusCode.NotImplemented);
    await response.WriteAsJsonAsync(new { error = "not_implemented", message = "AuthStartOtp is not implemented." });
    return response;
  }
}
