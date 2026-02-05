/**
 * Purpose: Persist red-team debugging artifacts to local disk when explicitly enabled.
 * Persists: Local files under .promptcalc_artifacts/{requests,responses,html,logs,index.log}.
 * Security Risks: Intentionally writes raw prompt/model output/error data to disk in dev-only red-team mode.
 */

import { appendFile, mkdir, writeFile } from "fs/promises";
import path from "path";

import { isRedTeamEnabled, type ScanPolicyMode } from "./scanPolicy";

/**
 * RED TEAM DEV-ONLY DEBUG DUMP (INTENTIONALLY UNSAFE)
 * - Writes prompts and model outputs to disk to speed debugging.
 * - MUST NEVER SHIP TO PROD.
 * - Enabled only when PROMPTCALC_REDKIT=1.
 */

type DumpStage = "scan" | "generate" | "viewer" | "error";

type DumpMeta = {
  ts: string;
  model: string;
  scanPolicyMode: ScanPolicyMode;
  overrideArmed: boolean;
  overrideUsed: boolean;
};

type DumpError = { message: string; stack?: string; code?: string; type?: string };

type DumpArgs = {
  traceId: string;
  stage: DumpStage;
  prompt?: string;
  scanRequest?: unknown;
  scanResponseRaw?: unknown;
  genRequest?: unknown;
  genResponseRaw?: unknown;
  html?: string;
  error?: DumpError;
  meta: DumpMeta;
};

const artifactRoot = path.resolve(process.cwd(), ".promptcalc_artifacts");
const requestsDir = path.join(artifactRoot, "requests");
const responsesDir = path.join(artifactRoot, "responses");
const htmlDir = path.join(artifactRoot, "html");
const logsDir = path.join(artifactRoot, "logs");
const indexPath = path.join(artifactRoot, "index.log");

const sanitizeForJson = (value: unknown): unknown => {
  const seen = new WeakSet<object>();
  return JSON.parse(
    JSON.stringify(value, (key: string, candidate: unknown) => {
      if (typeof candidate === "function" || typeof candidate === "symbol") {
        return undefined;
      }
      if (typeof candidate === "bigint") {
        return candidate.toString();
      }
      if (
        key.toLowerCase().includes("ownerdocument") ||
        key.toLowerCase().includes("reactfiber") ||
        key.toLowerCase().includes("parentnode")
      ) {
        return undefined;
      }
      if (candidate && typeof candidate === "object") {
        const objectValue = candidate as Record<string, unknown>;
        if (
          "nodeType" in objectValue ||
          "tagName" in objectValue ||
          "ownerDocument" in objectValue
        ) {
          return undefined;
        }
        if (seen.has(candidate)) {
          return "[circular]";
        }
        seen.add(candidate);
      }
      return candidate;
    })
  ) as unknown;
};

const ensureArtifactDirs = async (): Promise<void> => {
  await Promise.all([
    mkdir(requestsDir, { recursive: true }),
    mkdir(responsesDir, { recursive: true }),
    mkdir(htmlDir, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
  ]);
};

export const dumpRedTeamArtifacts = async (args: DumpArgs): Promise<{ paths: string[] } | null> => {
  if (!isRedTeamEnabled()) {
    return null;
  }

  await ensureArtifactDirs();

  const fileBase = `${args.traceId}.${args.stage}`;
  const requestPath = path.join(requestsDir, `${fileBase}.json`);
  const responsePath = path.join(responsesDir, `${fileBase}.json`);
  const htmlPath = path.join(htmlDir, `${fileBase}.html`);

  const requestPayload = sanitizeForJson({
    traceId: args.traceId,
    stage: args.stage,
    prompt: args.prompt,
    scanRequest: args.scanRequest,
    genRequest: args.genRequest,
    meta: args.meta,
  });

  const responsePayload = sanitizeForJson({
    traceId: args.traceId,
    stage: args.stage,
    scanResponseRaw: args.scanResponseRaw,
    genResponseRaw: args.genResponseRaw,
    error: args.error,
    meta: args.meta,
  });

  const paths: string[] = [];

  await writeFile(requestPath, `${JSON.stringify(requestPayload, null, 2)}\n`, "utf8");
  paths.push(requestPath);

  await writeFile(responsePath, `${JSON.stringify(responsePayload, null, 2)}\n`, "utf8");
  paths.push(responsePath);

  if (typeof args.html === "string") {
    await writeFile(htmlPath, args.html, "utf8");
    paths.push(htmlPath);
  }

  const indexLine = `${args.meta.ts} traceId=${args.traceId} stage=${args.stage} ${paths.join(" ")}\n`;
  await appendFile(indexPath, indexLine, "utf8");

  console.log(`[redteam_dump] traceId=${args.traceId} files=${paths.join(";")}`);

  return { paths };
};
