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

import { getUserContext } from "../auth";
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
  const { userId: requestUserId, isDevUser } = getUserContext(req);
  const userId = normalizeId(requestUserId);

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/calcs/save",
    userId,
    isDevUser,
  });

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

const listCalcs = async (
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> => {
  const traceId = getTraceId(req.headers.get("traceparent"));
  const startedAt = Date.now();
  const op = "calcs.list";
  const { userId: requestUserId, isDevUser } = getUserContext(req);
  const userId = normalizeId(requestUserId);

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/calcs",
    userId,
    isDevUser,
  });
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
  const { userId: requestUserId, isDevUser } = getUserContext(req);
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
    isDevUser,
  });
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
  const { userId: requestUserId, isDevUser } = getUserContext(req);
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
    isDevUser,
  });
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
  const { userId: requestUserId, isDevUser } = getUserContext(req);
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
    isDevUser,
  });
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
  const { userId: requestUserId, isDevUser } = getUserContext(req);
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
    isDevUser,
  });
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
