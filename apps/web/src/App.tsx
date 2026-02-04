/**
 * Purpose: Render the PromptCalc shell UI, persistence controls, and sandboxed calculator viewer.
 * Persists: None.
 * Security Risks: Calls backend persistence endpoints, logs trace IDs, and renders untrusted HTML in a sandboxed iframe.
 */

import { useEffect, useMemo, useState } from "react";

import { CalculatorViewer } from "./components/CalculatorViewer";
import { BAD_CALC_HTML } from "./samples/badCalcInfiniteLoop";
import { GOOD_CALC_HTML } from "./samples/goodCalc";

interface HealthResponse {
  ok: boolean;
  service: string;
  build: string;
  traceId: string;
}

interface SaveCalcResponse {
  calcId: string;
  versionId: string;
  status: string;
  currentVersionId: string;
}

interface CalculatorSummary {
  calcId: string;
  title: string;
  updatedAt: string;
  currentVersionId: string;
}

interface CalculatorVersionResponse {
  manifest: Record<string, unknown>;
  artifactHtml: string;
}

const App = () => {
  const [status, setStatus] = useState<HealthResponse | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState<"good" | "bad">("good");
  const [artifactHtml, setArtifactHtml] = useState<string>(GOOD_CALC_HTML);
  const [artifactSource, setArtifactSource] = useState<"sample" | "saved">(
    "sample"
  );
  const [calcs, setCalcs] = useState<CalculatorSummary[]>([]);
  const [calcsError, setCalcsError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [loadingCalcs, setLoadingCalcs] = useState(false);
  const [activeCalcId, setActiveCalcId] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);

  const sampleArtifactHtml = useMemo(
    () => (sample === "good" ? GOOD_CALC_HTML : BAD_CALC_HTML),
    [sample]
  );

  const sampleManifest = useMemo(
    () => ({
      specVersion: "1.0",
      title: sample === "good" ? "Offline Add Calculator" : "Broken Sample Calc",
      executionModel: "eventHandlers",
      capabilities: {
        network: false,
      },
      inputs: [],
      outputs: [],
      limitations: [],
      safetyNotes: [],
    }),
    [sample]
  );

  useEffect(() => {
    if (artifactSource === "sample") {
      setArtifactHtml(sampleArtifactHtml);
    }
  }, [artifactSource, sampleArtifactHtml]);

  const loadCalcs = async () => {
    setLoadingCalcs(true);
    setCalcsError(null);
    try {
      const response = await fetch("/api/calcs");
      if (!response.ok) {
        throw new Error(`List failed (${response.status})`);
      }
      const data = (await response.json()) as CalculatorSummary[];
      setCalcs(data ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setCalcsError(message);
    } finally {
      setLoadingCalcs(false);
    }
  };

  useEffect(() => {
    void loadCalcs();
  }, []);

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

  const saveCalc = async () => {
    setSaveStatus(null);
    setCalcsError(null);
    try {
      const response = await fetch("/api/calcs/save", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: sampleManifest.title,
          artifactHtml: sampleArtifactHtml,
          manifest: sampleManifest,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Save failed (${response.status}): ${text}`);
      }

      const data = (await response.json()) as SaveCalcResponse;
      setSaveStatus(`Saved ${data.calcId} v${data.versionId}`);
      setActiveCalcId(data.calcId);
      setActiveVersionId(data.versionId);
      await loadCalcs();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setSaveStatus(`Save failed: ${message}`);
    }
  };

  const loadVersion = async (calcId: string, versionId: string) => {
    setCalcsError(null);
    try {
      const response = await fetch(`/api/calcs/${calcId}/versions/${versionId}`);
      if (!response.ok) {
        throw new Error(`Load failed (${response.status})`);
      }

      const data = (await response.json()) as CalculatorVersionResponse;
      setArtifactHtml(data.artifactHtml);
      setArtifactSource("saved");
      setActiveCalcId(calcId);
      setActiveVersionId(versionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setCalcsError(message);
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
              onChange={() => {
                setSample("good");
                setArtifactSource("sample");
              }}
            />
            Good sample
          </label>
          <label>
            <input
              type="radio"
              name="sample"
              value="bad"
              checked={sample === "bad"}
              onChange={() => {
                setSample("bad");
                setArtifactSource("sample");
              }}
            />
            Bad sample (hang)
          </label>
        </div>
        <div className="actions">
          <button type="button" onClick={saveCalc}>
            Save sample
          </button>
          {saveStatus && <span className="status">{saveStatus}</span>}
        </div>
        <CalculatorViewer
          artifactHtml={artifactHtml}
        />
      </section>
      <section className="panel">
        <h2>My calculators</h2>
        <div className="actions">
          <button type="button" onClick={loadCalcs} disabled={loadingCalcs}>
            {loadingCalcs ? "Loading..." : "Refresh list"}
          </button>
          {calcsError && <span className="error">Error: {calcsError}</span>}
        </div>
        {calcs.length === 0 && !loadingCalcs && <p>No calculators saved yet.</p>}
        {calcs.length > 0 && (
          <ul className="calc-list">
            {calcs.map((calc) => (
              <li key={calc.calcId} className="calc-item">
                <div>
                  <strong>{calc.title}</strong>
                  <div className="calc-meta">
                    Updated {new Date(calc.updatedAt).toLocaleString()}
                  </div>
                  <div className="calc-meta">ID {calc.calcId}</div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void loadVersion(calc.calcId, calc.currentVersionId)
                  }
                >
                  Load
                </button>
              </li>
            ))}
          </ul>
        )}
        {activeCalcId && activeVersionId && (
          <p className="status">
            Loaded {activeCalcId} v{activeVersionId}
          </p>
        )}
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
