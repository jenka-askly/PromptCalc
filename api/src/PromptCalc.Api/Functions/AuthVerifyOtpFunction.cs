// Purpose: Stub the OTP verification endpoint.
// Persists: None.
// Security Risks: Would handle authentication tokens in a future implementation.

using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using PromptCalc.Api.Core.Observability;

namespace PromptCalc.Api.Functions;

public sealed class AuthVerifyOtpFunction
{
  private readonly ILogger<AuthVerifyOtpFunction> _logger;

  public AuthVerifyOtpFunction(ILogger<AuthVerifyOtpFunction> logger)
  {
    _logger = logger;
  }

  [Function("AuthVerifyOtp")]
  public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Function, "post", Route = "auth/verify-otp")] HttpRequestData req)
  {
    var requestId = Correlation.GetRequestId(req);
    Logging.LogRequest(_logger, "auth_verify_otp", requestId);
    Logging.LogStub(_logger, "auth_verify_otp", requestId);

    var response = req.CreateResponse(HttpStatusCode.NotImplemented);
    await response.WriteAsJsonAsync(new { error = "not_implemented", message = "AuthVerifyOtp is not implemented." });
    return response;
  }
}
