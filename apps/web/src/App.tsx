/**
 * Purpose: Render the PromptCalc shell UI, persistence controls, and sandboxed calculator viewer.
 * Persists: Session-only red-team arming state in browser sessionStorage key promptcalc.redteam.armed.
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
  redTeamCapabilityAvailable?: boolean;
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
  details?: GenerateRefusalDetail[];
}

interface GenerateRefusalDetail {
  code?: string;
  severity?: string;
  message?: string;
  summary?: string;
  evidence?: string;
}

type GenerateCalcResponse =
  | {
      kind: "ok";
      status: "ok";
      calcId: string;
      versionId: string;
      manifest: Record<string, unknown>;
      artifactHtml: string;
      scanOutcome: "allow" | "deny" | "skipped";
      overrideUsed: boolean;
    }
  | { kind: "scan_block"; status: "refused"; refusalReason: GenerateRefusalReason }
  | {
      kind: "scan_warn";
      status: "scan_warn";
      requiresUserProceed: true;
      scanDecision: {
        refusalCode: string | null;
        categories: string[];
        reason: string;
      };
    }
  | { kind: "scan_skipped"; status: "scan_skipped"; requiresUserProceed: true };

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
  specVersion: "1.1",
  title: sample === "good" ? "Offline Add Calculator" : "Broken Sample Calc",
  executionModel: "form",
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

const RED_TEAM_SESSION_KEY = "promptcalc.redteam.armed";

const formatRefusalDetail = (detail: GenerateRefusalDetail): string => {
  const base =
    detail.message ?? detail.summary ?? detail.evidence ?? "AI scan issue reported.";
  const suffixParts: string[] = [];
  if (detail.code) {
    suffixParts.push(`code: ${detail.code}`);
  }
  if (detail.severity) {
    suffixParts.push(`severity: ${detail.severity}`);
  }
  return suffixParts.length > 0 ? `${base} (${suffixParts.join(", ")})` : base;
};

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
  const [redTeamCapabilityAvailable, setRedTeamCapabilityAvailable] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState(
    "Simple tip calculator with bill + tip% + total."
  );
  const [generateStatus, setGenerateStatus] = useState<string | null>(null);
  const [generateRefusal, setGenerateRefusal] = useState<GenerateRefusalReason | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [redTeamArmed, setRedTeamArmed] = useState(() =>
    window.sessionStorage.getItem(RED_TEAM_SESSION_KEY) === "1"
  );
  const [pendingRedTeamEnableConfirm, setPendingRedTeamEnableConfirm] = useState(false);
  const [scanBanner, setScanBanner] = useState<"warn" | "off" | null>(null);
  const [pendingInterstitial, setPendingInterstitial] = useState<
    | { kind: "scan_warn"; refusalCode: string | null; categories: string[]; reason: string }
    | { kind: "scan_skipped" }
    | null
  >(null);
  const previousArtifactRef = useRef<CurrentArtifact | null>(null);
  const viewerKey = `${currentArtifact.artifactHash}`;
  const manifestExecutionModel =
    typeof currentArtifact.manifest?.executionModel === "string"
      ? currentArtifact.manifest.executionModel
      : "unknown";
  const manifestSpecVersion =
    typeof currentArtifact.manifest?.specVersion === "string"
      ? currentArtifact.manifest.specVersion
      : "unknown";

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
    setRedTeamCapabilityAvailable(health.redTeamCapabilityAvailable === true);
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

  useEffect(() => {
    if (redTeamCapabilityAvailable) {
      return;
    }
    window.sessionStorage.removeItem(RED_TEAM_SESSION_KEY);
    setRedTeamArmed(false);
    setPendingRedTeamEnableConfirm(false);
    setPendingInterstitial(null);
  }, [redTeamCapabilityAvailable]);

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

  const generateCalc = async (proceedOverride = false) => {
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
          redTeamArmed,
          proceedOverride,
        }),
      });

      const data = (await response.json()) as GenerateCalcResponse;
      if (!response.ok) {
        throw new Error(
          `Generate failed (${response.status}): ${JSON.stringify(data)}`
        );
      }

      if (data.kind === "scan_block") {
        setGenerateRefusal(data.refusalReason);
        setGenerateStatus("Generation refused.");
        return;
      }

      if (data.kind === "scan_warn") {
        setPendingInterstitial({
          kind: "scan_warn",
          refusalCode: data.scanDecision.refusalCode,
          categories: data.scanDecision.categories,
          reason: data.scanDecision.reason,
        });
        setGenerateStatus("Scan warning requires confirmation.");
        return;
      }

      if (data.kind === "scan_skipped") {
        setPendingInterstitial({ kind: "scan_skipped" });
        setGenerateStatus("Scan is disabled in red-team mode. Confirmation required.");
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
      if (data.scanOutcome === "deny" && data.overrideUsed) {
        setScanBanner("warn");
      } else if (data.scanOutcome === "skipped") {
        setScanBanner("off");
      } else {
        setScanBanner(null);
      }
      setPendingInterstitial(null);
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

  const confirmEnableRedTeam = () => {
    window.sessionStorage.setItem(RED_TEAM_SESSION_KEY, "1");
    setRedTeamArmed(true);
    setPendingRedTeamEnableConfirm(false);
    setGenerateStatus("Red-team override armed for this browser session.");
  };

  const disarmRedTeam = () => {
    window.sessionStorage.removeItem(RED_TEAM_SESSION_KEY);
    setRedTeamArmed(false);
    setPendingInterstitial(null);
    setPendingRedTeamEnableConfirm(false);
  };

  const updateRedTeamSelection = (value: "yes" | "no") => {
    if (value === "yes") {
      if (!redTeamArmed) {
        setPendingRedTeamEnableConfirm(true);
      }
      return;
    }
    disarmRedTeam();
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
              {generateRefusal.details && generateRefusal.details.length > 0 && (
                <ul className="refusal-issues">
                  {generateRefusal.details.map((detail, index) => (
                    <li key={`${detail.code ?? "issue"}-${index}`}>
                      {formatRefusalDetail(detail)}
                    </li>
                  ))}
                </ul>
              )}
              <div className="refusal-alt">
                Try instead: {generateRefusal.safeAlternative}
              </div>
            </div>
          )}
          {redTeamCapabilityAvailable && (
            <div className="redteam-panel">
              <strong>Dev red-team controls</strong>
              <p>Warning: this mode can bypass scan blocking in development.</p>
              <fieldset>
                <legend>Bypass AI scan blocks (red team)</legend>
                <label>
                  <input
                    type="radio"
                    name="redteam-armed"
                    value="no"
                    checked={!redTeamArmed}
                    onChange={() => updateRedTeamSelection("no")}
                  />
                  No
                </label>
                <label>
                  <input
                    type="radio"
                    name="redteam-armed"
                    value="yes"
                    checked={redTeamArmed}
                    onChange={() => updateRedTeamSelection("yes")}
                  />
                  Yes
                </label>
              </fieldset>
              <div className="actions">
                <span className="status">{redTeamArmed ? "Armed" : "Not armed"}</span>
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
        {scanBanner === "warn" && <div className="scan-banner warn">You proceeded despite scan warning.</div>}
        {scanBanner === "off" && <div className="scan-banner off">Scan disabled (red team mode).</div>}
        <CalculatorViewer
          key={viewerKey}
          artifactHtml={currentArtifact.artifactHtml}
          calcId={currentArtifact.calcId}
          versionId={currentArtifact.versionId}
        />
        {currentArtifact.manifest && (
          <div className="manifest-details">
            <h3>Manifest details</h3>
            <dl>
              <div>
                <dt>Spec version</dt>
                <dd>{manifestSpecVersion}</dd>
              </div>
              <div>
                <dt>Execution model</dt>
                <dd>{manifestExecutionModel}</dd>
              </div>
            </dl>
          </div>
        )}
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
      {pendingInterstitial && (
        <div className="interstitial-overlay" role="dialog" aria-modal="true">
          <div className="interstitial">
            <h3>
              {pendingInterstitial.kind === "scan_warn"
                ? "AI Safety Scan Warning"
                : "AI Scan Disabled"}
            </h3>
            {pendingInterstitial.kind === "scan_warn" ? (
              <>
                <p>{pendingInterstitial.reason}</p>
                <p>
                  Refusal code: {pendingInterstitial.refusalCode ?? "none"}
                  {pendingInterstitial.categories.length > 0
                    ? ` | Categories: ${pendingInterstitial.categories.join(", ")}`
                    : ""}
                </p>
              </>
            ) : (
              <p>Prompt scanning is disabled in red-team mode for this request.</p>
            )}
            <div className="actions">
              <button
                type="button"
                className="secondary"
                autoFocus
                onClick={() => setPendingInterstitial(null)}
              >
                Cancel
              </button>
              <button type="button" onClick={() => void generateCalc(true)}>
                Proceed anyway
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingRedTeamEnableConfirm && (
        <div className="interstitial-overlay" role="dialog" aria-modal="true">
          <div className="interstitial">
            <h3>Enable red-team override?</h3>
            <p>
              This only applies in development mode and still requires a per-request "Proceed
              anyway" confirmation.
            </p>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                autoFocus
                onClick={() => setPendingRedTeamEnableConfirm(false)}
              >
                Cancel
              </button>
              <button type="button" onClick={confirmEnableRedTeam}>
                Enable
              </button>
            </div>
          </div>
        </div>
      )}

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
