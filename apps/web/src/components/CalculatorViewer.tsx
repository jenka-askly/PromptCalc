/**
 * Purpose: Render untrusted calculator HTML inside a sandboxed iframe with CSP and watchdog.
 * Persists: None.
 * Security Risks: Handles untrusted HTML and cross-window postMessage events.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCspTemplate } from "../policy/csp";

type ViewerStatus = "loading" | "ready" | "error";

type ViewerErrorCode = "WATCHDOG_TIMEOUT" | "INVALID_MESSAGE";

interface CalculatorViewerProps {
  artifactHtml: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 4000;

const READY_BOOTSTRAP_ID = "promptcalc-ready";
const READY_BOOTSTRAP_SCRIPT =
  "<script id=\"promptcalc-ready\">(function(){try{let token=null;const safePost=(payload)=>{try{window.parent.postMessage(payload,\"*\");}catch{}};const sendReady=(currentToken)=>{if(!currentToken){return;}safePost({type:\"PROMPTCALC_READY\",v:\"1\",ts:Date.now(),token:currentToken});safePost({type:\"ready\",token:currentToken});};const scheduleRetry=()=>{try{setTimeout(()=>{sendReady(token);},250);}catch{}};const handlePing=(event)=>{try{const data=event&&event.data;if(data&&data.type===\"PROMPTCALC_PING\"&&typeof data.token===\"string\"){token=data.token;safePost({type:\"PROMPTCALC_PONG\",v:\"1\",ts:Date.now(),token});sendReady(token);scheduleRetry();}}catch{}};if(document.readyState===\"loading\"){document.addEventListener(\"DOMContentLoaded\",()=>{sendReady(token);scheduleRetry();},{once:true});}else{sendReady(token);scheduleRetry();}window.addEventListener(\"message\",handlePing);}catch{}})();</script>";
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

const buildBlankDoc = (): string => "<!doctype html><html><body></body></html>";

const isHandshakeMessage = (
  data: unknown
): data is {
  type: "ready" | "PROMPTCALC_READY" | "PROMPTCALC_PONG";
  traceId?: string;
  token?: string;
} => {
  if (!data || typeof data !== "object") {
    return false;
  }

  const record = data as { type?: unknown; traceId?: unknown; token?: unknown };
  if (
    record.type !== "ready" &&
    record.type !== "PROMPTCALC_READY" &&
    record.type !== "PROMPTCALC_PONG"
  ) {
    return false;
  }

  if (record.traceId !== undefined && typeof record.traceId !== "string") {
    return false;
  }

  if (record.token !== undefined && typeof record.token !== "string") {
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

export const CalculatorViewer = ({
  artifactHtml,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CalculatorViewerProps) => {
  const cspTemplate = useMemo(() => getCspTemplate(), []);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const retryRef = useRef<number | null>(null);
  const rateRef = useRef({ windowStart: 0, count: 0 });
  const handshakeRef = useRef({ ready: false, pong: false });
  const warningLoggedRef = useRef(false);
  const listenerReadyRef = useRef(false);
  const pingPendingRef = useRef(false);
  const handshakeTokenRef = useRef<string>("");
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [errorCode, setErrorCode] = useState<ViewerErrorCode | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [srcDoc, setSrcDoc] = useState<string>(buildBlankDoc());
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.info("CalculatorViewer CSP:", cspTemplate);
    }
  }, [cspTemplate]);

  const handleMessage = useCallback((event: MessageEvent) => {
    const iframeWindow = iframeRef.current?.contentWindow;
    if (!iframeWindow || event.source !== iframeWindow) {
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
      setStatus("error");
      setErrorCode("INVALID_MESSAGE");
      setSrcDoc(buildBlankDoc());
      return;
    }

    if (event.data.token !== handshakeTokenRef.current) {
      return;
    }

    if (event.data.type === "ready" || event.data.type === "PROMPTCALC_READY") {
      handshakeRef.current.ready = true;
    }
    if (event.data.type === "PROMPTCALC_PONG") {
      handshakeRef.current.pong = true;
    }

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setStatus("ready");
    setErrorCode(null);
    setTraceId(event.data.traceId ?? null);
  }, []);

  useEffect(() => {
    if (listenerReadyRef.current) {
      return;
    }

    window.addEventListener("message", handleMessage);
    listenerReadyRef.current = true;
    return () => {
      listenerReadyRef.current = false;
      window.removeEventListener("message", handleMessage);
    };
  }, [handleMessage]);

  useEffect(() => {
    if (!listenerReadyRef.current) {
      return;
    }

    const nextDoc = normalizeArtifactHtml(artifactHtml, cspTemplate);

    setStatus("loading");
    setErrorCode(null);
    setTraceId(null);
    setSrcDoc(nextDoc);
    handshakeRef.current = { ready: false, pong: false };
    warningLoggedRef.current = false;
    pingPendingRef.current = true;
    handshakeTokenRef.current = generateHandshakeToken();

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      if (!warningLoggedRef.current) {
        console.warn("CalculatorViewer watchdog timeout", {
          readyReceived: handshakeRef.current.ready,
          pongReceived: handshakeRef.current.pong,
        });
        warningLoggedRef.current = true;
      }
      setStatus("error");
      setErrorCode("WATCHDOG_TIMEOUT");
      setSrcDoc(buildBlankDoc());
    }, timeoutMs);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [artifactHtml, cspTemplate, timeoutMs, retryToken]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const sandboxValue = iframeRef.current?.getAttribute("sandbox");
    if (sandboxValue !== "allow-scripts") {
      console.error("CalculatorViewer sandbox must be allow-scripts only.");
    }
  }, [srcDoc]);

  const handleIframeLoad = useCallback(() => {
    if (!pingPendingRef.current) {
      return;
    }

    pingPendingRef.current = false;
    const iframeWindow = iframeRef.current?.contentWindow;
    if (!iframeWindow) {
      return;
    }

    try {
      iframeWindow.postMessage(
        {
          type: "PROMPTCALC_PING",
          v: "1",
          ts: Date.now(),
          token: handshakeTokenRef.current,
        },
        "*"
      );
    } catch {
      // Intentionally ignored to avoid throwing from untrusted frames.
    }
  }, []);

  const handleRetry = () => {
    if (retryRef.current) {
      window.clearTimeout(retryRef.current);
    }
    retryRef.current = window.setTimeout(() => {
      setRetryToken((prev) => prev + 1);
    }, 0);
  };

  useEffect(
    () => () => {
      if (retryRef.current) {
        window.clearTimeout(retryRef.current);
      }
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    },
    []
  );

  return (
    <section className="viewer">
      <div className="viewer-status">
        <strong>Status:</strong> {status === "loading" && "Loading..."}
        {status === "ready" && "Ready"}
        {status === "error" && `Error: ${errorCode ?? "UNKNOWN"}`}
        {traceId && <span className="viewer-trace">Trace: {traceId}</span>}
      </div>
      {status === "error" && (
        <div className="viewer-error" role="alert">
          <p>Viewer failed to load the calculator content.</p>
          <button type="button" onClick={handleRetry}>
            Retry
          </button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        className="viewer-frame"
        title="Calculator Viewer"
        onLoad={handleIframeLoad}
      />
    </section>
  );
};
