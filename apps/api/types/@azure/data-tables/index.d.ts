/**
 * Purpose: Provide minimal Azure Data Tables type stubs for offline TypeScript builds.
 * Persists: None.
 * Security Risks: Describes table client methods used by the API.
 */

export class TableClient {
  static fromConnectionString(connectionString: string, tableName: string): TableClient;
  createTable(): Promise<void>;
  upsertEntity(entity: unknown, mode?: string): Promise<void>;
  getEntity<T extends Record<string, unknown>>(partitionKey: string, rowKey: string): Promise<T>;
  deleteEntity(partitionKey: string, rowKey: string): Promise<void>;
  listEntities<T extends Record<string, unknown>>(
    options?: { queryOptions?: { filter?: string } }
  ): AsyncIterable<T>;
}
