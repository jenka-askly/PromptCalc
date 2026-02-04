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

import { getUserId } from "../auth";
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

const buildCalcPartition = (userId: string) => `USER#${userId}`;
const buildCalcRow = (calcId: string) => `CALC#${calcId}`;
const buildVersionPartition = (userId: string, calcId: string) =>
  `USER#${userId}#CALC#${calcId}`;
const buildVersionRow = (versionId: string) => `VER#${versionId}`;

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
  await tableClient.upsertEntity(entity, "Merge");

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
  await tableClient.upsertEntity(entity, "Merge");

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

  for await (const entity of tableClient.listEntities<CalculatorVersionEntity>({
    queryOptions: { filter: `PartitionKey eq '${versionPartition}'` },
  })) {
    await tableClient.deleteEntity(entity.partitionKey, entity.rowKey);
  }

  await tableClient.deleteEntity(calcPartition, buildCalcRow(calcId));

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
  } catch {
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

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/calcs/save",
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

  const userId = getUserId(req);
  const calcId = body.calcId || randomUUID();
  const versionId = randomUUID();
  const nowIso = new Date().toISOString();
  const artifactHash = createHash("sha256").update(body.artifactHtml, "utf8").digest("hex");
  const promptLen = typeof body.prompt === "string" ? body.prompt.length : undefined;
  const blobPath = getBlobPath(userId, calcId, versionId);

  let calculatorEntity = await loadCalculatorEntity(traceId, userId, calcId);
  if (!calculatorEntity) {
    calculatorEntity = {
      partitionKey: buildCalcPartition(userId),
      rowKey: buildCalcRow(calcId),
      entityType: "Calculator",
      calcId,
      userId,
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
    partitionKey: buildVersionPartition(userId, calcId),
    rowKey: buildVersionRow(versionId),
    entityType: "CalculatorVersion",
    calcId,
    versionId,
    userId,
    createdAt: nowIso,
    prompt: typeof body.prompt === "string" ? body.prompt : undefined,
    status: "ok",
    manifestBlobPath: blobPath.manifest,
    artifactBlobPath: blobPath.artifact,
    artifactHash,
  };

  await persistArtifactBlob(traceId, blobPath.artifact, body.artifactHtml);
  await persistManifestBlob(traceId, blobPath.manifest, body.manifest);
  await persistCalculatorVersionEntity(traceId, versionEntity);
  await persistCalculatorEntity(traceId, calculatorEntity);

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

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/calcs",
  });

  const userId = getUserId(req);
  const partitionKey = buildCalcPartition(userId);
  const tableClient = await getTableClient(traceId);
  const items: CalculatorSummary[] = [];

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

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/calcs/{calcId}",
    calcId,
  });

  const userId = getUserId(req);
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

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/calcs/{calcId}/versions/{versionId}",
    calcId,
    versionId,
  });

  const userId = getUserId(req);
  const tableClient = await getTableClient(traceId);
  const versionEntity = await tableClient.getEntity<CalculatorVersionEntity>(
    buildVersionPartition(userId, calcId),
    buildVersionRow(versionId)
  ).catch(() => null);

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

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/calcs/{calcId}/versions/{versionId}/promote",
    calcId,
    versionId,
  });

  const userId = getUserId(req);
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
  const versionEntity = await tableClient.getEntity<CalculatorVersionEntity>(
    buildVersionPartition(userId, calcId),
    buildVersionRow(versionId)
  ).catch(() => null);
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

  await persistCalculatorEntity(traceId, updated);

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

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/calcs/{calcId}",
    calcId,
  });

  const userId = getUserId(req);
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

  await deleteCalculatorEntities(traceId, userId, calcId);
  await deleteCalculatorBlobs(traceId, blobPath.prefix);

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
