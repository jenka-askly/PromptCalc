/**
 * Purpose: Render the PromptCalc shell UI, persistence controls, and sandboxed calculator viewer.
 * Persists: Dev-only red-team profile in browser sessionStorage key promptcalc.redteam.profile when capability is enabled.
 * Security Risks: Calls backend persistence endpoints, logs trace IDs, and renders untrusted HTML in a sandboxed iframe.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { defaultProfile, normalizeProfile, profileId } from "@promptcalc/types";
import type { RedTeamDebugProfile } from "@promptcalc/types";

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

interface GenerateResponseDiagnostics {
  traceId?: string;
  dumpDir?: string | null;
  dumpPaths?: string[];
  profileId?: string;
  effectiveProfile?: RedTeamDebugProfile;
  skippedByProfile?: string[];
}

interface GenerateErrorResponse extends GenerateResponseDiagnostics {
  code?: string;
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
}

type GenerateCalcResponse =
  | {
      kind: "ok";
      status: "ok";
      traceId?: string;
      dumpDir?: string | null;
      dumpPaths?: string[];
      calcId: string;
      versionId: string;
      manifest: Record<string, unknown>;
      artifactHtml: string;
      scanOutcome: "allow" | "deny" | "skipped";
      overrideUsed: boolean;
    }
  | {
      kind: "scan_block";
      status: "refused";
      refusalReason: GenerateRefusalReason;
      traceId?: string;
      dumpDir?: string | null;
      dumpPaths?: string[];
    }
  | {
      kind: "scan_warn";
      status: "scan_warn";
      requiresUserProceed: true;
      traceId?: string;
      dumpDir?: string | null;
      dumpPaths?: string[];
      scanDecision: {
        refusalCode: string | null;
        categories: string[];
        reason: string;
      };
    }
  | {
      kind: "scan_skipped";
      status: "scan_skipped";
      requiresUserProceed: true;
      traceId?: string;
      dumpDir?: string | null;
      dumpPaths?: string[];
    };

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
    storage: false,
    dynamicCode: false,
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

const RED_TEAM_PROFILE_SESSION_KEY = "promptcalc.redteam.profile";

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
  const [generateTraceId, setGenerateTraceId] = useState<string | null>(null);
  const [generateDumpDir, setGenerateDumpDir] = useState<string | null>(null);
  const [generateDumpPaths, setGenerateDumpPaths] = useState<string[]>([]);
  const [effectiveProfileSummary, setEffectiveProfileSummary] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [redTeamProfile, setRedTeamProfile] = useState<RedTeamDebugProfile>(() => defaultProfile());
  const redTeamProfileHash = useMemo(() => profileId(redTeamProfile), [redTeamProfile]);
  const [scanBanner, setScanBanner] = useState<"warn" | "off" | null>(null);
  const [pendingInterstitial, setPendingInterstitial] = useState<
    | { kind: "scan_warn"; refusalCode: string | null; categories: string[]; reason: string }
    | { kind: "scan_skipped" }
    | null
  >(null);
  const [outputTab, setOutputTab] = useState<"output" | "logs" | "html">("output");
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
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
    if (!redTeamCapabilityAvailable) {
      setRedTeamProfile(defaultProfile());
      setPendingInterstitial(null);
      return;
    }
    const saved = window.sessionStorage.getItem(RED_TEAM_PROFILE_SESSION_KEY);
    if (!saved) {
      setRedTeamProfile(defaultProfile());
      return;
    }
    try {
      setRedTeamProfile(normalizeProfile(JSON.parse(saved) as unknown));
    } catch {
      setRedTeamProfile(defaultProfile());
    }
  }, [redTeamCapabilityAvailable]);

  useEffect(() => {
    if (!redTeamCapabilityAvailable) {
      return;
    }
    window.sessionStorage.setItem(RED_TEAM_PROFILE_SESSION_KEY, JSON.stringify(redTeamProfile));
  }, [redTeamCapabilityAvailable, redTeamProfile]);

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
    setGenerateTraceId(null);
    setGenerateDumpDir(null);
    setGenerateDumpPaths([]);
    setEffectiveProfileSummary(null);
    setCalcsError(null);
    setIsGenerating(true);
    try {
      const payload: { prompt: string; redTeamProfile: RedTeamDebugProfile; proceedOverride?: boolean } = {
        prompt: generatePrompt,
        redTeamProfile: normalizeProfile({
          ...redTeamProfile,
          enabled: redTeamProfile.enabled,
        }),
      };
      if (proceedOverride) {
        payload.proceedOverride = true;
      }
      let requestBody = "";
      try {
        requestBody = JSON.stringify(payload);
      } catch {
        console.error("Generate payload is not JSON-serializable", {
          payloadKeys: Object.keys(payload),
        });
        setGenerateStatus(
          "Request payload is not JSON-serializable (likely a DOM element or React event leaked into the payload)."
        );
        return;
      }

      const response = await fetch("/api/calcs/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: requestBody,
      });

      const data = (await response.json()) as GenerateCalcResponse | GenerateErrorResponse;
      setGenerateTraceId(typeof data.traceId === "string" ? data.traceId : null);
      setGenerateDumpDir(typeof data.dumpDir === "string" ? data.dumpDir : null);
      setGenerateDumpPaths(Array.isArray(data.dumpPaths) ? data.dumpPaths : []);
      if (data.effectiveProfile) {
        setEffectiveProfileSummary(`profileId=${data.profileId ?? "n/a"} ${JSON.stringify(data.effectiveProfile)}`);
      }
      if (!response.ok) {
        const errorResponse = data as GenerateErrorResponse;
        const errorCode =
          typeof errorResponse.code === "string"
            ? errorResponse.code
            : typeof errorResponse.error?.code === "string"
              ? errorResponse.error.code
              : undefined;
        if (errorCode === "MODEL_OUTPUT_JSON_INVALID") {
          setGenerateStatus("Model output was invalid JSON (likely truncated). See dump folder.");
          return;
        }
        throw new Error(errorResponse.error?.message ?? `Generate failed (${response.status})`);
      }

      const successData = data as GenerateCalcResponse;

      if (successData.kind === "scan_block") {
        setGenerateRefusal(successData.refusalReason);
        setGenerateStatus("Generation refused.");
        return;
      }

      if (successData.kind === "scan_warn") {
        setPendingInterstitial({
          kind: "scan_warn",
          refusalCode: successData.scanDecision.refusalCode,
          categories: successData.scanDecision.categories,
          reason: successData.scanDecision.reason,
        });
        setGenerateStatus("Scan warning requires confirmation.");
        return;
      }

      if (successData.kind === "scan_skipped") {
        setPendingInterstitial({ kind: "scan_skipped" });
        setGenerateStatus("Scan is disabled in red-team mode. Confirmation required.");
        return;
      }

      setCurrentArtifact(
        buildCurrentArtifact({
          artifactHtml: successData.artifactHtml,
          manifest: successData.manifest,
          status: "saved",
          calcId: successData.calcId,
          versionId: successData.versionId,
        })
      );
      if (successData.scanOutcome === "deny" && successData.overrideUsed) {
        setScanBanner("warn");
      } else if (successData.scanOutcome === "skipped") {
        setScanBanner("off");
      } else {
        setScanBanner(null);
      }
      setPendingInterstitial(null);
      setGenerateStatus(`Generated ${successData.calcId} v${successData.versionId}`);
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

  const updateRedTeamProfile = (patch: Partial<RedTeamDebugProfile>) => {
    setRedTeamProfile((previous) => normalizeProfile({ ...previous, ...patch }));
  };

  const copyDebugHeader = async () => {
    const effective = {
      ...redTeamProfile,
      enabled: redTeamCapabilityAvailable && redTeamProfile.enabled,
    };
    const header = [
      `traceId=${generateTraceId ?? "n/a"}` ,
      `profileId=${redTeamProfileHash}`,
      `effectiveProfile=${JSON.stringify(effective)}`,
    ].join("\n");
    await navigator.clipboard.writeText(header);
    setGenerateStatus("Copied debug header to clipboard.");
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <h1>PromptCalc</h1>
          <div className="topbar-indicators">
            {redTeamCapabilityAvailable && <span className="status">Red-team dev checks enabled</span>}
            {(generateTraceId ?? traceId) && <span className="status">Trace ID: {generateTraceId ?? traceId}</span>}
          </div>
        </div>
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
      <main className="workbench">
        <aside className="control-pane panel">
          <details open className="collapsible-section">
            <summary>Generate</summary>
            <div className="generate">
              <label htmlFor="generate-prompt">Prompt input</label>
              <textarea
                id="generate-prompt"
                rows={3}
                value={generatePrompt}
                onChange={(event) => setGeneratePrompt(event.target.value)}
              />
              <div className="actions">
                <button type="button" onClick={() => void generateCalc(false)} disabled={isGenerating}>
                  {isGenerating ? "Generating..." : "Generate calculator"}
                </button>
              </div>
              {generateStatus && <span className="status">{generateStatus}</span>}
              {generateTraceId && <span className="status">Trace ID: {generateTraceId}</span>}
              {generateDumpDir && <span className="status">Dump folder: {generateDumpDir}</span>}
              {effectiveProfileSummary && <span className="status">{effectiveProfileSummary}</span>}

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
            </div>
          </details>

          {redTeamCapabilityAvailable && (
            <details open className="collapsible-section redteam-panel">
              <summary>Debug / red-team</summary>
              <p>Dev-only controls (PROMPTCALC_REDKIT=1). Use for permutation debugging only.</p>
              <label>
                Red-team profile enabled
                <input
                  type="checkbox"
                  checked={redTeamProfile.enabled}
                  onChange={(event) => updateRedTeamProfile({ enabled: event.target.checked })}
                />
              </label>
              <label>
                Scan mode
                <select
                  value={redTeamProfile.scanMode}
                  onChange={(event) =>
                    updateRedTeamProfile({ scanMode: event.target.value as RedTeamDebugProfile["scanMode"] })
                  }
                >
                  <option value="enforce">enforce</option>
                  <option value="warn">warn</option>
                  <option value="off">off</option>
                </select>
              </label>
              <label><input type="checkbox" checked={redTeamProfile.strictInstructions} onChange={(event) => updateRedTeamProfile({ strictInstructions: event.target.checked })} /> strictInstructions</label>
              <label><input type="checkbox" checked={redTeamProfile.promptVerification} onChange={(event) => updateRedTeamProfile({ promptVerification: event.target.checked })} /> promptVerification</label>
              <label><input type="checkbox" checked={redTeamProfile.schemaEnforcement} onChange={(event) => updateRedTeamProfile({ schemaEnforcement: event.target.checked })} /> schemaEnforcement</label>
              <label><input type="checkbox" checked={redTeamProfile.htmlValidation} onChange={(event) => updateRedTeamProfile({ htmlValidation: event.target.checked })} /> htmlValidation</label>
              <label><input type="checkbox" checked={redTeamProfile.postProcess} onChange={(event) => updateRedTeamProfile({ postProcess: event.target.checked })} /> postProcess</label>
              <label><input type="checkbox" checked={redTeamProfile.dumpCollateral} onChange={(event) => updateRedTeamProfile({ dumpCollateral: event.target.checked })} /> Generate all collateral when generating</label>
              <div className="actions">
                <span className="status">profileId: {redTeamProfileHash}</span>
                <button type="button" onClick={() => void copyDebugHeader()}>Copy debug header</button>
                <button type="button" onClick={() => {
                  window.sessionStorage.removeItem(RED_TEAM_PROFILE_SESSION_KEY);
                  setRedTeamProfile(defaultProfile());
                }}>Reset</button>
              </div>
            </details>
          )}

          {currentArtifact.manifest && (
            <details className="collapsible-section">
              <summary>Manifest / metadata</summary>
              <div className="manifest-details">
                <dl>
                  <div>
                    <dt>Spec version</dt>
                    <dd>{manifestSpecVersion}</dd>
                  </div>
                  <div>
                    <dt>Execution model</dt>
                    <dd>{manifestExecutionModel}</dd>
                  </div>
                  <div>
                    <dt>Profile ID</dt>
                    <dd>{redTeamProfileHash}</dd>
                  </div>
                </dl>
              </div>
            </details>
          )}
        </aside>

        <section className="output-pane panel">
          <h2>Output area</h2>
          <div className="tabs" role="tablist" aria-label="Output tabs">
            <button type="button" className={outputTab === "output" ? "tab active" : "tab"} onClick={() => setOutputTab("output")}>Output</button>
            <button type="button" className={outputTab === "logs" ? "tab active" : "tab"} onClick={() => setOutputTab("logs")}>Logs / errors</button>
            {isDev && (
              <button type="button" className={outputTab === "html" ? "tab active" : "tab"} onClick={() => setOutputTab("html")}>Generated HTML</button>
            )}
          </div>

          {scanBanner === "warn" && <div className="scan-banner warn">You proceeded despite scan warning.</div>}
          {scanBanner === "off" && <div className="scan-banner off">Scan disabled (red team mode).</div>}

          <div className="tab-content">
            {outputTab === "output" && (
              <CalculatorViewer
                key={viewerKey}
                artifactHtml={currentArtifact.artifactHtml}
                calcId={currentArtifact.calcId}
                versionId={currentArtifact.versionId}
              />
            )}
            {outputTab === "logs" && (
              <div className="log-panel">
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
                    <div className="refusal-alt">Try instead: {generateRefusal.safeAlternative}</div>
                  </div>
                )}
                {generateDumpPaths.length > 0 && (
                  <div className="dump-paths">
                    <strong>Debug dump paths</strong>
                    <ul>
                      {generateDumpPaths.map((dumpPath, index) => (
                        <li key={`${dumpPath}-${index}`}>{dumpPath}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!generateRefusal && generateDumpPaths.length === 0 && (
                  <p className="status">No logs yet. Generate a calculator to view trace-linked diagnostics.</p>
                )}
              </div>
            )}
            {isDev && outputTab === "html" && (
              <pre className="html-preview">{currentArtifact.artifactHtml}</pre>
            )}
          </div>
          {currentArtifact.calcId && currentArtifact.versionId && (
            <p className="status">
              Loaded {currentArtifact.calcId} v{currentArtifact.versionId}
            </p>
          )}
        </section>
      </main>

      <section className={historyDrawerOpen ? "bottom-drawer open" : "bottom-drawer"}>
        <div className="bottom-drawer-header">
          <button type="button" className="secondary" onClick={() => setHistoryDrawerOpen((open) => !open)}>
            {historyDrawerOpen ? "Hide history" : "My calculators"}
          </button>
        </div>
        {historyDrawerOpen && (
          <div className="bottom-drawer-content">
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
    </div>
  );
};

export default App;
