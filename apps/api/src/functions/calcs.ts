/**
 * Purpose: Implement calculator persistence endpoints backed by Azure Table and Blob storage.
 * Persists: Table PromptCalcMeta (Calculator, CalculatorVersion) and blobs under users/<userId>/calcs/<calcId>/.
 * Security Risks: Accepts untrusted HTML/manifest input, reads storage configuration, and returns artifact content.
 */

import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { createHash, randomUUID } from "crypto";

import { logEvent } from "@promptcalc/logger";
import type { RefusalCode } from "@promptcalc/types";

import { getUserContext } from "../auth";
import { getGenerationConfig } from "../generation/config";
import { resolveRuntimeScanPolicyMode, resolveScanPolicyConfig } from "../generation/scanPolicy";
import { dumpRedTeamArtifacts } from "../generation/dumpRedTeamArtifacts";
import {
  getExecutionModelRuleText,
  selectExecutionModelFromPrompt,
} from "../generation/executionModel";
import { resolveGenerationGate } from "../generation/gate";
import {
  parseArtifactGenerationOutput,
  type ArtifactGenerationOutput,
} from "../generation/artifactOutput";
import {
  formatAiScanIssueSummary,
  evaluateAiScanPolicy,
  stringifyAiScanIssueSummaries,
  summarizeAiScanIssues,
} from "../generation/aiScan";
import {
  buildGenerateOkResponse,
  buildGenerateScanBlockResponse,
  buildGenerateScanSkippedResponse,
  buildGenerateScanWarnResponse,
  type RefusalReason,
} from "../generation/response";
import { ensureFormSafety } from "../generation/artifactPostprocess";
import {
  callOpenAIResponses,
  OpenAIBadRequestError,
  OpenAIParseError,
  type OpenAIRequest,
  type OpenAITextFormat,
} from "../openai/client";
import { getPromptCalcPolicy } from "../policy/policy";
import { scanArtifactHtml } from "../policy/scanner";
import { SAFE_EXPRESSION_EVALUATOR_SNIPPET } from "../templates/safeExpressionEvaluator";
import { getTraceId } from "../trace";
import { getBlobPath, getContainerClient, getMaxArtifactBytes, getTableClient } from "../storage";

interface SaveCalcRequest {
  title?: string;
  calcId?: string;
  baseVersionId?: string;
  prompt?: string;
  artifactHtml: string;
  manifest: Record<string, unknown>;
}

interface GenerateCalcRequest {
  prompt: string;
  baseCalcId?: string;
  baseVersionId?: string;
  redTeamArmed?: boolean;
  proceedOverride?: boolean;
}

interface PromptScanDecision {
  allowed: boolean;
  refusalCode: string | null;
  reason: string;
  safeAlternative: string;
}

interface CodeScanDecision {
  isSafe?: boolean;
  issues?: unknown[];
  safe?: boolean;
  findings?: unknown[];
}

interface CalculatorSummary {
  calcId: string;
  title: string;
  updatedAt: string;
  currentVersionId: string;
}

interface CalculatorDetail {
  calcId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  currentVersionId: string;
  versions: Array<{ versionId: string; createdAt: string; status: string }>;
}

type CalculatorEntity = {
  partitionKey: string;
  rowKey: string;
  entityType: "Calculator";
  calcId: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  currentVersionId: string;
};

type CalculatorVersionEntity = {
  partitionKey: string;
  rowKey: string;
  entityType: "CalculatorVersion";
  calcId: string;
  versionId: string;
  userId: string;
  createdAt: string;
  prompt?: string;
  promptLen?: number;
  status: "ok" | "refused" | "quarantined";
  manifestBlobPath: string;
  artifactBlobPath: string;
  artifactHash: string;
};

const jsonResponse = (
  traceId: string,
  status: number,
  body: unknown
): HttpResponseInit => ({
  status,
  jsonBody: body,
  headers: {
    "content-type": "application/json",
    "x-trace-id": traceId,
  },
});

const buildOpenAIBadRequestRefusal = (): RefusalReason =>
  buildRefusalReason(
    "OPENAI_BAD_REQUEST",
    "OpenAI request rejected",
    "Try again after updating server config."
  );

const buildOpenAIBadRequestResponse = (
  traceId: string,
  status: number,
  dumpPaths?: string[]
): HttpResponseInit =>
  jsonResponse(traceId, status, {
    ...buildGenerateScanBlockResponse(buildOpenAIBadRequestRefusal()),
    traceId,
    dumpPaths,
  });

const buildOpenAIParseFailedResponse = (traceId: string, dumpPaths?: string[]): HttpResponseInit =>
  jsonResponse(traceId, 502, {
    code: "OPENAI_PARSE_FAILED",
    traceId,
    dumpPaths,
  });

const unauthorizedResponse = (traceId: string): HttpResponseInit =>
  jsonResponse(traceId, 401, {
    code: "UNAUTHORIZED",
    traceId,
  });

const forbiddenResponse = (traceId: string): HttpResponseInit =>
  jsonResponse(traceId, 403, {
    code: "FORBIDDEN",
    traceId,
  });

const storageErrorResponse = (traceId: string): HttpResponseInit =>
  jsonResponse(traceId, 500, {
    code: "STORAGE_TABLE_FAILED",
    traceId,
  });

const sanitizeId = (value: string) => value.replace(/[\\/]/g, "_");
const normalizeId = (value: string | undefined): string => sanitizeId(String(value ?? ""));

const MAX_TABLE_KEY_LENGTH = 1024;
const safeKey = (value: string): string => {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_");
  if (sanitized.length <= MAX_TABLE_KEY_LENGTH) {
    return sanitized;
  }
  return createHash("sha256").update(sanitized, "utf8").digest("hex");
};

const buildCalcPartition = (userId: string) => `USER_${safeKey(userId)}`;
const buildCalcRow = (calcId: string) => `CALC_${safeKey(calcId)}`;
const buildVersionPartition = (userId: string, calcId: string) =>
  `USER_${safeKey(userId)}_CALC_${safeKey(calcId)}`;
const buildVersionRow = (versionId: string) => `VER_${safeKey(versionId)}`;


const truncate = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;

const listToString = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map(String).join(", ");
  }
  if (typeof value === "string") {
    return value;
  }
  if (!value) {
    return "";
  }
  return JSON.stringify(value);
};

const getObjectKeys = (value: unknown): string[] =>
  value && typeof value === "object" ? Object.keys(value as Record<string, unknown>) : [];

const buildJsonSchemaResponseFormat = (
  name: string,
  schema: Record<string, unknown>
): OpenAITextFormat => ({
  type: "json_schema",
  name,
  schema,
  strict: true,
});

export const promptScanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    allowed: { type: "boolean" },
    refusalCode: { type: ["string", "null"] },
    reason: { type: "string" },
    safeAlternative: { type: "string" },
  },
  required: ["allowed", "refusalCode", "reason", "safeAlternative"],
};

export const generationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    artifactHtml: { type: "string" },
    manifest: {
      type: "object",
      additionalProperties: false,
      properties: {
        specVersion: { type: "string" },
        title: { type: "string" },
        executionModel: { type: "string" },
        capabilities: {
          type: "object",
          additionalProperties: false,
          properties: {
            network: { type: "boolean" },
          },
          required: ["network"],
        },
      },
      required: ["specVersion", "title", "executionModel", "capabilities"],
    },
    notes: { type: "string" },
  },
  required: ["artifactHtml", "manifest"],
};

export const codeScanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    isSafe: { type: "boolean" },
    safe: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        anyOf: [
          { type: "string" },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              category: {
                type: "string",
                enum: [
                  "networking",
                  "external_resource",
                  "dynamic_code",
                  "navigation",
                  "credential_capture",
                  "data_exfiltration",
                ],
              },
              message: { type: "string" },
              evidence: { type: "string" },
              severity: { type: "string" },
              code: { type: "string" },
            },
            required: ["category", "message", "evidence"],
          },
        ],
      },
    },
    findings: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["isSafe"],
};

const SUPPORTED_SPEC_VERSION = "1.1";
const EXPRESSION_EVALUATOR_REGEX = /\bcomputeExpr\s*\(/;

const logTableError = (
  traceId: string,
  error: unknown,
  event: string,
  op = "calcs.storage",
  entityKeys?: { PartitionKey?: string; RowKey?: string }
): void => {
  const restError = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const statusCode = restError?.statusCode;
  const code = restError?.code;
  const details = restError?.details;
  const message = typeof restError?.message === "string" ? truncate(restError.message, 200) : undefined;
  const detailsErrorCode =
    details && typeof details === "object"
      ? (details as { errorCode?: unknown }).errorCode
      : undefined;

  logEvent({
    level: "error",
    op,
    traceId,
    event,
    errorCode: code ?? (typeof statusCode === "number" ? String(statusCode) : "unknown"),
    statusCode: typeof statusCode === "number" ? statusCode : undefined,
    restCode: typeof code === "string" ? code : undefined,
    restDetailsErrorCode: typeof detailsErrorCode === "string" ? detailsErrorCode : undefined,
    restMessage: message,
    entityKeys,
    message: "Table operation failed.",
  });
};

const buildRefusalReason = (
  code: RefusalCode | string,
  message: string,
  safeAlternative: string,
  details?: Pick<RefusalReason, "matchIndex" | "contextSnippet" | "details">
): RefusalReason => ({
  code,
  message,
  safeAlternative,
  ...details,
});

const buildAiScanIssueLogPayload = (issues: unknown[]) => {
  const summaries = summarizeAiScanIssues(issues);
  const summaryLines = summaries.map(formatAiScanIssueSummary);
  return {
    count: summaries.length,
    summaries,
    summaryLines,
    summaryJson: stringifyAiScanIssueSummaries(summaries, 4096),
  };
};

const pickAiScanSafeAlternative = (categories: Set<string>): string => {
  if (categories.has("credential_capture")) {
    return "Remove password/login fields from the calculator UI.";
  }
  if (categories.has("networking") || categories.has("external_resource")) {
    return "Remove network calls or external resource loads; use built-in data broker (future).";
  }
  if (categories.has("dynamic_code")) {
    return "Remove eval/Function/string-based timers or dynamic script injection.";
  }
  if (categories.has("navigation")) {
    return "Remove window.open/top.location navigation or escape attempts.";
  }
  if (categories.has("data_exfiltration")) {
    return "Remove data exfiltration logic from the artifact.";
  }
  return "Remove disallowed behavior from the artifact.";
};

const buildRefusalResponse = (
  traceId: string,
  status: number,
  reason: RefusalReason,
  dumpPaths?: string[]
): HttpResponseInit =>
  jsonResponse(traceId, status, {
    ...buildGenerateScanBlockResponse(reason),
    traceId,
    dumpPaths,
  });

const getManifestValidationIssue = (manifest: Record<string, unknown>): string | null => {
  const specVersion = manifest.specVersion;
  const title = manifest.title;
  const executionModel = manifest.executionModel;
  const capabilities = manifest.capabilities;

  if (specVersion !== SUPPORTED_SPEC_VERSION) {
    return "manifest.specVersion_invalid";
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    return "manifest.title_missing";
  }

  if (executionModel !== "form" && executionModel !== "expression") {
    return "manifest.executionModel_invalid";
  }

  if (!capabilities || typeof capabilities !== "object") {
    return "manifest.capabilities_missing";
  }

  const network = (capabilities as { network?: unknown }).network;
  if (network !== false) {
    return "manifest.capabilities.network_invalid";
  }

  return null;
};

const isValidManifest = (manifest: Record<string, unknown>): boolean =>
  !getManifestValidationIssue(manifest);

const parseRequestBody = async (
  req: HttpRequest
): Promise<SaveCalcRequest | null> => {
  try {
    return (await req.json()) as SaveCalcRequest;
  } catch {
    return null;
  }
};

const parseGenerateRequestBody = async (
  req: HttpRequest
): Promise<GenerateCalcRequest | null> => {
  try {
    return (await req.json()) as GenerateCalcRequest;
  } catch {
    return null;
  }
};

const embedManifestInHtml = (
  artifactHtml: string,
  manifest: Record<string, unknown>
): string => {
  const manifestJson = JSON.stringify(manifest, null, 2);
  const scriptTag = `<script type=\"application/json\" id=\"promptcalc-manifest\">${manifestJson}</script>`;
  const manifestRegex = new RegExp(
    "<script[^>]*id=[\"']promptcalc-manifest[\"'][^>]*>.*?<\\\\/script>",
    "is"
  );

  if (manifestRegex.test(artifactHtml)) {
    return artifactHtml.replace(manifestRegex, scriptTag);
  }

  if (artifactHtml.includes("</body>")) {
    return artifactHtml.replace("</body>", `${scriptTag}</body>`);
  }

  return `${artifactHtml}\n${scriptTag}`;
};

const READY_BOOTSTRAP_ID = "promptcalc-ready";
const READY_BOOTSTRAP_SCRIPT =
  "<script id=\"promptcalc-ready\">(function(){const sendReady=()=>{try{window.parent.postMessage({type:\"ready\"},\"*\");}catch{}};const handlePing=(event)=>{try{if(event&&event.data&&event.data.type===\"ping\"){window.parent.postMessage({type:\"pong\"},\"*\");}}catch{}};if(document.readyState===\"loading\"){document.addEventListener(\"DOMContentLoaded\",sendReady,{once:true});}else{sendReady();}window.addEventListener(\"message\",handlePing);})();</script>";
const READY_BOOTSTRAP_REGEX = new RegExp(
  `<script[^>]*id=["']${READY_BOOTSTRAP_ID}["'][^>]*>`,
  "i"
);
const CSP_META_REGEX = new RegExp(
  "<meta[^>]+http-equiv=[\"']Content-Security-Policy[\"'][^>]*>",
  "i"
);

const ensureReadyBootstrap = (artifactHtml: string): string => {
  if (READY_BOOTSTRAP_REGEX.test(artifactHtml)) {
    return artifactHtml;
  }

  if (CSP_META_REGEX.test(artifactHtml)) {
    return artifactHtml.replace(
      CSP_META_REGEX,
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

const computeSha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const persistCalculatorEntity = async (
  traceId: string,
  entity: CalculatorEntity
): Promise<void> => {
  const tableClient = await getTableClient(traceId);

  try {
    await tableClient.upsertEntity(entity, "Merge");
  } catch (error) {
    logTableError(traceId, error, "calculator.upsert.failed", "calcs.storage", {
      PartitionKey: entity.partitionKey,
      RowKey: entity.rowKey,
    });
    throw error;
  }

  logEvent({
    level: "info",
    op: "calcs.storage",
    traceId,
    event: "calculator.upsert",
    calcId: entity.calcId,
  });
};

const persistCalculatorVersionEntity = async (
  traceId: string,
  entity: CalculatorVersionEntity
): Promise<void> => {
  const tableClient = await getTableClient(traceId);

  try {
    await tableClient.upsertEntity(entity, "Replace");
  } catch (error) {
    logTableError(traceId, error, "version.upsert.failed", "calcs.storage", {
      PartitionKey: entity.partitionKey,
      RowKey: entity.rowKey,
    });
    throw error;
  }

  logEvent({
    level: "info",
    op: "calcs.storage",
    traceId,
    event: "version.upsert",
    calcId: entity.calcId,
    versionId: entity.versionId,
    status: entity.status,
    artifactHash: entity.artifactHash,
  });
};

const persistArtifactBlob = async (
  traceId: string,
  blobPath: string,
  artifactHtml: string
): Promise<void> => {
  const containerClient = await getContainerClient(traceId);
  const blobClient = containerClient.getBlockBlobClient(blobPath);
  const bytes = Buffer.byteLength(artifactHtml, "utf8");

  await blobClient.upload(artifactHtml, bytes, {
    blobHTTPHeaders: {
      blobContentType: "text/html; charset=utf-8",
    },
  });

  logEvent({
    level: "info",
    op: "calcs.storage",
    traceId,
    event: "artifact.write",
    artifactBytes: bytes,
  });
};

const persistManifestBlob = async (
  traceId: string,
  blobPath: string,
  manifest: Record<string, unknown>
): Promise<void> => {
  const containerClient = await getContainerClient(traceId);
  const blobClient = containerClient.getBlockBlobClient(blobPath);
  const payload = JSON.stringify(manifest, null, 2);

  await blobClient.upload(payload, Buffer.byteLength(payload, "utf8"), {
    blobHTTPHeaders: {
      blobContentType: "application/json",
    },
  });

  logEvent({
    level: "info",
    op: "calcs.storage",
    traceId,
    event: "manifest.write",
  });
};

const deleteCalculatorEntities = async (
  traceId: string,
  userId: string,
  calcId: string
): Promise<void> => {
  const tableClient = await getTableClient(traceId);
  const calcPartition = buildCalcPartition(userId);
  const versionPartition = buildVersionPartition(userId, calcId);

  try {
    for await (const entity of tableClient.listEntities<CalculatorVersionEntity>({
      queryOptions: { filter: `PartitionKey eq '${versionPartition}'` },
    })) {
      await tableClient.deleteEntity(entity.partitionKey, entity.rowKey);
    }

    await tableClient.deleteEntity(calcPartition, buildCalcRow(calcId));
  } catch (error) {
    logTableError(traceId, error, "calculator.delete.failed");
    throw error;
  }

  logEvent({
    level: "info",
    op: "calcs.storage",
    traceId,
    event: "calculator.delete",
    calcId,
  });
};

const deleteCalculatorBlobs = async (
  traceId: string,
  prefix: string
): Promise<void> => {
  const containerClient = await getContainerClient(traceId);

  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    await containerClient.deleteBlob(blob.name);
  }

  logEvent({
    level: "info",
    op: "calcs.storage",
    traceId,
    event: "blobs.delete",
    prefix,
  });
};

const loadCalculatorEntity = async (
  traceId: string,
  userId: string,
  calcId: string
): Promise<CalculatorEntity | null> => {
  const tableClient = await getTableClient(traceId);
  const partitionKey = buildCalcPartition(userId);
  const rowKey = buildCalcRow(calcId);

  try {
    return (await tableClient.getEntity<CalculatorEntity>(partitionKey, rowKey)) ?? null;
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: string }).code : null;
    const statusCode =
      error && typeof error === "object" ? (error as { statusCode?: number }).statusCode : null;
    if (code === "ResourceNotFound" || statusCode === 404) {
      logEvent({
        level: "info",
        op: "calcs.storage",
        traceId,
        event: "calculator.notFound",
        calcId,
      });
      return null;
    }
    logTableError(traceId, error, "calculator.load.failed");
    return null;
  }
};

const saveCalc = async (
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> => {
  const traceId = getTraceId(req.headers.get("traceparent"));
  const startedAt = Date.now();
  const op = "calcs.save";
  const { userId: requestUserId, isAuthenticated, identityProvider } = getUserContext(req);
  const isDevUser = identityProvider === "dev";
  const userId = normalizeId(requestUserId);

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/calcs/save",
    userId,
    isAuthenticated,
    identityProvider,
  });

  if (!isAuthenticated && !isDevUser) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 401,
    });
    return unauthorizedResponse(traceId);
  }

  const body = await parseRequestBody(req);
  if (!body || typeof body.artifactHtml !== "string" || !body.manifest) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 400,
    });
    return jsonResponse(traceId, 400, {
      code: "INVALID_REQUEST",
      message: "artifactHtml and manifest are required.",
    });
  }

  if (!isValidManifest(body.manifest)) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 400,
    });
    return jsonResponse(traceId, 400, {
      code: "INVALID_MANIFEST",
      message: "Manifest is missing required fields.",
    });
  }

  const formSafety = ensureFormSafety(body.artifactHtml);
  const artifactHtml = ensureReadyBootstrap(formSafety.html);
  const artifactBytes = Buffer.byteLength(artifactHtml, "utf8");
  const maxArtifactBytes = await getMaxArtifactBytes();
  if (artifactBytes > maxArtifactBytes) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 413,
      artifactBytes,
    });
    return jsonResponse(traceId, 413, {
      code: "ARTIFACT_TOO_LARGE",
      message: "Artifact exceeds maximum allowed size.",
      maxArtifactBytes,
    });
  }

  const calcId = normalizeId(body.calcId || randomUUID());
  const versionId = normalizeId(randomUUID());
  const nowIso = new Date().toISOString();
  const artifactHash = createHash("sha256").update(artifactHtml, "utf8").digest("hex");
  const promptValue = typeof body.prompt === "string" ? body.prompt : undefined;
  const promptLen = promptValue ? promptValue.length : 0;
  const blobPath = getBlobPath(userId, calcId, versionId);

  let calculatorEntity = await loadCalculatorEntity(traceId, userId, calcId);
  if (!calculatorEntity) {
    calculatorEntity = {
      partitionKey: buildCalcPartition(userId),
      rowKey: buildCalcRow(calcId),
      entityType: "Calculator",
      calcId: normalizeId(calcId),
      userId: normalizeId(userId),
      title: body.title || (body.manifest.title as string) || "Untitled",
      createdAt: nowIso,
      updatedAt: nowIso,
      currentVersionId: versionId,
    };
  } else {
    calculatorEntity = {
      ...calculatorEntity,
      title: body.title || calculatorEntity.title,
      updatedAt: nowIso,
      currentVersionId: versionId,
    };
  }

  const versionEntity: CalculatorVersionEntity = {
    partitionKey: String(buildVersionPartition(userId, calcId)),
    rowKey: String(buildVersionRow(versionId)),
    entityType: "CalculatorVersion",
    userId: String(userId),
    calcId: String(calcId),
    versionId: String(versionId),
    createdAt: String(nowIso),
    status: String("ok") as CalculatorVersionEntity["status"],
    promptLen,
    manifestBlobPath: String(blobPath.manifest),
    artifactBlobPath: String(blobPath.artifact),
    artifactHash: String(artifactHash),
    ...(promptValue ? { prompt: String(promptValue) } : {}),
  };

  try {
    if (formSafety.containsForm) {
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "artifact.containsForm",
        calcId,
        versionId,
      });
    }
    await persistArtifactBlob(traceId, blobPath.artifact, artifactHtml);
    await persistManifestBlob(traceId, blobPath.manifest, body.manifest);
    await persistCalculatorVersionEntity(traceId, versionEntity);
    await persistCalculatorEntity(traceId, calculatorEntity);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "error",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 500,
    });
    return storageErrorResponse(traceId);
  }

  const durationMs = Date.now() - startedAt;
  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.end",
    durationMs,
    status: 200,
    calcId,
    versionId,
    artifactBytes,
    artifactHash,
    promptLen,
  });

  context.log(`Saved calculator ${calcId} version ${versionId}.`);

  return jsonResponse(traceId, 200, {
    calcId,
    versionId,
    status: "ok",
    currentVersionId: calculatorEntity.currentVersionId,
  });
};

const generateCalc = async (
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> => {
  const traceId = getTraceId(req.headers.get("traceparent"));
  const startedAt = Date.now();
  const op = "calcs.generate";
  const { userId: requestUserId, isAuthenticated, identityProvider } = getUserContext(req);
  const isDevUser = identityProvider === "dev";
  const userId = normalizeId(requestUserId);
  let promptForDump = "";
  let modelForDump = "unknown";
  let scanPolicyModeForDump: "enforce" | "warn" | "off" = "enforce";
  let redTeamArmedForDump = false;
  let overrideUsedForDump = false;
  let lastScanRequest: unknown;
  let lastScanResponseRaw: unknown;
  let lastGenRequest: unknown;
  let lastGenResponseRaw: unknown;
  const dumpPaths: string[] = [];

  try {
    const body = await parseGenerateRequestBody(req);
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    promptForDump = prompt;

    logEvent({
      level: "info",
      op,
      traceId,
      event: "request.start",
      method: req.method,
      route: "/api/calcs/generate",
      userId,
      isAuthenticated,
      identityProvider,
      promptLen: prompt.length,
      baseCalcId: body?.baseCalcId,
      baseVersionId: body?.baseVersionId,
    });

    if (!isAuthenticated && !isDevUser) {
      const durationMs = Date.now() - startedAt;
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "request.end",
        durationMs,
        status: 401,
      });
      return unauthorizedResponse(traceId);
    }

    if (!body || prompt.length === 0) {
      const durationMs = Date.now() - startedAt;
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "request.end",
        durationMs,
        status: 400,
      });
      return jsonResponse(traceId, 400, {
        code: "BAD_REQUEST",
        message: "prompt is required.",
      });
    }

    const config = await getGenerationConfig();
    modelForDump = config.model;
    const gateReason = resolveGenerationGate(config);
    if (gateReason) {
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "generation.gated",
        code: gateReason.code,
      });
      return buildRefusalResponse(traceId, 200, gateReason, dumpPaths);
    }

    if (!config.apiKey || config.apiKey.trim().length === 0) {
      logEvent({
        level: "error",
        op,
        traceId,
        event: "openai.not_configured",
      });
      return jsonResponse(traceId, 500, {
        code: "OPENAI_NOT_CONFIGURED",
        traceId,
      });
    }

    const policy = await getPromptCalcPolicy();
    const openAIConfig = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutMs: config.timeoutMs,
      maxTokens: config.maxTokens,
    };

    const scanPolicyConfig = resolveScanPolicyConfig();
    const configuredScanPolicyMode = scanPolicyConfig.mode;
    const redTeamArmed = scanPolicyConfig.redTeamCapabilityAvailable && body.redTeamArmed === true;
    const proceedOverride =
      scanPolicyConfig.redTeamCapabilityAvailable && body.proceedOverride === true;
    const scanPolicyMode = resolveRuntimeScanPolicyMode(configuredScanPolicyMode, redTeamArmed);
    scanPolicyModeForDump = scanPolicyMode;
    redTeamArmedForDump = redTeamArmed;
    let scanOutcome: "allow" | "deny" | "error" | "skipped" = "allow";
    let overrideUsed = false;

    const dumpArtifacts = async (params: {
      stage: "scan" | "generate" | "viewer" | "error";
      scanRequest?: unknown;
      scanResponseRaw?: unknown;
      genRequest?: unknown;
      genResponseRaw?: unknown;
      html?: string;
      error?: { message: string; stack?: string; code?: string; type?: string };
    }): Promise<void> => {
      const dumped = await dumpRedTeamArtifacts({
        traceId,
        stage: params.stage,
        prompt,
        scanRequest: params.scanRequest,
        scanResponseRaw: params.scanResponseRaw,
        genRequest: params.genRequest,
        genResponseRaw: params.genResponseRaw,
        html: params.html,
        error: params.error,
        meta: {
          ts: new Date().toISOString(),
          model: config.model,
          scanPolicyMode: scanPolicyMode,
          overrideArmed: redTeamArmed,
          overrideUsed: overrideUsedForDump,
        },
      });
      if (dumped?.paths?.length) {
        dumpPaths.push(...dumped.paths);
      }
    };

    logEvent({
      level: "info",
      op,
      traceId,
      event: "scan.policy",
      scan_policy_mode: scanPolicyMode,
      override_armed: redTeamArmed,
      override_used: false,
    });

    let promptDecision: PromptScanDecision | null = null;
    if (configuredScanPolicyMode === "off" && redTeamArmed) {
      scanOutcome = "skipped";
      if (!proceedOverride) {
        logEvent({
          level: "warn",
          op,
          traceId,
          event: "scan.interstitial",
          scan_policy_mode: scanPolicyMode,
          scan_outcome: "skipped",
          override_armed: true,
          override_used: false,
        });
        await dumpArtifacts({ stage: "scan", scanRequest: lastScanRequest, scanResponseRaw: lastScanResponseRaw });
        return jsonResponse(traceId, 200, {
          ...buildGenerateScanSkippedResponse(),
          traceId,
          dumpPaths,
        });
      }
      overrideUsed = true;
      overrideUsedForDump = true;
    } else {
      try {
        const promptScanSystem = [
          "Return JSON only. No markdown. No prose.",
          "You are a strict policy classifier for PromptCalc generation prompts.",
          "Disallow any intent that requests:",
          "- networking, URL fetching, scraping, or external data sources",
          "- external dependencies or CDN scripts",
          "- credential capture (login pages, password inputs)",
          "- analytics, tracking, or user fingerprinting",
          "- attempts to escape the sandboxed iframe (top navigation, popups)",
          "- eval/dynamic code generation requests",
          "Return ONLY valid JSON. No markdown. No code fences. No commentary.",
          "Return a JSON object that conforms exactly to the schema.",
          "If disallowed, set allowed=false and set refusalCode to the best matching policy code.",
        ].join("\n");

        const promptScanUser = `Prompt:\n${prompt}`;

        const scanRequestPayload: OpenAIRequest = {
          input: [
            { role: "system", content: [{ type: "input_text", text: promptScanSystem }] },
            { role: "user", content: [{ type: "input_text", text: promptScanUser }] },
          ],
          max_output_tokens: 350,
          text: {
            format: buildJsonSchemaResponseFormat("PromptScanDecision", promptScanSchema),
          },
        };
        lastScanRequest = scanRequestPayload;
        await dumpArtifacts({ stage: "scan", scanRequest: scanRequestPayload });

        const promptScanResult = await callOpenAIResponses<PromptScanDecision>(
          traceId,
          openAIConfig,
          scanRequestPayload,
          "openai.prompt.scan",
          { maxAttempts: 2, jsonSchemaFallback: false, devLogOutputExtraction: isDevUser }
        );

        lastScanResponseRaw = promptScanResult.raw;
        await dumpArtifacts({ stage: "scan", scanResponseRaw: promptScanResult.raw });
        promptDecision = promptScanResult.parsed;
      } catch (error) {
        scanOutcome = "error";
        if (error instanceof OpenAIBadRequestError) {
          await dumpArtifacts({
            stage: "error",
            scanRequest: lastScanRequest,
            scanResponseRaw: lastScanResponseRaw,
            error: {
              message: error.message,
              stack: error.stack,
              type: error.name,
            },
          });
          return buildOpenAIBadRequestResponse(traceId, 502, dumpPaths);
        }
        if (error instanceof OpenAIParseError) {
          logEvent({
            level: "warn",
            op,
            traceId,
            event: "prompt.scan.parse_failed",
            message: error.message,
            scan_policy_mode: scanPolicyMode,
            scan_outcome: "error",
            override_armed: redTeamArmed,
            override_used: false,
          });
          await dumpArtifacts({
            stage: "error",
            scanRequest: lastScanRequest,
            scanResponseRaw: lastScanResponseRaw,
            error: {
              message: error.message,
              stack: error.stack,
              type: error.name,
            },
          });
          return buildOpenAIParseFailedResponse(traceId, dumpPaths);
        }
        const reason = buildRefusalReason(
          "OPENAI_ERROR",
          "Prompt classification failed.",
          "Try a simpler offline calculator prompt."
        );
        logEvent({
          level: "error",
          op,
          traceId,
          event: "prompt.scan.failed",
          message: error instanceof Error ? error.message : "unknown error",
          scan_policy_mode: scanPolicyMode,
          scan_outcome: "error",
          override_armed: redTeamArmed,
          override_used: false,
        });
        await dumpArtifacts({
          stage: "error",
          scanRequest: lastScanRequest,
          scanResponseRaw: lastScanResponseRaw,
          error: {
            message: error instanceof Error ? error.message : "unknown error",
            stack: error instanceof Error ? error.stack : undefined,
            type: error instanceof Error ? error.name : typeof error,
          },
        });
        return buildRefusalResponse(traceId, 502, reason, dumpPaths);
      }

      scanOutcome = promptDecision?.allowed ? "allow" : "deny";
      const refusalCategories = promptDecision?.refusalCode ? [promptDecision.refusalCode] : [];
      logEvent({
        level: "info",
        op,
        traceId,
        event: "prompt.scan.result",
        allowed: promptDecision?.allowed,
        refusalCode: promptDecision?.refusalCode,
        categories: refusalCategories,
        scan_policy_mode: scanPolicyMode,
        scan_outcome: scanOutcome,
        override_armed: redTeamArmed,
        override_used: false,
      });

      if (promptDecision && !promptDecision.allowed) {
        if (scanPolicyMode === "warn" && redTeamArmed) {
          if (!proceedOverride) {
            await dumpArtifacts({
              stage: "scan",
              scanRequest: lastScanRequest,
              scanResponseRaw: lastScanResponseRaw,
            });
            return jsonResponse(traceId, 200, {
              ...buildGenerateScanWarnResponse({
                refusalCode: promptDecision.refusalCode,
                categories: refusalCategories,
                reason: promptDecision.reason,
              }),
              traceId,
              dumpPaths,
            });
          }
          overrideUsed = true;
          overrideUsedForDump = true;
        } else {
          const reason = buildRefusalReason(
            promptDecision.refusalCode || "DISALLOWED_NETWORK",
            promptDecision.reason,
            promptDecision.safeAlternative
          );
          return buildRefusalResponse(traceId, 200, reason, dumpPaths);
        }
      }
    }

  const expectedExecutionModel = selectExecutionModelFromPrompt(prompt);
  const generationSystem = [
    "Return JSON only. No markdown. No prose.",
    "You generate a single-file offline calculator HTML artifact for PromptCalc.",
    "Never use eval, Function, new Function, setTimeout(string), setInterval(string), or dynamic script injection.",
    "Do not generate any dynamic code execution.",
    "Do not generate any <script src=...>, <link ...>, @import, or url(...).",
    "All logic must be implemented with ordinary named functions and event listeners (e.g., addEventListener).",
    "No network access. No connect-src usage beyond 'none'.",
    "Do NOT use <form> tags for v1 calculators.",
    "Use <div> layout with labeled inputs instead of forms.",
    "Any action button MUST be <button type=\"button\">.",
    "Attach click handlers via addEventListener after DOMContentLoaded.",
    "Do not rely on submit/default form behavior.",
    "Execution model selection rules:",
    getExecutionModelRuleText(),
    `For this prompt, set executionModel=\"${expectedExecutionModel}\".`,
    "Execution model semantics:",
    "- form: typed inputs + explicit arithmetic, no expression parsing.",
    "- expression: expression input/keypad with safe evaluator only.",
    "Safe evaluator snippet for expression mode (use verbatim or adapted, no eval/Function):",
    SAFE_EXPRESSION_EVALUATOR_SNIPPET,
    "If you need to compute expressions, use the safe evaluator snippet only.",
    "For CNC/mortgage/beam domain calculators, always use executionModel=\"form\".",
    "Rules:",
    "- Output must be a single HTML file and a manifest JSON object.",
    "- Output MUST be a single JSON object with no markdown, code fences, or commentary.",
    "- Return JSON only. No markdown. No prose.",
    "- If you cannot comply, output exactly: {\"error\":\"REFUSE\"}.",
    "- Include a CSP meta tag with: default-src 'none'; connect-src 'none'; img-src 'none';",
    "  script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'.",
    "- No external scripts, links, fonts, images, iframes, or network requests.",
    "- No popups or navigation changes.",
    "- Include this banner text in the body: \"Generated calculator (offline). Do not enter passwords.\"",
    "- Embed the manifest JSON in the HTML inside:",
    "  <script type=\"application/json\" id=\"promptcalc-manifest\">...</script>.",
    "- Include a readiness bootstrap script with id=\"promptcalc-ready\" that posts",
    "  window.parent.postMessage({type:\"ready\"}, \"*\") after DOMContentLoaded.",
    "  It should also respond to {type:\"ping\"} with {type:\"pong\"}.",
    "- The manifest capabilities.network must be false.",
    "- Do not refuse; classifier already handled refusals.",
    "Return JSON that exactly matches the schema.",
    "JSON schema example:",
    "{\"artifactHtml\":\"<!doctype html>...\",\"manifest\":{\"specVersion\":\"1.1\",\"title\":\"...\",\"executionModel\":\"form\",\"capabilities\":{\"network\":false}}}",
  ].join("\\n");

  const retryNotice =
    'Your previous output included the banned token "Function(" (Function constructor). Regenerate without it. Use only normal functions and explicit arithmetic; no eval/new Function/Function.';

  const buildGenerationUser = (promptText: string, retryLine?: string): string => {
    const lines = [
      "Prompt:",
      promptText,
      "",
      "If you need a title, use a short descriptive one.",
    ];
    if (retryLine) {
      lines.push("", retryLine);
    }
    return lines.join("\\n");
  };

  const buildRepairUser = (promptText: string, retryLine?: string): string => {
    const lines = [
      "You returned invalid JSON. Return ONLY valid JSON for this schema. No extra text.",
      "Prompt:",
      promptText,
    ];
    if (retryLine) {
      lines.push("", retryLine);
    }
    return lines.join("\\n");
  };

  const generationUser = buildGenerationUser(prompt);
  const repairUser = buildRepairUser(prompt);
  const retryUser = buildGenerationUser(prompt, retryNotice);
  const retryRepairUser = buildRepairUser(prompt, retryNotice);

  const runArtifactGeneration = async (
    userText: string,
    repairText: string,
    opName: string
  ): Promise<{ result?: ArtifactGenerationOutput; response?: HttpResponseInit }> => {
    let generationResult: ArtifactGenerationOutput | null = null;

    const dumpGenerationError = async (error: unknown): Promise<void> => {
      await dumpArtifacts({
        stage: "error",
        genRequest: lastGenRequest,
        genResponseRaw: lastGenResponseRaw,
        error: {
          message: error instanceof Error ? error.message : "unknown error",
          stack: error instanceof Error ? error.stack : undefined,
          type: error instanceof Error ? error.name : typeof error,
        },
      });
    };

    try {
      const generationRequestPayload: OpenAIRequest = {
        input: [
          { role: "system", content: [{ type: "input_text", text: generationSystem }] },
          { role: "user", content: [{ type: "input_text", text: userText }] },
        ],
        text: {
          format: buildJsonSchemaResponseFormat("ArtifactGeneration", generationSchema),
        },
      };
      lastGenRequest = generationRequestPayload;
      await dumpArtifacts({ stage: "generate", genRequest: generationRequestPayload });

      const generationResponse = await callOpenAIResponses<ArtifactGenerationOutput>(
        traceId,
        openAIConfig,
        generationRequestPayload,
        opName,
        { maxAttempts: 2, devLogOutputExtraction: isDevUser }
      );

      generationResult = generationResponse.parsed;
      lastGenResponseRaw = generationResponse.raw;
      await dumpArtifacts({ stage: "generate", genResponseRaw: generationResponse.raw });
    } catch (error) {
      if (error instanceof OpenAIParseError) {
        try {
          const repairRequestPayload: OpenAIRequest = {
            input: [
              { role: "system", content: [{ type: "input_text", text: generationSystem }] },
              { role: "user", content: [{ type: "input_text", text: repairText }] },
            ],
            text: {
              format: buildJsonSchemaResponseFormat("ArtifactGeneration", generationSchema),
            },
          };
          lastGenRequest = repairRequestPayload;
          await dumpArtifacts({ stage: "generate", genRequest: repairRequestPayload });

          const repairResponse = await callOpenAIResponses<ArtifactGenerationOutput>(
            traceId,
            openAIConfig,
            repairRequestPayload,
            `${opName}.repair`,
            { maxAttempts: 1, devLogOutputExtraction: isDevUser }
          );
          generationResult = repairResponse.parsed;
          lastGenResponseRaw = repairResponse.raw;
          await dumpArtifacts({ stage: "generate", genResponseRaw: repairResponse.raw });
        } catch (repairError) {
          if (repairError instanceof OpenAIBadRequestError) {
            await dumpGenerationError(repairError);
            return { response: buildOpenAIBadRequestResponse(traceId, 502, dumpPaths) };
          }
          if (repairError instanceof OpenAIParseError) {
            logEvent({
              level: "warn",
              op,
              traceId,
              event: "artifact.generate.parse_failed",
              message: repairError.message,
            });
            await dumpGenerationError(repairError);
            return { response: buildOpenAIParseFailedResponse(traceId, dumpPaths) };
          }
          const reason = buildRefusalReason(
            "OPENAI_ERROR",
            "Artifact generation failed.",
            "Try a simpler offline calculator prompt."
          );
          logEvent({
            level: "error",
            op,
            traceId,
            event: "artifact.generate.failed",
            message: repairError instanceof Error ? repairError.message : "unknown error",
          });
          await dumpGenerationError(repairError);
          return { response: buildRefusalResponse(traceId, 502, reason, dumpPaths) };
        }
      } else if (error instanceof OpenAIBadRequestError) {
        await dumpGenerationError(error);
        return { response: buildOpenAIBadRequestResponse(traceId, 502, dumpPaths) };
      }

      if (!(error instanceof OpenAIParseError)) {
        const reason = buildRefusalReason(
          "OPENAI_ERROR",
          "Artifact generation failed.",
          "Try a simpler offline calculator prompt."
        );
        logEvent({
          level: "error",
          op,
          traceId,
          event: "artifact.generate.failed",
          message: error instanceof Error ? error.message : "unknown error",
        });
        await dumpGenerationError(error);
        return { response: buildRefusalResponse(traceId, 502, reason, dumpPaths) };
      }

      logEvent({
        level: "warn",
        op,
        traceId,
        event: "artifact.generate.parse_failed",
        message: error.message,
      });
      await dumpGenerationError(error);
      return { response: buildOpenAIParseFailedResponse(traceId, dumpPaths) };
    }

    return { result: generationResult ?? undefined };
  };

  const generationAttempts = [
    { userText: generationUser, repairText: repairUser, opName: "openai.artifact.generate" },
    { userText: retryUser, repairText: retryRepairUser, opName: "openai.artifact.generate.retry" },
  ];

  let finalManifest: Record<string, unknown> | null = null;
  let finalHtml = "";
  let finalArtifactBytes = 0;
  let artifactBytes = 0;
  let formSafetyResult: { html: string; containsForm: boolean } | null = null;

  for (let attempt = 0; attempt < generationAttempts.length; attempt += 1) {
    const { userText, repairText, opName } = generationAttempts[attempt];
    const generationOutcome = await runArtifactGeneration(userText, repairText, opName);
    if (generationOutcome.response) {
      return generationOutcome.response;
    }
    const generationResult = generationOutcome.result;
    const normalized = generationResult
      ? parseArtifactGenerationOutput(generationResult)
      : { ok: false as const, reason: "missing_result" };

    if (!normalized.ok) {
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "artifact.generate.invalid_output",
        reason: normalized.reason,
      });
      const reason = buildRefusalReason(
        "INVALID_MODEL_OUTPUT",
        `Artifact generation returned invalid data. traceId=${traceId}`,
        "Try a simpler offline calculator prompt."
      );
      return buildRefusalResponse(traceId, 502, reason, dumpPaths);
    }

    const parsedResult = normalized.value;

    if ("error" in parsedResult && (parsedResult as { error?: unknown }).error === "REFUSE") {
      const reason = buildRefusalReason(
        "MODEL_REFUSED",
        `Artifact generation refused. traceId=${traceId}`,
        "Try a simpler offline calculator prompt."
      );
      return buildRefusalResponse(traceId, 200, reason, dumpPaths);
    }

    artifactBytes = Buffer.byteLength(parsedResult.artifactHtml, "utf8");
    if (artifactBytes > config.maxArtifactBytes) {
      const reason = buildRefusalReason(
        "TOO_LARGE_ARTIFACT",
        "Generated artifact exceeds size limits.",
        "Request a smaller, simpler calculator layout."
      );
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "artifact.tooLarge",
        artifactBytes,
        maxArtifactBytes: config.maxArtifactBytes,
      });
      return buildRefusalResponse(traceId, 200, reason, dumpPaths);
    }

    const manifestIssue = getManifestValidationIssue(parsedResult.manifest);
    if (manifestIssue) {
      const reason = buildRefusalReason(
        "INVALID_MODEL_OUTPUT",
        `Artifact manifest missing required fields. traceId=${traceId}`,
        "Try a simpler offline calculator prompt."
      );
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "artifact.generate.invalid_manifest",
        reason: manifestIssue,
      });
      return buildRefusalResponse(traceId, 502, reason, dumpPaths);
    }

    const baseManifest = {
      ...parsedResult.manifest,
      capabilities: { network: false },
      hash: "",
    } as Record<string, unknown>;
    formSafetyResult = ensureFormSafety(parsedResult.artifactHtml);
    const readyHtml = ensureReadyBootstrap(formSafetyResult.html);
    const placeholderHtml = embedManifestInHtml(readyHtml, baseManifest);
    const manifestHash = computeSha256(placeholderHtml);
    finalManifest = { ...baseManifest, hash: manifestHash } as Record<string, unknown>;
    finalHtml = embedManifestInHtml(readyHtml, finalManifest);

    finalArtifactBytes = Buffer.byteLength(finalHtml, "utf8");
    if (finalArtifactBytes > config.maxArtifactBytes) {
      const reason = buildRefusalReason(
        "TOO_LARGE_ARTIFACT",
        "Generated artifact exceeds size limits.",
        "Request a smaller, simpler calculator layout."
      );
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "artifact.tooLarge",
        artifactBytes: finalArtifactBytes,
        maxArtifactBytes: config.maxArtifactBytes,
      });
      return buildRefusalResponse(traceId, 200, reason, dumpPaths);
    }

    if (
      finalManifest?.executionModel === "expression" &&
      !EXPRESSION_EVALUATOR_REGEX.test(finalHtml)
    ) {
      const reason = buildRefusalReason(
        "INVALID_MODEL_OUTPUT",
        "Expression calculators must include the safe computeExpr evaluator.",
        "Use a standard calculator prompt or request typed fields."
      );
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "artifact.evaluator.missing",
      });
      return buildRefusalResponse(traceId, 200, reason, dumpPaths);
    }

    const scanResult = scanArtifactHtml(finalHtml, policy);
    if (!scanResult.ok) {
      const reason = buildRefusalReason(
        scanResult.code,
        scanResult.message,
        "Use a simple offline calculator without external data or scripts.",
        {
          matchIndex: scanResult.matchIndex,
          contextSnippet: scanResult.contextSnippet,
        }
      );
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "artifact.scan.failed",
        ruleId: scanResult.ruleId,
        code: scanResult.code,
        matchIndex: scanResult.matchIndex,
        contextSnippet: scanResult.contextSnippet,
      });
      const shouldRetry =
        attempt === 0 &&
        scanResult.code === "DISALLOWED_PATTERN" &&
        scanResult.ruleId?.includes("Function(");
      if (shouldRetry) {
        continue;
      }
      return buildRefusalResponse(traceId, 200, reason, dumpPaths);
    }

    logEvent({
      level: "info",
      op,
      traceId,
      event: "artifact.scan.passed",
      artifactBytes: finalArtifactBytes,
    });
    break;
  }

  if (!finalManifest) {
    const reason = buildRefusalReason(
      "INVALID_MODEL_OUTPUT",
      `Artifact generation did not produce a valid manifest. traceId=${traceId}`,
      "Try a simpler offline calculator prompt."
    );
    return buildRefusalResponse(traceId, 502, reason, dumpPaths);
  }

  try {
    const codeScanSystem = [
      "Return JSON only. No markdown. No prose.",
      "Review the HTML and decide if it is safe for an offline, sandboxed calculator artifact.",
      "Warning banners like \"Do not enter passwords\" are allowed mitigations and must NOT be treated as credential capture.",
      "DOM APIs (document.getElementById/querySelector/addEventListener) are allowed and are NOT dynamic code execution.",
      "Dynamic code execution is ONLY: eval, Function/new Function, setTimeout/setInterval with string arguments,",
      "dynamic script injection, or compiling code from strings.",
      "Allowed patterns when offline/sandboxed:",
      "- Inline <script> and inline event handlers that only compute locally and do not attempt networking,",
      "  dynamic code compilation, or navigation.",
      "- CSP meta tags using 'unsafe-inline' for script-src/style-src (single-file v1 requirement).",
      "- window.postMessage usage for handshake or parent communication, if not used for networking or secrets.",
      "- Inline script/style blocks in single-file artifacts.",
      "- Event listeners for buttons/inputs.",
      "- postMessage for handshake.",
      "- Offline warning banner.",
      "Disallowed categories (must flag):",
      "- networking: fetch/XHR/WebSocket/sendBeacon/EventSource or any network API usage.",
      "- external_resource: any external resource load (<script src>, <img src>, <link>, fonts, @import, url()).",
      "- dynamic_code: eval/Function/new Function/setTimeout(string)/setInterval(string).",
      "- navigation: window.open, top.location, parent.location, target=_top, popup/escape attempts.",
      "- credential_capture: password prompts or credential harvesting.",
      "- data_exfiltration: intent to encode and transmit data off-page.",
      "Only report disallowed categories in issues. Do not list allowed patterns as risks.",
      "If disallowed issues exist, isSafe must be false. If only allowed patterns exist, isSafe must be true.",
      "Return ONLY valid JSON. No markdown. No code fences. No commentary.",
      "Return JSON matching the schema.",
    ].join("\\n");

    const codeScanUser = `HTML:\\n${finalHtml}`;

    const scanDecision = await callOpenAIResponses<CodeScanDecision>(
      traceId,
      openAIConfig,
      {
        input: [
          { role: "system", content: [{ type: "input_text", text: codeScanSystem }] },
          { role: "user", content: [{ type: "input_text", text: codeScanUser }] },
        ],
        max_output_tokens: 300,
        text: {
          format: buildJsonSchemaResponseFormat("ArtifactCodeScan", codeScanSchema),
        },
      },
      "openai.artifact.scan",
      { maxAttempts: 2, jsonSchemaFallback: false, devLogOutputExtraction: isDevUser }
    );

    const rawKeys = getObjectKeys(scanDecision.raw);
    logEvent({
      level: "info",
      op,
      traceId,
      event: "artifact.aiScan.rawKeys",
      keys: listToString(rawKeys),
    });
    for (const [key, value] of Object.entries(scanDecision.raw ?? {})) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        logEvent({
          level: "info",
          op,
          traceId,
          event: "artifact.aiScan.rawNestedKeys",
          parentKey: key,
          keys: listToString(getObjectKeys(value)),
        });
      }
    }

    const parsedKeys = getObjectKeys(scanDecision.parsed);
    logEvent({
      level: "info",
      op,
      traceId,
      event: "artifact.aiScan.parsedKeys",
      keys: listToString(parsedKeys),
    });
    for (const [key, value] of Object.entries(scanDecision.parsed ?? {})) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        logEvent({
          level: "info",
          op,
          traceId,
          event: "artifact.aiScan.parsedNestedKeys",
          parentKey: key,
          keys: listToString(getObjectKeys(value)),
        });
      }
    }

    const parsedDecision = scanDecision.parsed ?? {};
    const parsedIssues = Array.isArray(parsedDecision.issues)
      ? parsedDecision.issues
      : Array.isArray(parsedDecision.findings)
        ? parsedDecision.findings
        : [];
    const isSafe = parsedDecision.isSafe ?? parsedDecision.safe;

    const { disallowed, allowed, ignored, uncategorized } = evaluateAiScanPolicy(parsedIssues);
    if (disallowed.length > 0) {
      const issueLog = buildAiScanIssueLogPayload(disallowed);
      const disallowedCategories = new Set(
        issueLog.summaries
          .map((summary) => summary.category)
          .filter((category): category is string => Boolean(category))
      );
      const safeAlternative = pickAiScanSafeAlternative(disallowedCategories);
      const categoryList =
        disallowedCategories.size > 0 ? ` (${[...disallowedCategories].join(", ")})` : "";
      const reason = buildRefusalReason(
        "AI_SCAN_FAILED",
        `AI code scan flagged disallowed behavior${categoryList}. Review the issues below.`,
        safeAlternative,
        { details: issueLog.summaries }
      );
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "artifact.aiScan.failed",
        issuesCount: issueLog.count,
        issues: issueLog.summaryJson,
        issueSummaryLines: issueLog.summaryLines,
      });
      return buildRefusalResponse(traceId, 200, reason, dumpPaths);
    }
    if (parsedIssues.length > 0) {
      const allowedLog = buildAiScanIssueLogPayload(allowed);
      const ignoredLog = buildAiScanIssueLogPayload(ignored);
      const uncategorizedLog = buildAiScanIssueLogPayload(uncategorized);
      logEvent({
        level: "info",
        op,
        traceId,
        event: "artifact.aiScan.allowed",
        allowedIssuesCount: allowedLog.count,
        allowedIssues: allowedLog.summaryJson,
        ignoredIssuesCount: ignoredLog.count,
        ignoredIssues: ignoredLog.summaryJson,
        uncategorizedIssuesCount: uncategorizedLog.count,
        uncategorizedIssues: uncategorizedLog.summaryJson,
      });
    }
    if (isSafe === false) {
      const issueLog = buildAiScanIssueLogPayload(parsedIssues);
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "artifact.aiScan.anomaly",
        issuesCount: issueLog.count,
        issues: issueLog.summaryJson,
        issueSummaryLines: issueLog.summaryLines,
      });
    }
  } catch (error) {
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "artifact.aiScan.error",
      message: error instanceof Error ? error.message : "unknown error",
    });
    if (config.aiScanFailClosed) {
      const reason = buildRefusalReason(
        "AI_SCAN_FAILED",
        "AI code scan failed.",
        "Use a smaller, simpler offline calculator prompt."
      );
      return buildRefusalResponse(traceId, 200, reason, dumpPaths);
    }
  }

    await dumpArtifacts({
      stage: "generate",
      genRequest: lastGenRequest,
      genResponseRaw: lastGenResponseRaw,
      html: finalHtml,
    });

    if (!isValidManifest(finalManifest)) {
      const reason = buildRefusalReason(
        "OPENAI_ERROR",
        "Generated manifest is missing required fields.",
        "Try a simpler offline calculator prompt."
      );
      return buildRefusalResponse(traceId, 502, reason, dumpPaths);
    }

    const calcId = normalizeId(body.baseCalcId || randomUUID());
    const versionId = normalizeId(randomUUID());
    const nowIso = new Date().toISOString();
    const artifactHash = computeSha256(finalHtml);
    const promptLen = prompt.length;
    const blobPath = getBlobPath(userId, calcId, versionId);

    let calculatorEntity = await loadCalculatorEntity(traceId, userId, calcId);
    if (!calculatorEntity) {
      calculatorEntity = {
        partitionKey: buildCalcPartition(userId),
        rowKey: buildCalcRow(calcId),
        entityType: "Calculator",
        calcId: normalizeId(calcId),
        userId: normalizeId(userId),
        title: (finalManifest.title as string) || "Untitled",
        createdAt: nowIso,
        updatedAt: nowIso,
        currentVersionId: versionId,
      };
    } else {
      calculatorEntity = {
        ...calculatorEntity,
        title: (finalManifest.title as string) || calculatorEntity.title,
        updatedAt: nowIso,
        currentVersionId: versionId,
      };
    }

    const versionEntity: CalculatorVersionEntity = {
      partitionKey: String(buildVersionPartition(userId, calcId)),
      rowKey: String(buildVersionRow(versionId)),
      entityType: "CalculatorVersion",
      userId: String(userId),
      calcId: String(calcId),
      versionId: String(versionId),
      createdAt: String(nowIso),
      status: String("ok") as CalculatorVersionEntity["status"],
      promptLen,
      prompt,
      manifestBlobPath: String(blobPath.manifest),
      artifactBlobPath: String(blobPath.artifact),
      artifactHash: String(artifactHash),
    };

    try {
      if (formSafetyResult?.containsForm) {
        logEvent({
          level: "warn",
          op,
          traceId,
          event: "artifact.containsForm",
          calcId,
          versionId,
        });
      }
      await persistArtifactBlob(traceId, blobPath.artifact, finalHtml);
      await persistManifestBlob(traceId, blobPath.manifest, finalManifest);
      await persistCalculatorVersionEntity(traceId, versionEntity);
      await persistCalculatorEntity(traceId, calculatorEntity);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logEvent({
        level: "error",
        op,
        traceId,
        event: "request.end",
        durationMs,
        status: 500,
      });
      return storageErrorResponse(traceId);
    }

    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "info",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 200,
      artifactBytes,
      calcId,
      versionId,
      scan_policy_mode: scanPolicyMode,
      scan_outcome: scanOutcome,
      override_armed: redTeamArmed,
      override_used: overrideUsed,
    });

    overrideUsedForDump = overrideUsed;
    context.log(`Generated calculator ${calcId} version ${versionId}.`);

    return jsonResponse(traceId, 200, {
      ...buildGenerateOkResponse(calcId, versionId, finalManifest, finalHtml, scanOutcome, overrideUsed),
      traceId,
      dumpPaths,
    });
  } catch (error) {
    const dumped = await dumpRedTeamArtifacts({
      traceId,
      stage: "error",
      prompt: promptForDump,
      scanRequest: lastScanRequest,
      scanResponseRaw: lastScanResponseRaw,
      genRequest: lastGenRequest,
      genResponseRaw: lastGenResponseRaw,
      error: {
        message: error instanceof Error ? error.message : "unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        type: error instanceof Error ? error.name : typeof error,
      },
      meta: {
        ts: new Date().toISOString(),
        model: modelForDump,
        scanPolicyMode: scanPolicyModeForDump,
        overrideArmed: redTeamArmedForDump,
        overrideUsed: overrideUsedForDump,
      },
    });
    if (dumped?.paths?.length) {
      dumpPaths.push(...dumped.paths);
    }

    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "error",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 500,
    });
    logEvent({
      level: "error",
      op,
      traceId,
      event: "request.error",
      message: error instanceof Error ? error.message : "unknown error",
    });
    return jsonResponse(traceId, 500, {
      error: {
        message: error instanceof Error ? error.message : "Internal server error",
        type: error instanceof Error ? error.name : typeof error,
      },
      traceId,
      dumpPaths,
    });
  }
};

const listCalcs = async (
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> => {
  const traceId = getTraceId(req.headers.get("traceparent"));
  const startedAt = Date.now();
  const op = "calcs.list";
  const { userId: requestUserId, isAuthenticated, identityProvider } = getUserContext(req);
  const isDevUser = identityProvider === "dev";
  const userId = normalizeId(requestUserId);

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/calcs",
    userId,
    isAuthenticated,
    identityProvider,
  });
  if (!isAuthenticated && !isDevUser) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 401,
    });
    return unauthorizedResponse(traceId);
  }
  const partitionKey = buildCalcPartition(userId);
  const tableClient = await getTableClient(traceId);
  const items: CalculatorSummary[] = [];

  try {
    for await (const entity of tableClient.listEntities<CalculatorEntity>({
      queryOptions: { filter: `PartitionKey eq '${partitionKey}'` },
    })) {
      if (entity.entityType !== "Calculator") {
        continue;
      }

      items.push({
        calcId: entity.calcId,
        title: entity.title,
        updatedAt: entity.updatedAt,
        currentVersionId: entity.currentVersionId,
      });
    }
  } catch (error) {
    logTableError(traceId, error, "calculator.list.failed", op);
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "error",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 500,
    });
    return storageErrorResponse(traceId);
  }

  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const durationMs = Date.now() - startedAt;
  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.end",
    durationMs,
    status: 200,
    count: items.length,
  });

  context.log(`Listed ${items.length} calculators.`);

  return jsonResponse(traceId, 200, items);
};

const getCalc = async (
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> => {
  const traceId = getTraceId(req.headers.get("traceparent"));
  const startedAt = Date.now();
  const op = "calcs.get";
  const calcId = req.params.calcId as string;
  const { userId: requestUserId, isAuthenticated, identityProvider } = getUserContext(req);
  const isDevUser = identityProvider === "dev";
  const userId = normalizeId(requestUserId);

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/calcs/{calcId}",
    calcId,
    userId,
    isAuthenticated,
    identityProvider,
  });
  if (!isAuthenticated && !isDevUser) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 401,
      calcId,
    });
    return unauthorizedResponse(traceId);
  }
  const tableClient = await getTableClient(traceId);
  const calculator = await loadCalculatorEntity(traceId, userId, calcId);
  if (!calculator) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 404,
      calcId,
    });
    return jsonResponse(traceId, 404, {
      code: "NOT_FOUND",
      message: "Calculator not found.",
    });
  }
  if (calculator.userId !== userId) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 403,
      calcId,
    });
    return forbiddenResponse(traceId);
  }

  const versions: CalculatorDetail["versions"] = [];
  const partitionKey = buildVersionPartition(userId, calcId);
  try {
    for await (const entity of tableClient.listEntities<CalculatorVersionEntity>({
      queryOptions: { filter: `PartitionKey eq '${partitionKey}'` },
    })) {
      if (entity.entityType !== "CalculatorVersion") {
        continue;
      }

      versions.push({
        versionId: entity.versionId,
        createdAt: entity.createdAt,
        status: entity.status,
      });
    }
  } catch (error) {
    logTableError(traceId, error, "version.list.failed", op);
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "error",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 500,
      calcId,
    });
    return storageErrorResponse(traceId);
  }

  versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const detail: CalculatorDetail = {
    calcId: calculator.calcId,
    title: calculator.title,
    createdAt: calculator.createdAt,
    updatedAt: calculator.updatedAt,
    currentVersionId: calculator.currentVersionId,
    versions,
  };

  const durationMs = Date.now() - startedAt;
  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.end",
    durationMs,
    status: 200,
    calcId,
    versions: versions.length,
  });

  context.log(`Loaded calculator ${calcId}.`);

  return jsonResponse(traceId, 200, detail as unknown as Record<string, unknown>);
};

const getVersion = async (
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> => {
  const traceId = getTraceId(req.headers.get("traceparent"));
  const startedAt = Date.now();
  const op = "calcs.version.get";
  const calcId = req.params.calcId as string;
  const versionId = req.params.versionId as string;
  const { userId: requestUserId, isAuthenticated, identityProvider } = getUserContext(req);
  const isDevUser = identityProvider === "dev";
  const userId = normalizeId(requestUserId);

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/calcs/{calcId}/versions/{versionId}",
    calcId,
    versionId,
    userId,
    isAuthenticated,
    identityProvider,
  });
  if (!isAuthenticated && !isDevUser) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 401,
      calcId,
      versionId,
    });
    return unauthorizedResponse(traceId);
  }
  const tableClient = await getTableClient(traceId);
  let versionEntity: CalculatorVersionEntity | null = null;

  try {
    versionEntity = await tableClient.getEntity<CalculatorVersionEntity>(
      buildVersionPartition(userId, calcId),
      buildVersionRow(versionId)
    );
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: string }).code : null;
    if (code !== "ResourceNotFound") {
      logTableError(traceId, error, "version.load.failed", op);
      const durationMs = Date.now() - startedAt;
      logEvent({
        level: "error",
        op,
        traceId,
        event: "request.end",
        durationMs,
        status: 500,
        calcId,
        versionId,
      });
      return storageErrorResponse(traceId);
    }
  }

  if (!versionEntity) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 404,
      calcId,
      versionId,
    });
    return jsonResponse(traceId, 404, {
      code: "NOT_FOUND",
      message: "Calculator version not found.",
    });
  }
  if (versionEntity.userId !== userId) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 403,
      calcId,
      versionId,
    });
    return forbiddenResponse(traceId);
  }

  const containerClient = await getContainerClient(traceId);
  const manifestBlob = containerClient.getBlockBlobClient(versionEntity.manifestBlobPath);
  const artifactBlob = containerClient.getBlockBlobClient(versionEntity.artifactBlobPath);

  const manifestPayload = await manifestBlob.downloadToBuffer();
  const artifactPayload = await artifactBlob.downloadToBuffer();

  const manifest = JSON.parse(manifestPayload.toString("utf8")) as Record<string, unknown>;
  const artifactHtml = artifactPayload.toString("utf8");
  const artifactBytes = Buffer.byteLength(artifactHtml, "utf8");

  const durationMs = Date.now() - startedAt;
  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.end",
    durationMs,
    status: 200,
    calcId,
    versionId,
    artifactBytes,
    artifactHash: versionEntity.artifactHash,
  });

  context.log(`Loaded calculator ${calcId} version ${versionId}.`);

  return jsonResponse(traceId, 200, {
    manifest,
    artifactHtml,
  });
};

const promoteVersion = async (
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> => {
  const traceId = getTraceId(req.headers.get("traceparent"));
  const startedAt = Date.now();
  const op = "calcs.version.promote";
  const calcId = req.params.calcId as string;
  const versionId = req.params.versionId as string;
  const { userId: requestUserId, isAuthenticated, identityProvider } = getUserContext(req);
  const isDevUser = identityProvider === "dev";
  const userId = normalizeId(requestUserId);

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/calcs/{calcId}/versions/{versionId}/promote",
    calcId,
    versionId,
    userId,
    isAuthenticated,
    identityProvider,
  });
  if (!isAuthenticated && !isDevUser) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 401,
      calcId,
      versionId,
    });
    return unauthorizedResponse(traceId);
  }
  const calculator = await loadCalculatorEntity(traceId, userId, calcId);
  if (!calculator) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 404,
      calcId,
      versionId,
    });
    return jsonResponse(traceId, 404, {
      code: "NOT_FOUND",
      message: "Calculator not found.",
    });
  }
  if (calculator.userId !== userId) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 403,
      calcId,
      versionId,
    });
    return forbiddenResponse(traceId);
  }

  const tableClient = await getTableClient(traceId);
  let versionEntity: CalculatorVersionEntity | null = null;

  try {
    versionEntity = await tableClient.getEntity<CalculatorVersionEntity>(
      buildVersionPartition(userId, calcId),
      buildVersionRow(versionId)
    );
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: string }).code : null;
    if (code !== "ResourceNotFound") {
      logTableError(traceId, error, "version.load.failed", op);
      const durationMs = Date.now() - startedAt;
      logEvent({
        level: "error",
        op,
        traceId,
        event: "request.end",
        durationMs,
        status: 500,
        calcId,
        versionId,
      });
      return storageErrorResponse(traceId);
    }
  }
  if (!versionEntity) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 404,
      calcId,
      versionId,
    });
    return jsonResponse(traceId, 404, {
      code: "NOT_FOUND",
      message: "Calculator version not found.",
    });
  }
  if (versionEntity.userId !== userId) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 403,
      calcId,
      versionId,
    });
    return forbiddenResponse(traceId);
  }

  const nowIso = new Date().toISOString();
  const updated: CalculatorEntity = {
    ...calculator,
    updatedAt: nowIso,
    currentVersionId: versionId,
  };

  try {
    await persistCalculatorEntity(traceId, updated);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "error",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 500,
      calcId,
      versionId,
    });
    return storageErrorResponse(traceId);
  }

  const durationMs = Date.now() - startedAt;
  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.end",
    durationMs,
    status: 200,
    calcId,
    versionId,
  });

  context.log(`Promoted calculator ${calcId} version ${versionId}.`);

  return jsonResponse(traceId, 200, {
    calcId,
    currentVersionId: versionId,
  });
};

const deleteCalc = async (
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> => {
  const traceId = getTraceId(req.headers.get("traceparent"));
  const startedAt = Date.now();
  const op = "calcs.delete";
  const calcId = req.params.calcId as string;
  const { userId: requestUserId, isAuthenticated, identityProvider } = getUserContext(req);
  const isDevUser = identityProvider === "dev";
  const userId = normalizeId(requestUserId);

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/calcs/{calcId}",
    calcId,
    userId,
    isAuthenticated,
    identityProvider,
  });
  if (!isAuthenticated && !isDevUser) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 401,
      calcId,
    });
    return unauthorizedResponse(traceId);
  }
  const calculator = await loadCalculatorEntity(traceId, userId, calcId);
  if (!calculator) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 404,
      calcId,
    });
    return jsonResponse(traceId, 404, {
      code: "NOT_FOUND",
      message: "Calculator not found.",
    });
  }
  if (calculator.userId !== userId) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 403,
      calcId,
    });
    return forbiddenResponse(traceId);
  }
  const blobPath = getBlobPath(userId, calcId, "ignored");

  try {
    await deleteCalculatorEntities(traceId, userId, calcId);
    await deleteCalculatorBlobs(traceId, blobPath.prefix);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logEvent({
      level: "error",
      op,
      traceId,
      event: "request.end",
      durationMs,
      status: 500,
      calcId,
    });
    return storageErrorResponse(traceId);
  }

  const durationMs = Date.now() - startedAt;
  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.end",
    durationMs,
    status: 200,
    calcId,
  });

  context.log(`Deleted calculator ${calcId}.`);

  return jsonResponse(traceId, 200, { ok: true });
};

app.http("calcs-save", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "calcs/save",
  handler: saveCalc,
});

app.http("calcs-generate", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "calcs/generate",
  handler: generateCalc,
});

app.http("calcs-list", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "calcs",
  handler: listCalcs,
});

app.http("calcs-get", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "calcs/{calcId}",
  handler: getCalc,
});

app.http("calcs-version-get", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "calcs/{calcId}/versions/{versionId}",
  handler: getVersion,
});

app.http("calcs-version-promote", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "calcs/{calcId}/versions/{versionId}/promote",
  handler: promoteVersion,
});

app.http("calcs-delete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "calcs/{calcId}",
  handler: deleteCalc,
});
