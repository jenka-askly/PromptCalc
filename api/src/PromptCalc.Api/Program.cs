// Purpose: Configure the Azure Functions isolated worker host for PromptCalc.
// Persists: None.
// Security Risks: Hosts HTTP endpoints that may receive untrusted input.

using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
  .ConfigureFunctionsWorkerDefaults()
  .Build();

host.Run();
