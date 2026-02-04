/**
 * Purpose: Render the PromptCalc shell UI and sandboxed calculator viewer.
 * Persists: None.
 * Security Risks: Calls backend health endpoint, logs trace IDs, and renders untrusted HTML in a sandboxed iframe.
 */

import { useState } from "react";

import { CalculatorViewer } from "./components/CalculatorViewer";
import { BAD_CALC_HTML } from "./samples/badCalcInfiniteLoop";
import { GOOD_CALC_HTML } from "./samples/goodCalc";

interface HealthResponse {
  ok: boolean;
  service: string;
  build: string;
  traceId: string;
}

const App = () => {
  const [status, setStatus] = useState<HealthResponse | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState<"good" | "bad">("good");

  const checkHealth = async () => {
    setError(null);
    try {
      const response = await fetch("/api/health");
      const data = (await response.json()) as HealthResponse;
      const headerTrace = response.headers.get("x-trace-id");

      setStatus(data);
      setTraceId(headerTrace || data.traceId);

      console.info("Health check traceId:", headerTrace || data.traceId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setStatus(null);
      setTraceId(null);
      console.error("Health check failed", message);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>PromptCalc</h1>
      </header>
      <section className="panel">
        <h2>Calculator viewer</h2>
        <div className="toggle">
          <label>
            <input
              type="radio"
              name="sample"
              value="good"
              checked={sample === "good"}
              onChange={() => setSample("good")}
            />
            Good sample
          </label>
          <label>
            <input
              type="radio"
              name="sample"
              value="bad"
              checked={sample === "bad"}
              onChange={() => setSample("bad")}
            />
            Bad sample (hang)
          </label>
        </div>
        <CalculatorViewer
          artifactHtml={sample === "good" ? GOOD_CALC_HTML : BAD_CALC_HTML}
        />
      </section>
      <section className="panel">
        <h2>API status</h2>
        <button type="button" onClick={checkHealth}>
          Check health
        </button>
        {error && <p className="error">Error: {error}</p>}
        {status && (
          <dl>
            <div>
              <dt>Ok</dt>
              <dd>{String(status.ok)}</dd>
            </div>
            <div>
              <dt>Service</dt>
              <dd>{status.service}</dd>
            </div>
            <div>
              <dt>Build</dt>
              <dd>{status.build}</dd>
            </div>
            <div>
              <dt>Trace ID</dt>
              <dd>{traceId ?? status.traceId}</dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
};

export default App;
