/**
 * Purpose: Provide a cached build/version stamp for diagnostics and responses.
 * Persists: None.
 * Security Risks: Reads environment variables and git metadata; do not include secrets.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import nodeProcess from "process";
import path from "path";

export type BuildStamp = {
  app: "PromptCalc";
  buildTime: string;
  gitSha: string;
  nodeVersion: string;
  apiPackageVersion: string;
  rootPackageVersion: string;
  webPackageVersion: string;
  env: Record<string, string>;
};

const readJson = (filePath: string): Record<string, unknown> | null => {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const resolvePackageVersion = (candidates: string[]): string => {
  for (const candidate of candidates) {
    const parsed = readJson(candidate);
    if (parsed && typeof parsed.version === "string") {
      return parsed.version;
    }
  }
  return "unknown";
};

const resolveGitSha = (): string => {
  if (nodeProcess.env.GIT_SHA && nodeProcess.env.GIT_SHA.trim().length > 0) {
    return nodeProcess.env.GIT_SHA.trim();
  }
  try {
    const output = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString("utf8")
      .trim();
    return output || "unknown";
  } catch {
    return "unknown";
  }
};

const resolveEnvFlags = (): Record<string, string> => {
  const env = {
    PROMPTCALC_REDKIT: nodeProcess.env.PROMPTCALC_REDKIT,
    PROMPTCALC_OPENAI_TIMEOUT_MS: nodeProcess.env.PROMPTCALC_OPENAI_TIMEOUT_MS,
    OPENAI_TIMEOUT_MS: nodeProcess.env.OPENAI_TIMEOUT_MS,
    OPENAI_BASE_URL: nodeProcess.env.OPENAI_BASE_URL,
    OPENAI_MAX_TOKENS: nodeProcess.env.OPENAI_MAX_TOKENS,
    GENERATION_ENABLED: nodeProcess.env.GENERATION_ENABLED,
    AI_SCAN_FAIL_CLOSED: nodeProcess.env.AI_SCAN_FAIL_CLOSED,
    PROMPTCALC_ACCEPT_FAKE_EASYAUTH: nodeProcess.env.PROMPTCALC_ACCEPT_FAKE_EASYAUTH,
  };
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
};

const resolveBuildStamp = (): BuildStamp => {
  const cwd = nodeProcess.cwd();
  const apiPackageVersion = resolvePackageVersion([
    path.resolve(cwd, "apps/api/package.json"),
    path.resolve(cwd, "package.json"),
    path.resolve(cwd, "../package.json"),
  ]);
  const rootPackageVersion = resolvePackageVersion([
    path.resolve(cwd, "package.json"),
    path.resolve(cwd, "..", "package.json"),
    path.resolve(cwd, "../..", "package.json"),
  ]);
  const webPackageVersion = resolvePackageVersion([
    path.resolve(cwd, "apps/web/package.json"),
    path.resolve(cwd, "../web/package.json"),
    path.resolve(cwd, "../apps/web/package.json"),
  ]);

  return {
    app: "PromptCalc",
    buildTime: nodeProcess.env.BUILD_TIME || new Date().toISOString(),
    gitSha: resolveGitSha(),
    nodeVersion: nodeProcess.version,
    apiPackageVersion,
    rootPackageVersion,
    webPackageVersion,
    env: resolveEnvFlags(),
  };
};

const cachedBuildStamp = resolveBuildStamp();

export const getBuildStamp = (): BuildStamp => cachedBuildStamp;
