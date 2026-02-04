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
import { resolveGenerationGate } from "../generation/gate";
import {
  buildGenerateOkResponse,
  buildGenerateRefusedResponse,
  type RefusalReason,
} from "../generation/response";
import { callOpenAIResponses } from "../openai/client";
import { getPromptCalcPolicy } from "../policy/policy";
import { scanArtifactHtml } from "../policy/scanner";
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
}

interface PromptScanDecision {
  allowed: boolean;
  refusalCode?: string;
  reason: string;
  safeAlternative: string;
}

interface ArtifactGenerationResponse {
  artifactHtml: string;
  manifest: Record<string, unknown>;
  notes?: string;
}

interface CodeScanDecision {
  safe: boolean;
  findings: string[];
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
  safeAlternative: string
): RefusalReason => ({
  code,
  message,
  safeAlternative,
});

const buildRefusalResponse = (
  traceId: string,
  status: number,
  reason: RefusalReason
): HttpResponseInit =>
  jsonResponse(traceId, status, buildGenerateRefusedResponse(reason));

const isValidManifest = (manifest: Record<string, unknown>): boolean => {
  const specVersion = manifest.specVersion;
  const title = manifest.title;
  const executionModel = manifest.executionModel;
  const capabilities = manifest.capabilities;

  if (typeof specVersion !== "string") {
    return false;
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    return false;
  }

  if (typeof executionModel !== "string") {
    return false;
  }

  if (!capabilities || typeof capabilities !== "object") {
    return false;
  }

  const network = (capabilities as { network?: unknown }).network;
  return network === false;
};

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

  const artifactBytes = Buffer.byteLength(body.artifactHtml, "utf8");
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
  const artifactHash = createHash("sha256").update(body.artifactHtml, "utf8").digest("hex");
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
    await persistArtifactBlob(traceId, blobPath.artifact, body.artifactHtml);
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

  const body = await parseGenerateRequestBody(req);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

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
  const gateReason = resolveGenerationGate(config);
  if (gateReason) {
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "generation.gated",
      code: gateReason.code,
    });
    return buildRefusalResponse(traceId, 200, gateReason);
  }

  const policy = await getPromptCalcPolicy();
  const openAIConfig = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
    maxTokens: config.maxTokens,
  };

  let promptDecision: PromptScanDecision;
  try {
    const promptScanSchema = {
      name: "prompt_scan",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["allowed", "reason", "safeAlternative"],
        properties: {
          allowed: { type: "boolean" },
          refusalCode: { type: "string" },
          reason: { type: "string" },
          safeAlternative: { type: "string" },
        },
      },
      strict: true,
    };

    const promptScanSystem = [
      "You are a strict policy classifier for PromptCalc generation prompts.",
      "Disallow any intent that requests:",
      "- networking, URL fetching, scraping, or external data sources",
      "- external dependencies or CDN scripts",
      "- credential capture (login pages, password inputs)",
      "- analytics, tracking, or user fingerprinting",
      "- attempts to escape the sandboxed iframe (top navigation, popups)",
      "- eval/dynamic code generation requests",
      "Return a JSON object that conforms exactly to the schema.",
      "If disallowed, set allowed=false and set refusalCode to the best matching policy code.",
    ].join("\\n");

    const promptScanUser = `Prompt:\\n${prompt}`;

    const promptScanResult = await callOpenAIResponses<PromptScanDecision>(
      traceId,
      openAIConfig,
      {
        input: [
          { role: "system", content: promptScanSystem },
          { role: "user", content: promptScanUser },
        ],
        response_format: { type: "json_schema", json_schema: promptScanSchema },
        max_output_tokens: 350,
      },
      "openai.prompt.scan"
    );

    promptDecision = promptScanResult.parsed;
  } catch (error) {
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
    });
    return buildRefusalResponse(traceId, 502, reason);
  }

  logEvent({
    level: "info",
    op,
    traceId,
    event: "prompt.scan.result",
    allowed: promptDecision.allowed,
    refusalCode: promptDecision.refusalCode,
  });

  if (!promptDecision.allowed) {
    const reason = buildRefusalReason(
      promptDecision.refusalCode || "DISALLOWED_NETWORK",
      promptDecision.reason,
      promptDecision.safeAlternative
    );
    return buildRefusalResponse(traceId, 200, reason);
  }

  let generationResult: ArtifactGenerationResponse;
  try {
    const generationSchema = {
      name: "artifact_generation",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["artifactHtml", "manifest"],
        properties: {
          artifactHtml: { type: "string" },
          manifest: {
            type: "object",
            additionalProperties: false,
            required: [
              "specVersion",
              "title",
              "description",
              "executionModel",
              "capabilities",
              "inputs",
              "outputs",
              "limitations",
              "safetyNotes",
              "hash",
            ],
            properties: {
              specVersion: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              executionModel: { type: "string" },
              capabilities: {
                type: "object",
                additionalProperties: false,
                properties: { network: { type: "boolean" } },
                required: ["network"],
              },
              inputs: { type: "array", items: { type: "string" } },
              outputs: { type: "array", items: { type: "string" } },
              limitations: { type: "array", items: { type: "string" } },
              safetyNotes: { type: "array", items: { type: "string" } },
              hash: { type: "string" },
            },
          },
          notes: { type: "string" },
        },
      },
      strict: true,
    };

    const generationSystem = [
      "You generate a single-file offline calculator HTML artifact for PromptCalc.",
      "Rules:",
      "- Output must be a single HTML file and a manifest JSON object.",
      "- Include a CSP meta tag with: default-src 'none'; connect-src 'none'; img-src 'none';",
      "  script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'.",
      "- No external scripts, links, fonts, images, iframes, or network requests.",
      "- No popups or navigation changes.",
      "- Include this banner text in the body: \"Generated calculator (offline). Do not enter passwords.\"",
      "- Embed the manifest JSON in the HTML inside:",
      "  <script type=\"application/json\" id=\"promptcalc-manifest\">...</script>.",
      "- The manifest capabilities.network must be false.",
      "- Do not refuse; classifier already handled refusals.",
      "Return JSON that exactly matches the schema.",
    ].join("\\n");

    const generationUser = [
      "Prompt:",
      prompt,
      "",
      "If you need a title, use a short descriptive one.",
    ].join("\\n");

    const generationResponse = await callOpenAIResponses<ArtifactGenerationResponse>(
      traceId,
      openAIConfig,
      {
        input: [
          { role: "system", content: generationSystem },
          { role: "user", content: generationUser },
        ],
        response_format: { type: "json_schema", json_schema: generationSchema },
      },
      "openai.artifact.generate"
    );

    generationResult = generationResponse.parsed;
  } catch (error) {
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
    return buildRefusalResponse(traceId, 502, reason);
  }

  if (
    !generationResult ||
    typeof generationResult.artifactHtml !== "string" ||
    !generationResult.manifest ||
    typeof generationResult.manifest !== "object"
  ) {
    const reason = buildRefusalReason(
      "OPENAI_ERROR",
      "Artifact generation returned invalid data.",
      "Try a simpler offline calculator prompt."
    );
    return buildRefusalResponse(traceId, 502, reason);
  }

  const baseManifest = {
    ...generationResult.manifest,
    capabilities: { network: false },
    hash: "",
  } as Record<string, unknown>;
  const placeholderHtml = embedManifestInHtml(generationResult.artifactHtml, baseManifest);
  const manifestHash = computeSha256(placeholderHtml);
  const finalManifest = { ...baseManifest, hash: manifestHash } as Record<string, unknown>;
  const finalHtml = embedManifestInHtml(generationResult.artifactHtml, finalManifest);

  const artifactBytes = Buffer.byteLength(finalHtml, "utf8");
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
    return buildRefusalResponse(traceId, 200, reason);
  }

  const scanResult = scanArtifactHtml(finalHtml, policy);
  if (!scanResult.ok) {
    const reason = buildRefusalReason(
      scanResult.code,
      scanResult.message,
      "Use a simple offline calculator without external data or scripts."
    );
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "artifact.scan.failed",
      ruleId: scanResult.ruleId,
      code: scanResult.code,
    });
    return buildRefusalResponse(traceId, 200, reason);
  }

  logEvent({
    level: "info",
    op,
    traceId,
    event: "artifact.scan.passed",
    artifactBytes,
  });

  try {
    const codeScanSchema = {
      name: "artifact_scan",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["safe", "findings"],
        properties: {
          safe: { type: "boolean" },
          findings: { type: "array", items: { type: "string" } },
        },
      },
      strict: true,
    };

    const codeScanSystem = [
      "Review the HTML and decide if it is safe for an offline, sandboxed calculator.",
      "Flag any signs of networking, external dependencies, credential capture, eval/dynamic code,",
      "sandbox escapes, or navigation/popup attempts.",
      "Return JSON matching the schema.",
    ].join("\\n");

    const codeScanUser = `HTML:\\n${finalHtml}`;

    const scanDecision = await callOpenAIResponses<CodeScanDecision>(
      traceId,
      openAIConfig,
      {
        input: [
          { role: "system", content: codeScanSystem },
          { role: "user", content: codeScanUser },
        ],
        response_format: { type: "json_schema", json_schema: codeScanSchema },
        max_output_tokens: 300,
      },
      "openai.artifact.scan"
    );

    if (!scanDecision.parsed.safe) {
      const reason = buildRefusalReason(
        "AI_SCAN_FAILED",
        scanDecision.parsed.findings.join("; ") || "AI code scan flagged the artifact.",
        "Use a smaller, simpler offline calculator prompt."
      );
      logEvent({
        level: "warn",
        op,
        traceId,
        event: "artifact.aiScan.failed",
        findings: scanDecision.parsed.findings.length,
      });
      return buildRefusalResponse(traceId, 200, reason);
    }
  } catch (error) {
    const reason = buildRefusalReason(
      "OPENAI_ERROR",
      "AI code scan failed.",
      "Try again with a simpler offline calculator."
    );
    logEvent({
      level: "warn",
      op,
      traceId,
      event: "artifact.aiScan.error",
      message: error instanceof Error ? error.message : "unknown error",
    });
    return buildRefusalResponse(traceId, 502, reason);
  }

  if (!isValidManifest(finalManifest)) {
    const reason = buildRefusalReason(
      "OPENAI_ERROR",
      "Generated manifest is missing required fields.",
      "Try a simpler offline calculator prompt."
    );
    return buildRefusalResponse(traceId, 502, reason);
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
  });

  context.log(`Generated calculator ${calcId} version ${versionId}.`);

  return jsonResponse(
    traceId,
    200,
    buildGenerateOkResponse(calcId, versionId, finalManifest, finalHtml)
  );
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
