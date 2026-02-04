/**
 * Purpose: Render the PromptCalc shell UI, persistence controls, and sandboxed calculator viewer.
 * Persists: None.
 * Security Risks: Calls backend persistence endpoints, logs trace IDs, and renders untrusted HTML in a sandboxed iframe.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { CalculatorViewer } from "./components/CalculatorViewer";
import { BAD_CALC_HTML } from "./samples/badCalcInfiniteLoop";
import { GOOD_CALC_HTML } from "./samples/goodCalc";

interface HealthResponse {
  ok: boolean;
  service: string;
  build: string;
  traceId: string;
  auth?: {
    isAuthenticated: boolean;
    identityProvider?: string;
    userId?: string;
  };
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

interface GenerateRefusalReason {
  code: string;
  message: string;
  safeAlternative: string;
}

type GenerateCalcResponse =
  | {
      status: "ok";
      calcId: string;
      versionId: string;
      manifest: Record<string, unknown>;
      artifactHtml: string;
    }
  | { status: "refused"; refusalReason: GenerateRefusalReason };

type AuthState =
  | { mode: "unknown" }
  | { mode: "dev"; userId: string }
  | { mode: "signed-in" }
  | { mode: "signed-out" };

type ArtifactStatus = "sample" | "saved";

interface CurrentArtifact {
  calcId: string | null;
  versionId: string | null;
  artifactHtml: string;
  manifest?: Record<string, unknown>;
  artifactHash: string;
  status: ArtifactStatus;
}

const buildSampleManifest = (sample: "good" | "bad") => ({
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
});

const computeArtifactHash = (artifactHtml: string) => {
  let hash = 0;
  for (let i = 0; i < artifactHtml.length; i += 1) {
    hash = (hash * 31 + artifactHtml.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16);
};

const buildCurrentArtifact = ({
  artifactHtml,
  calcId = null,
  versionId = null,
  manifest,
  status,
}: {
  artifactHtml: string;
  calcId?: string | null;
  versionId?: string | null;
  manifest?: Record<string, unknown>;
  status: ArtifactStatus;
}): CurrentArtifact => ({
  artifactHtml,
  calcId,
  versionId,
  manifest,
  artifactHash: computeArtifactHash(artifactHtml),
  status,
});

const App = () => {
  const [status, setStatus] = useState<HealthResponse | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState<"good" | "bad">("good");
  const [currentArtifact, setCurrentArtifact] = useState<CurrentArtifact>(() =>
    buildCurrentArtifact({
      artifactHtml: GOOD_CALC_HTML,
      manifest: buildSampleManifest("good"),
      status: "sample",
    })
  );
  const [calcs, setCalcs] = useState<CalculatorSummary[]>([]);
  const [calcsError, setCalcsError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [loadingCalcs, setLoadingCalcs] = useState(false);
  const [authState, setAuthState] = useState<AuthState>({ mode: "unknown" });
  const [generatePrompt, setGeneratePrompt] = useState(
    "Simple tip calculator with bill + tip% + total."
  );
  const [generateStatus, setGenerateStatus] = useState<string | null>(null);
  const [generateRefusal, setGenerateRefusal] = useState<GenerateRefusalReason | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const previousArtifactRef = useRef<CurrentArtifact | null>(null);
  const viewerKey = `${currentArtifact.artifactHash}`;

  const sampleArtifactHtml = useMemo(
    () => (sample === "good" ? GOOD_CALC_HTML : BAD_CALC_HTML),
    [sample]
  );

  const sampleManifest = useMemo(() => buildSampleManifest(sample), [sample]);
  const isDev = import.meta.env.DEV;

  useEffect(() => {
    if (currentArtifact.status === "sample") {
      const sampleHash = computeArtifactHash(sampleArtifactHtml);
      if (
        currentArtifact.artifactHash !== sampleHash ||
        currentArtifact.manifest !== sampleManifest
      ) {
        setCurrentArtifact(
          buildCurrentArtifact({
            artifactHtml: sampleArtifactHtml,
            manifest: sampleManifest,
            status: "sample",
          })
        );
      }
    }
  }, [currentArtifact.status, sampleArtifactHtml, sampleManifest]);

  useEffect(() => {
    if (!isDev) {
      previousArtifactRef.current = currentArtifact;
      return;
    }

    const previous = previousArtifactRef.current;
    if (
      !previous ||
      previous.artifactHash !== currentArtifact.artifactHash ||
      previous.calcId !== currentArtifact.calcId ||
      previous.versionId !== currentArtifact.versionId
    ) {
      console.warn("App current artifact changed", {
        length: currentArtifact.artifactHtml.length,
        calcId: currentArtifact.calcId,
        versionId: currentArtifact.versionId,
        hash: currentArtifact.artifactHash,
        status: currentArtifact.status,
      });
    }

    if (currentArtifact.artifactHtml.length === 0) {
      console.warn("App current artifact cleared unexpectedly", {
        calcId: currentArtifact.calcId,
        versionId: currentArtifact.versionId,
      });
    }

    previousArtifactRef.current = currentArtifact;
  }, [currentArtifact, isDev]);

  const resolveAuthState = (health: HealthResponse) => {
    if (health.auth?.identityProvider === "dev") {
      setAuthState({
        mode: "dev",
        userId: health.auth.userId ?? "dev-user",
      });
      return;
    }
    if (health.auth?.isAuthenticated) {
      setAuthState({ mode: "signed-in" });
      return;
    }
    setAuthState({ mode: "signed-out" });
  };

  const loadAuthState = async () => {
    try {
      const response = await fetch("/api/health");
      const data = (await response.json()) as HealthResponse;
      resolveAuthState(data);
    } catch {
      setAuthState({ mode: "signed-out" });
    }
  };

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
    void loadAuthState();
  }, []);

  const checkHealth = async () => {
    setError(null);
    try {
      const response = await fetch("/api/health");
      const data = (await response.json()) as HealthResponse;
      const headerTrace = response.headers.get("x-trace-id");

      setStatus(data);
      setTraceId(headerTrace || data.traceId);
      resolveAuthState(data);

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
      setCurrentArtifact((prev) =>
        buildCurrentArtifact({
          artifactHtml: prev.artifactHtml,
          manifest: prev.manifest,
          status: "saved",
          calcId: data.calcId,
          versionId: data.versionId,
        })
      );
      await loadCalcs();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setSaveStatus(`Save failed: ${message}`);
    }
  };

  const generateCalc = async () => {
    setGenerateStatus(null);
    setGenerateRefusal(null);
    setCalcsError(null);
    setIsGenerating(true);
    try {
      const response = await fetch("/api/calcs/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt: generatePrompt,
          baseCalcId: currentArtifact.calcId ?? undefined,
          baseVersionId: currentArtifact.versionId ?? undefined,
        }),
      });

      const data = (await response.json()) as GenerateCalcResponse;
      if (!response.ok) {
        throw new Error(
          `Generate failed (${response.status}): ${JSON.stringify(data)}`
        );
      }

      if (data.status === "refused") {
        setGenerateRefusal(data.refusalReason);
        setGenerateStatus("Generation refused.");
        return;
      }

      setCurrentArtifact(
        buildCurrentArtifact({
          artifactHtml: data.artifactHtml,
          manifest: data.manifest,
          status: "saved",
          calcId: data.calcId,
          versionId: data.versionId,
        })
      );
      setGenerateStatus(`Generated ${data.calcId} v${data.versionId}`);
      await loadCalcs();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setGenerateStatus(`Generation failed: ${message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const loadVersion = async (calcId: string, versionId: string) => {
    if (currentArtifact.calcId === calcId && currentArtifact.versionId === versionId) {
      return;
    }
    setCalcsError(null);
    try {
      const response = await fetch(`/api/calcs/${calcId}/versions/${versionId}`);
      if (!response.ok) {
        throw new Error(`Load failed (${response.status})`);
      }

      const data = (await response.json()) as CalculatorVersionResponse;
      setCurrentArtifact(
        buildCurrentArtifact({
          artifactHtml: data.artifactHtml,
          manifest: data.manifest,
          status: "saved",
          calcId,
          versionId,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setCalcsError(message);
    }
  };

  const handleSignIn = () => {
    window.location.assign("/.auth/login/aad");
  };

  const handleSignOut = () => {
    window.location.assign("/.auth/logout?post_logout_redirect_uri=/");
  };

  return (
    <div className="app">
      <header>
        <h1>PromptCalc</h1>
        <div className="auth">
          {authState.mode === "dev" && (
            <span className="auth-status">Dev mode user: {authState.userId}</span>
          )}
          {authState.mode === "signed-in" && (
            <>
              <span className="auth-status">Signed in</span>
              <button type="button" onClick={handleSignOut}>
                Sign out
              </button>
            </>
          )}
          {authState.mode === "signed-out" && (
            <>
              <span className="auth-status">Signed out</span>
              <button type="button" onClick={handleSignIn}>
                Sign in
              </button>
            </>
          )}
          {authState.mode === "unknown" && (
            <span className="auth-status">Checking auth...</span>
          )}
        </div>
      </header>
      <section className="panel">
        <h2>Calculator viewer</h2>
        <div className="generate">
          <label htmlFor="generate-prompt">Generate calculator</label>
          <textarea
            id="generate-prompt"
            rows={3}
            value={generatePrompt}
            onChange={(event) => setGeneratePrompt(event.target.value)}
          />
          <div className="actions">
            <button type="button" onClick={generateCalc} disabled={isGenerating}>
              {isGenerating ? "Generating..." : "Generate calculator"}
            </button>
            {generateStatus && <span className="status">{generateStatus}</span>}
          </div>
          {generateRefusal && (
            <div className="refusal">
              <strong>Refused: {generateRefusal.code}</strong>
              <div>{generateRefusal.message}</div>
              <div className="refusal-alt">
                Try instead: {generateRefusal.safeAlternative}
              </div>
            </div>
          )}
        </div>
        <div className="toggle">
          <label>
            <input
              type="radio"
              name="sample"
              value="good"
              checked={sample === "good"}
              onChange={() => {
                setSample("good");
                setCurrentArtifact(
                  buildCurrentArtifact({
                    artifactHtml: GOOD_CALC_HTML,
                    manifest: buildSampleManifest("good"),
                    status: "sample",
                  })
                );
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
                setCurrentArtifact(
                  buildCurrentArtifact({
                    artifactHtml: BAD_CALC_HTML,
                    manifest: buildSampleManifest("bad"),
                    status: "sample",
                  })
                );
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
          key={viewerKey}
          artifactHtml={currentArtifact.artifactHtml}
          calcId={currentArtifact.calcId}
          versionId={currentArtifact.versionId}
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
        {currentArtifact.calcId && currentArtifact.versionId && (
          <p className="status">
            Loaded {currentArtifact.calcId} v{currentArtifact.versionId}
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
