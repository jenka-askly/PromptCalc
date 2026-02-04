/**
 * Purpose: Provide Azure Table/Blob clients and policy limits for PromptCalc persistence.
 * Persists: Creates/reads the PromptCalc table and blob container.
 * Security Risks: Reads storage connection settings; do not log secrets.
 */

import { readFile } from "fs/promises";
import path from "path";

import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { TableClient } from "@azure/data-tables";
import { logEvent } from "@promptcalc/logger";

const DEFAULT_STORAGE_CONNECTION = "UseDevelopmentStorage=true";
const DEFAULT_TABLE_NAME = "PromptCalcMeta";
const DEFAULT_CONTAINER_NAME = "promptcalc";
const DEFAULT_MAX_ARTIFACT_BYTES = 200_000;

let cachedTableClient: TableClient | null = null;
let cachedContainerClient: ContainerClient | null = null;
let cachedMaxArtifactBytes: number | null = null;

const getStorageConnectionString = (): string =>
  process.env.PROMPTCALC_STORAGE_CONNECTION ||
  process.env.AzureWebJobsStorage ||
  DEFAULT_STORAGE_CONNECTION;

const getTableName = (): string =>
  process.env.PROMPTCALC_TABLE_NAME || DEFAULT_TABLE_NAME;

const getContainerName = (): string =>
  process.env.PROMPTCALC_CONTAINER || DEFAULT_CONTAINER_NAME;

export const getTableClient = async (traceId?: string): Promise<TableClient> => {
  if (cachedTableClient) {
    return cachedTableClient;
  }

  const connectionString = getStorageConnectionString();
  const tableName = getTableName();
  const client = TableClient.fromConnectionString(connectionString, tableName);

  try {
    await client.createTable();
  } catch (error) {
    const code = error instanceof Error ? (error as { code?: string }).code : undefined;
    if (code !== "TableAlreadyExists") {
      throw error;
    }
  }

  logEvent({
    level: "info",
    op: "storage.init",
    traceId,
    event: "table.ensure",
    tableName,
  });

  cachedTableClient = client;
  return client;
};

export const getContainerClient = async (
  traceId?: string
): Promise<ContainerClient> => {
  if (cachedContainerClient) {
    return cachedContainerClient;
  }

  const connectionString = getStorageConnectionString();
  const containerName = getContainerName();
  const blobService = BlobServiceClient.fromConnectionString(connectionString);
  const client = blobService.getContainerClient(containerName);

  await client.createIfNotExists();

  logEvent({
    level: "info",
    op: "storage.init",
    traceId,
    event: "container.ensure",
    containerName,
  });

  cachedContainerClient = client;
  return client;
};

const readMaxArtifactBytes = async (): Promise<number> => {
  const envValue = process.env.MAX_ARTIFACT_BYTES;
  if (envValue) {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const candidates = [
    path.resolve(process.cwd(), "spec/policy.yaml"),
    path.resolve(__dirname, "../../../spec/policy.yaml"),
  ];

  for (const policyPath of candidates) {
    try {
      const contents = await readFile(policyPath, "utf-8");
      const match = contents.match(/maxArtifactBytes:\s*(\d+)/);
      if (!match) {
        return DEFAULT_MAX_ARTIFACT_BYTES;
      }

      const parsed = Number(match[1]);
      return Number.isFinite(parsed) ? parsed : DEFAULT_MAX_ARTIFACT_BYTES;
    } catch {
      continue;
    }
  }

  return DEFAULT_MAX_ARTIFACT_BYTES;
};

export const getMaxArtifactBytes = async (): Promise<number> => {
  if (cachedMaxArtifactBytes !== null) {
    return cachedMaxArtifactBytes;
  }

  try {
    cachedMaxArtifactBytes = await readMaxArtifactBytes();
  } catch (error) {
    cachedMaxArtifactBytes = DEFAULT_MAX_ARTIFACT_BYTES;
    logEvent({
      level: "warn",
      op: "storage.policy",
      event: "policy.read.failed",
      error: error instanceof Error ? error.message : "unknown error",
    });
  }

  return cachedMaxArtifactBytes;
};

export const getBlobPath = (userId: string, calcId: string, versionId: string) => ({
  artifact: `users/${userId}/calcs/${calcId}/versions/${versionId}/artifact.html`,
  manifest: `users/${userId}/calcs/${calcId}/versions/${versionId}/manifest.json`,
  prefix: `users/${userId}/calcs/${calcId}/`,
});
