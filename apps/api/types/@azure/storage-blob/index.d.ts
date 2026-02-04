/**
 * Purpose: Provide minimal Azure Storage Blob type stubs for offline TypeScript builds.
 * Persists: None.
 * Security Risks: Describes blob client methods used by the API.
 */

export class ContainerClient {
  createIfNotExists(): Promise<void>;
  listBlobsFlat(options?: { prefix?: string }): AsyncIterable<{ name: string }>;
  deleteBlob(blobName: string): Promise<void>;
  getBlockBlobClient(blobPath: string): {
    upload(data: string | Buffer, length: number, options?: unknown): Promise<void>;
    downloadToBuffer(): Promise<Buffer>;
  };
}

export class BlobServiceClient {
  static fromConnectionString(connectionString: string): BlobServiceClient;
  getContainerClient(containerName: string): ContainerClient;
}
