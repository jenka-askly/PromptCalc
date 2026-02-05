/**
 * Purpose: Render untrusted calculator HTML inside a sandboxed iframe with CSP and watchdog.
 * Persists: None.
 * Security Risks: Handles untrusted HTML and cross-window postMessage events.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCspTemplate } from "../policy/csp";

type ViewerStatus = "loading" | "ready" | "error";

type ViewerErrorCode = "WATCHDOG_TIMEOUT";

interface CalculatorViewerProps {
  artifactHtml: string;
  calcId?: string | null;
  versionId?: string | null;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 4000;

const READY_BOOTSTRAP_ID = "promptcalc-ready";
const READY_BOOTSTRAP_SCRIPT =
  "<script id=\"promptcalc-ready\">(function(){try{const safePost=(payload)=>{try{window.parent.postMessage(payload,\"*\");}catch{}};const state={loadId:null,token:null,ready:false,domReady:document.readyState!==\"loading\"};const sendReady=()=>{if(state.ready||!state.loadId||!state.token){return;}state.ready=true;safePost({type:\"PROMPTCALC_READY\",v:\"1\",ts:Date.now(),loadId:state.loadId,token:state.token});};const handlePing=(event)=>{try{const data=event&&event.data;if(!data||data.type!==\"PING\"){return;}if(typeof data.loadId!==\"string\"||typeof data.token!==\"string\"){return;}state.loadId=data.loadId;state.token=data.token;sendReady();if(!state.domReady){document.addEventListener(\"DOMContentLoaded\",()=>{state.domReady=true;sendReady();},{once:true});}}catch{}};if(document.readyState===\"loading\"){document.addEventListener(\"DOMContentLoaded\",()=>{state.domReady=true;sendReady();},{once:true});}window.addEventListener(\"message\",handlePing);}catch{}})();</script>";
const READY_BOOTSTRAP_REGEX = new RegExp(
  `<script[^>]*id=["']${READY_BOOTSTRAP_ID}["'][^>]*>`,
  "i"
);

const ensureReadyBootstrap = (artifactHtml: string, cspMetaRegex: RegExp): string => {
  if (READY_BOOTSTRAP_REGEX.test(artifactHtml)) {
    return artifactHtml;
  }

  if (cspMetaRegex.test(artifactHtml)) {
    return artifactHtml.replace(
      cspMetaRegex,
      (match) => `${match}${READY_BOOTSTRAP_SCRIPT}`
    );
  }

  if (/<head[^>]*>/i.test(artifactHtml)) {
    return artifactHtml.replace(
      /<head[^>]*>/i,
      (match) => `${match}${READY_BOOTSTRAP_SCRIPT}`
    );
  }

  if (/<body[^>]*>/i.test(artifactHtml)) {
    return artifactHtml.replace(
      /<body[^>]*>/i,
      (match) => `${match}${READY_BOOTSTRAP_SCRIPT}`
    );
  }

  return `${READY_BOOTSTRAP_SCRIPT}${artifactHtml}`;
};

const normalizeArtifactHtml = (artifactHtml: string, csp: string): string => {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  const cspMetaRegex = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i;

  let html = artifactHtml;

  if (cspMetaRegex.test(html)) {
    html = html.replace(cspMetaRegex, cspMeta);
  } else if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (match) => `${match}${cspMeta}`);
  } else {
    html = `${cspMeta}${html}`;
  }

  return ensureReadyBootstrap(html, cspMetaRegex);
};

const isHandshakeMessage = (
  data: unknown
): data is {
  type: "PROMPTCALC_READY";
  loadId: string;
  token: string;
  traceId?: string;
} => {
  if (!data || typeof data !== "object") {
    return false;
  }

  const record = data as {
    type?: unknown;
    traceId?: unknown;
    token?: unknown;
    loadId?: unknown;
  };
  if (record.type !== "PROMPTCALC_READY") {
    return false;
  }

  if (record.traceId !== undefined && typeof record.traceId !== "string") {
    return false;
  }

  if (typeof record.token !== "string") {
    return false;
  }

  if (typeof record.loadId !== "string") {
    return false;
  }

  return true;
};

const generateHandshakeToken = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const computeArtifactHash = (artifactHtml: string) => {
  let hash = 0;
  for (let i = 0; i < artifactHtml.length; i += 1) {
    hash = (hash * 31 + artifactHtml.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16);
};

export const CalculatorViewer = ({
  artifactHtml,
  calcId,
  versionId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CalculatorViewerProps) => {
  const cspTemplate = useMemo(() => getCspTemplate(), []);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const watchdogLoadIdRef = useRef<string | null>(null);
  const rateRef = useRef({ windowStart: 0, count: 0 });
  const pingSentRef = useRef(false);
  const handshakeTokenRef = useRef<string>("");
  const iframeLoadRef = useRef(false);
  const loadIdRef = useRef<string>("");
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [errorCode, setErrorCode] = useState<ViewerErrorCode | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const normalizedArtifactHtml = useMemo(
    () => normalizeArtifactHtml(artifactHtml, cspTemplate),
    [artifactHtml, cspTemplate]
  );
  const [srcDoc, setSrcDoc] = useState<string>("");
  const [loadId, setLoadId] = useState<string>("");
  const [reloadToken, setReloadToken] = useState(0);
  const [sawIframeLoad, setSawIframeLoad] = useState(false);
  const [sawReady, setSawReady] = useState(false);
  const [lastMsgType, setLastMsgType] = useState<string | null>(null);
  const [lastMsgOrigin, setLastMsgOrigin] = useState<string | null>(null);
  const isDev = import.meta.env.DEV;
  const iframeKey = `viewer-${loadId}`;

  useEffect(() => {
    if (isDev) {
      console.info("CalculatorViewer CSP:", cspTemplate);
    }
  }, [cspTemplate, isDev]);

  const stopWatchdog = useCallback(
    (reason: "ready" | "cleanup" | "reload", loadIdOverride?: string) => {
      if (!timerRef.current) {
        return;
      }
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      watchdogLoadIdRef.current = null;
      if (isDev) {
        console.warn("CalculatorViewer watchdog stopped", {
          loadId: loadIdOverride ?? loadIdRef.current,
          reason,
        });
      }
    },
    [isDev]
  );

  const handleMessage = useCallback((event: MessageEvent) => {
    const iframeWindow = iframeRef.current?.contentWindow;
    const eventData = event.data as {
      type?: unknown;
      token?: unknown;
      loadId?: unknown;
    } | null;
    const observedLoadId =
      typeof eventData?.loadId === "string" ? eventData.loadId : null;
    const observedToken =
      typeof eventData?.token === "string" ? eventData.token : null;
    if (isDev) {
      setLastMsgType(typeof eventData?.type === "string" ? eventData.type : null);
      setLastMsgOrigin(event.origin || null);
    }
    if (!iframeWindow || event.source !== iframeWindow) {
      if (isDev) {
        console.warn("CalculatorViewer message.recv", {
          loadId: observedLoadId,
          token: observedToken,
          accepted: false,
          reasonIfIgnored: "source-mismatch",
        });
      }
      return;
    }

    const now = performance.now();
    if (now - rateRef.current.windowStart > 1000) {
      rateRef.current = { windowStart: now, count: 0 };
    }

    if (rateRef.current.count >= 20) {
      return;
    }

    rateRef.current.count += 1;

    if (!isHandshakeMessage(event.data)) {
      if (isDev) {
        console.warn("CalculatorViewer message.recv", {
          loadId: observedLoadId,
          token: observedToken,
          accepted: false,
          reasonIfIgnored: "invalid-payload",
        });
      }
      return;
    }

    if (event.data.loadId !== loadIdRef.current) {
      if (isDev) {
        console.warn("CalculatorViewer message.recv", {
          loadId: event.data.loadId,
          token: event.data.token,
          accepted: false,
          reasonIfIgnored: "loadId-mismatch",
        });
      }
      return;
    }

    if (event.data.token !== handshakeTokenRef.current) {
      if (isDev) {
        console.warn("CalculatorViewer message.recv", {
          loadId: event.data.loadId,
          token: event.data.token,
          accepted: false,
          reasonIfIgnored: "token-mismatch",
        });
      }
      return;
    }

    if (isDev) {
      console.warn("CalculatorViewer message.recv", {
        loadId: event.data.loadId,
        token: event.data.token,
        accepted: true,
      });
    }

    if (isDev) {
      setSawReady(true);
    }

    if (watchdogLoadIdRef.current === event.data.loadId) {
      stopWatchdog("ready", event.data.loadId);
    }

    setStatus("ready");
    setErrorCode(null);
    setTraceId(event.data.traceId ?? null);
  }, [isDev, stopWatchdog]);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [handleMessage]);

  useEffect(() => {
    stopWatchdog("reload");

    const nextLoadId = generateHandshakeToken();
    const nextToken = generateHandshakeToken();
    loadIdRef.current = nextLoadId;
    handshakeTokenRef.current = nextToken;
    setLoadId(nextLoadId);

    const artifactHash = computeArtifactHash(normalizedArtifactHtml);
    if (isDev) {
      console.warn("CalculatorViewer load.start", {
        loadId: nextLoadId,
        artifactHash,
        len: normalizedArtifactHtml.length,
      });
    }

    setStatus("loading");
    setErrorCode(null);
    setTraceId(null);
    setSrcDoc(normalizedArtifactHtml);
    if (isDev) {
      console.warn("CalculatorViewer srcdoc.assigned", {
        loadId: nextLoadId,
        len: normalizedArtifactHtml.length,
      });
    }
    pingSentRef.current = false;
    iframeLoadRef.current = false;
    if (isDev) {
      setSawIframeLoad(false);
      setSawReady(false);
      setLastMsgType(null);
      setLastMsgOrigin(null);
    }

    const timeoutLoadId = nextLoadId;
    watchdogLoadIdRef.current = timeoutLoadId;
    timerRef.current = window.setTimeout(() => {
      if (loadIdRef.current !== timeoutLoadId) {
        return;
      }
      console.warn("CalculatorViewer watchdog.timeout", {
        loadId: timeoutLoadId,
      });
      setStatus("error");
      setErrorCode("WATCHDOG_TIMEOUT");
    }, timeoutMs);
    if (isDev) {
      console.warn("CalculatorViewer watchdog started", {
        loadId: nextLoadId,
        timeoutMs,
      });
    }

    return () => {
      stopWatchdog("cleanup");
    };
  }, [
    normalizedArtifactHtml,
    timeoutMs,
    reloadToken,
    calcId,
    versionId,
    isDev,
    stopWatchdog,
  ]);

  useEffect(() => {
    if (!isDev) {
      return;
    }

    const sandboxValue = iframeRef.current?.getAttribute("sandbox");
    if (sandboxValue !== "allow-scripts") {
      console.error("CalculatorViewer sandbox must be allow-scripts only.");
    }
  }, [srcDoc, isDev]);

  useEffect(() => {
    if (isDev) {
      console.warn("CalculatorViewer iframe mounted", { iframeKey });
    }
  }, [iframeKey, isDev]);

  const handleIframeLoad = useCallback(() => {
    const currentLoadId = loadIdRef.current;
    if (iframeLoadRef.current) {
      return;
    }
    if (isDev) {
      console.warn("CalculatorViewer iframe.load", { loadId: currentLoadId });
    }
    iframeLoadRef.current = true;
    if (isDev) {
      setSawIframeLoad(true);
    }
    if (pingSentRef.current) {
      return;
    }

    pingSentRef.current = true;
    const iframeWindow = iframeRef.current?.contentWindow;
    if (!iframeWindow) {
      return;
    }

    try {
      if (isDev) {
        console.warn("CalculatorViewer ping.sent", {
          loadId: currentLoadId,
        });
      }
      iframeWindow.postMessage(
        {
          type: "PING",
          v: "1",
          ts: Date.now(),
          loadId: currentLoadId,
          token: handshakeTokenRef.current,
        },
        "*"
      );
    } catch {
      // Intentionally ignored to avoid throwing from untrusted frames.
    }
  }, [iframeKey, isDev]);

  const handleRetry = () => {
    setReloadToken((prev) => prev + 1);
  };

  useEffect(() => () => stopWatchdog("cleanup"), [stopWatchdog]);

  return (
    <section className="viewer">
      <div className="viewer-status">
        <strong>Status:</strong> {status === "loading" && "Loading..."}
        {status === "ready" && "Ready"}
        {status === "error" && `Error: ${errorCode ?? "UNKNOWN"}`}
        {traceId && <span className="viewer-trace">Trace: {traceId}</span>}
        {isDev && (
          <small className="viewer-debug">
            Debug: load={String(sawIframeLoad)} ready={String(sawReady)} lastType=
            {lastMsgType ?? "none"} lastOrigin={lastMsgOrigin ?? "none"}
          </small>
        )}
      </div>
      {status === "error" && (
        <div className="viewer-error" role="alert">
          <p>Viewer failed to load the calculator content.</p>
          <button type="button" onClick={handleRetry}>
            Retry
          </button>
        </div>
      )}
      {loadId && (
        <iframe
          key={iframeKey}
          ref={iframeRef}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
          className="viewer-frame"
          title="Calculator Viewer"
          onLoad={handleIframeLoad}
        />
      )}
    </section>
  );
};
