"use strict";

const path = require("node:path");

function sdpBase(cwd: string): string {
  return path.resolve(cwd, ".sdp");
}

function ensureRelativeArtifactPath(relPath: string, scopeLabel: string): void {
  if (typeof relPath !== "string" || relPath.trim() === "") {
    throw new Error(`Invalid ${scopeLabel}: relPath must be a non-empty string`);
  }
  if (path.isAbsolute(relPath)) {
    throw new Error(`Invalid ${scopeLabel}: absolute paths are not allowed (${relPath})`);
  }
}

function assertPathWithinBase(resolvedPath: string, basePath: string, scopeLabel: string): void {
  const relative = path.relative(basePath, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Invalid ${scopeLabel}: path escapes base directory (${basePath})`);
  }
}

function validateAdapterId(adapterId: string): void {
  if (typeof adapterId !== "string" || adapterId.trim() === "") {
    throw new Error("Invalid adapterId: must be a non-empty string");
  }
  if (adapterId.includes("/") || adapterId.includes("\\") || adapterId.includes("..")) {
    throw new Error("Invalid adapterId: must not contain path separators or '..'");
  }
}

function adapterDir(cwd: string, adapterId: string): string {
  validateAdapterId(adapterId);
  return path.join(sdpBase(cwd), adapterId);
}

function resolveSharedCatalogPath(cwd: string, relPath: string): string {
  ensureRelativeArtifactPath(relPath, "shared catalog path");
  const base = sdpBase(cwd);
  const resolved = path.resolve(base, relPath);
  assertPathWithinBase(resolved, base, "shared catalog path");
  return resolved;
}

function resolveFlowProfilePath(cwd: string, adapterId: string, relPath: string): string {
  validateAdapterId(adapterId);
  ensureRelativeArtifactPath(relPath, "flow profile path");

  const base = adapterDir(cwd, adapterId);
  const resolved = path.resolve(base, relPath);
  assertPathWithinBase(resolved, base, "flow profile path");
  return resolved;
}

function resolveValidationReportPath(profilePath: string): string {
  return path.join(path.dirname(profilePath), "validation-report.json");
}

module.exports = {
  sdpBase,
  adapterDir,
  resolveSharedCatalogPath,
  resolveFlowProfilePath,
  resolveValidationReportPath,
};