"use strict";

const fs = require("node:fs");
const path = require("node:path");

import type { FlowProfile, SkillReferenceCatalog } from "../types";
import type { QueryArgs, QueryContext, ValidationReport } from "./registry";

function isPathWithinProject(rootDir: string, candidatePath: string): boolean {
  const rel = path.relative(rootDir, candidatePath);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function findSdpRootDir(rootDir: string, profilePath: string): string | null {
  let current = path.dirname(profilePath);

  while (isPathWithinProject(rootDir, current)) {
    if (path.basename(current) === ".sdp") {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

export function loadQueryContext(args: QueryArgs): QueryContext {
  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const profilePath = path.resolve(cwd, args.profile!);

  if (!isPathWithinProject(cwd, profilePath)) {
    throw new Error(`Profile path is outside project boundary: ${args.profile}`);
  }

  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found: ${profilePath}`);
  }

  const profileContent = fs.readFileSync(profilePath, "utf8");
  const profile: FlowProfile = JSON.parse(profileContent);

  // Schema pre-validation
  if (!profile.schema_version) {
    throw new Error("Invalid profile: missing schema_version");
  }

  // Load co-located catalog, then fallback to discovered .sdp root.
  const profileDir = path.dirname(profilePath);
  const rootSdpDir = findSdpRootDir(cwd, profilePath);
  const catalog =
    loadOptionalJson<SkillReferenceCatalog>(
      path.join(profileDir, "skill-reference-catalog.json"),
    ) ||
    (rootSdpDir
      ? loadOptionalJson<SkillReferenceCatalog>(
        path.join(rootSdpDir, "skill-reference-catalog.json"),
      )
      : null);

  // Load co-located validation report, then fallback to discovered .sdp root.
  const validationReport =
    loadOptionalJson<ValidationReport>(
      path.join(profileDir, "validation-report.json"),
    ) ||
    (rootSdpDir
      ? loadOptionalJson<ValidationReport>(
        path.join(rootSdpDir, "validation-report.json"),
      )
      : null);

  return { profile, catalog, validationReport, args };
}

function loadOptionalJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}
