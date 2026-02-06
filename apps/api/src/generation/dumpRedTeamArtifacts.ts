/**
 * Purpose: Persist red-team debugging artifacts, including full per-trace collateral bundles, when enabled.
 * Persists: Local files under .promptcalc_artifacts/<traceId>/ and legacy stage dumps under .promptcalc_artifacts/{requests,responses,html,logs,index.log}.
 * Security Risks: Intentionally writes raw prompt/model output/error data to disk in dev-only red-team mode.
 */

import { appendFile, mkdir, writeFile } from "fs/promises";
import path from "path";

import { isRedTeamEnabled, type ScanPolicyMode } from "./scanPolicy";

type DumpStage = "scan" | "generate" | "viewer" | "error";

type DumpMeta = {
  ts: string;
  model: string;
  scanPolicyMode: ScanPolicyMode;
  overrideArmed: boolean;
  overrideUsed: boolean;
  profileId?: string;
  effectiveProfile?: unknown;
  envFlags?: Record<string, boolean>;
  skippedSteps?: string[];
  systemInstructions?: string;
  dumpCollateral?: boolean;
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
  validation?: unknown;
  error?: DumpError;
  parseDetails?: {
    parseError?: {
      message?: string;
      stack?: string;
      snippetPrefix?: string;
      snippetSuffix?: string;
    };
    modelOutputRawText?: string;
  };
  meta: DumpMeta;
};

const artifactRoot = path.resolve(process.cwd(), ".promptcalc_artifacts");

const sanitizeForJson = (value: unknown): unknown => {
  const seen = new WeakSet<object>();
  return JSON.parse(
    JSON.stringify(value, (_key: string, candidate: unknown) => {
      if (typeof candidate === "function" || typeof candidate === "symbol") {
        return undefined;
      }
      if (typeof candidate === "bigint") {
        return candidate.toString();
      }
      if (candidate && typeof candidate === "object") {
        if (seen.has(candidate)) {
          return "[circular]";
        }
        seen.add(candidate);
      }
      return candidate;
    })
  ) as unknown;
};

const writeJson = async (filePath: string, payload: unknown): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(sanitizeForJson(payload), null, 2)}\n`, "utf8");
};

const dumpCollateralBundle = async (args: DumpArgs): Promise<{ dumpDir: string; paths: string[] }> => {
  const traceDir = path.join(artifactRoot, args.traceId);
  await mkdir(traceDir, { recursive: true });

  const paths: string[] = [];
  const envFlags = args.meta.envFlags ?? {};

  const push = async (name: string, content: unknown | string, text = false) => {
    const fullPath = path.join(traceDir, name);
    if (text) {
      await writeFile(fullPath, String(content), "utf8");
    } else {
      await writeJson(fullPath, content);
    }
    paths.push(fullPath);
  };

  await push("profile.json", {
    traceId: args.traceId,
    profileId: args.meta.profileId,
    effectiveProfile: args.meta.effectiveProfile,
    envFlags,
    skippedSteps: args.meta.skippedSteps ?? [],
  });
  await push("prompt.txt", args.prompt ?? "", true);
  await push("system.txt", args.meta.systemInstructions ?? "", true);
  await push("scan_request.json", { scanRequest: args.scanRequest });
  await push("scan_response_raw.json", { scanResponseRaw: args.scanResponseRaw });
  await push("gen_request.json", { genRequest: args.genRequest });
  await push("gen_response_raw.json", { genResponseRaw: args.genResponseRaw });
  const extractedHtml = typeof args.html === "string" && args.html.length > 0
    ? args.html
    : (args.validation ? "<!-- extracted HTML unavailable: see validation_error.json -->" : "");
  await push("extracted.html", extractedHtml, true);
  await push("extracted_candidate.html", extractedHtml, true);
  await push("validation.json", { validation: args.validation, skippedSteps: args.meta.skippedSteps ?? [] });
  if (args.validation) {
    await push("validation_error.json", {
      validator: (args.validation as Record<string, unknown>).validator,
      message: (args.validation as Record<string, unknown>).message,
      path: (args.validation as Record<string, unknown>).path,
      location: (args.validation as Record<string, unknown>).location,
      details: args.validation,
    });
  }
  if (args.error) {
    await push("error.json", { error: args.error });
  }
  if (args.parseDetails?.modelOutputRawText !== undefined) {
    await push("06_model_output_raw.txt", args.parseDetails.modelOutputRawText, true);
    await push("model_output_raw.txt", args.parseDetails.modelOutputRawText, true);
  }
  if (args.parseDetails?.parseError) {
    const parsePayload = { parseError: args.parseDetails.parseError };
    await push("09_parse_error.json", parsePayload);
    await push("parse_error.json", parsePayload);
  }

  return { dumpDir: traceDir, paths };
};

const dumpLegacyStage = async (args: DumpArgs): Promise<string[]> => {
  const requestsDir = path.join(artifactRoot, "requests");
  const responsesDir = path.join(artifactRoot, "responses");
  const htmlDir = path.join(artifactRoot, "html");
  const logsDir = path.join(artifactRoot, "logs");
  const indexPath = path.join(artifactRoot, "index.log");
  await Promise.all([
    mkdir(requestsDir, { recursive: true }),
    mkdir(responsesDir, { recursive: true }),
    mkdir(htmlDir, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
  ]);

  const fileBase = `${args.traceId}.${args.stage}`;
  const requestPath = path.join(requestsDir, `${fileBase}.json`);
  const responsePath = path.join(responsesDir, `${fileBase}.json`);
  const htmlPath = path.join(htmlDir, `${fileBase}.html`);

  await writeJson(requestPath, {
    traceId: args.traceId,
    stage: args.stage,
    prompt: args.prompt,
    scanRequest: args.scanRequest,
    genRequest: args.genRequest,
    meta: args.meta,
  });
  await writeJson(responsePath, {
    traceId: args.traceId,
    stage: args.stage,
    scanResponseRaw: args.scanResponseRaw,
    genResponseRaw: args.genResponseRaw,
    validation: args.validation,
    error: args.error,
    parseDetails: args.parseDetails,
    meta: args.meta,
  });

  const paths = [requestPath, responsePath];
  if (typeof args.html === "string") {
    await writeFile(htmlPath, args.html, "utf8");
    paths.push(htmlPath);
  }

  const indexLine = `${args.meta.ts} traceId=${args.traceId} stage=${args.stage} profileId=${args.meta.profileId ?? "na"} ${paths.join(" ")}\n`;
  await appendFile(indexPath, indexLine, "utf8");
  return paths;
};

export const dumpRedTeamArtifacts = async (
  args: DumpArgs
): Promise<{ dumpDir: string | null; paths: string[] } | null> => {
  if (!isRedTeamEnabled()) {
    return null;
  }

  const dumped = args.meta.dumpCollateral
    ? await dumpCollateralBundle(args)
    : { dumpDir: null, paths: await dumpLegacyStage(args) };

  console.log(
    `[redteam_dump] traceId=${args.traceId} profileId=${args.meta.profileId ?? "na"} dumpDir=${dumped.dumpDir ?? "n/a"} files=${dumped.paths.join(";")}`
  );

  return dumped;
};
