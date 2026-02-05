/**
 * Purpose: Provide minimal Node.js type stubs to allow offline TypeScript builds.
 * Persists: None.
 * Security Risks: Declares process.env, Buffer, and Node core module typings.
 */

declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
  }
}

declare const process: { env: NodeJS.ProcessEnv; cwd: () => string };

declare const __dirname: string;

declare class Buffer {
  static byteLength(value: string, encoding?: string): number;
  static from(value: string, encoding?: string): Buffer;
  toString(encoding?: string): string;
}

declare module "crypto" {
export function createHash(algorithm: string): {
    update(data: string, encoding?: string): {
      digest(): Buffer;
      digest(encoding: string): string;
    };
  };
  export function randomUUID(): string;
}

declare module "fs/promises" {
  export function readFile(path: string | URL, encoding: string): Promise<string>;
  export function writeFile(path: string | URL, data: string, encoding?: string): Promise<void>;
  export function mkdir(path: string | URL, options?: { recursive?: boolean }): Promise<void>;
  export function appendFile(path: string | URL, data: string, encoding?: string): Promise<void>;
}

declare module "path" {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
}
