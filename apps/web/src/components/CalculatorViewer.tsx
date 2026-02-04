/**
 * Purpose: Render untrusted calculator HTML inside a sandboxed iframe with CSP and watchdog.
 * Persists: None.
 * Security Risks: Handles untrusted HTML and cross-window postMessage events.
 */

import { useEffect, useMemo, useRef, useState } from "react";

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
  "<script id=\"promptcalc-ready\">(function(){const sendReady=()=>{try{window.parent.postMessage({type:\"ready\"},\"*\");}catch{}};const handlePing=(event)=>{try{if(event&&event.data&&event.data.type===\"ping\"){window.parent.postMessage({type:\"pong\"},\"*\");}}catch{}};if(document.readyState===\"loading\"){document.addEventListener(\"DOMContentLoaded\",sendReady,{once:true});}else{sendReady();}window.addEventListener(\"message\",handlePing);})();</script>";
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

const buildSrcDoc = (artifactHtml: string, csp: string): string => {
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

const isReadyMessage = (data: unknown): data is { type: "ready"; traceId?: string } => {
  if (!data || typeof data !== "object") {
    return false;
  }

  const record = data as { type?: unknown; traceId?: unknown };
  if (record.type !== "ready") {
    return false;
  }

  if (record.traceId !== undefined && typeof record.traceId !== "string") {
    return false;
  }

  return true;
};

export const CalculatorViewer = ({
  artifactHtml,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CalculatorViewerProps) => {
  const cspTemplate = useMemo(() => getCspTemplate(), []);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const rateRef = useRef({ windowStart: 0, count: 0 });
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [errorCode, setErrorCode] = useState<ViewerErrorCode | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [srcDoc, setSrcDoc] = useState<string>(buildBlankDoc());

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.info("CalculatorViewer CSP:", cspTemplate);
    }
  }, [cspTemplate]);

  useEffect(() => {
    const nextDoc = buildSrcDoc(artifactHtml, cspTemplate);

    setStatus("loading");
    setErrorCode(null);
    setTraceId(null);
    setSrcDoc(nextDoc);

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      setStatus("error");
      setErrorCode("WATCHDOG_TIMEOUT");
      setSrcDoc(buildBlankDoc());
    }, timeoutMs);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [artifactHtml, cspTemplate, timeoutMs]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
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

      if (!isReadyMessage(event.data)) {
        setStatus("error");
        setErrorCode("INVALID_MESSAGE");
        setSrcDoc(buildBlankDoc());
        return;
      }

      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      setStatus("ready");
      setErrorCode(null);
      setTraceId(event.data.traceId ?? null);
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const sandboxValue = iframeRef.current?.getAttribute("sandbox");
    if (sandboxValue !== "allow-scripts") {
      console.error("CalculatorViewer sandbox must be allow-scripts only.");
    }
  }, [srcDoc]);

  return (
    <section className="viewer">
      <div className="viewer-status">
        <strong>Status:</strong> {status === "loading" && "Loading..."}
        {status === "ready" && "Ready"}
        {status === "error" && `Error: ${errorCode ?? "UNKNOWN"}`}
        {traceId && <span className="viewer-trace">Trace: {traceId}</span>}
      </div>
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        className="viewer-frame"
        title="Calculator Viewer"
      />
    </section>
  );
};
