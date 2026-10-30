"use strict";

import fs from "node:fs";
import path from "node:path";

import type { FlowProfile, SkillReferenceCatalog } from "../types";
import type { QueryArgs, QueryContext, ValidationReport } from "./registry";
import { ValidationReportSchema } from "../schemas/validation-report";

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

  // Schema pre-validation: fail closed on profiles whose required
  // top-level fields are missing or mis-typed. Query handlers
  // dereference these fields directly, and the profile artifact is
  // untrusted input — shape enforcement belongs at this boundary.
  if (!profile.schema_version) {
    throw new Error("Invalid profile: missing schema_version");
  }

  const requiredArrayFields = [
    "resolved_invocations",
    "runtime_guidance",
    "warnings",
  ] as const;
  for (const field of requiredArrayFields) {
    if (!Array.isArray(profile[field])) {
      throw new Error(`Invalid profile: missing or invalid ${field}`);
    }
  }

  if (
    typeof profile.flow_stack !== "object" ||
    profile.flow_stack === null ||
    !Array.isArray(profile.flow_stack.slots)
  ) {
    throw new Error("Invalid profile: missing or invalid flow_stack");
  }

  if (
    typeof profile.classification !== "object" ||
    profile.classification === null ||
    !Array.isArray(profile.classification.categories)
  ) {
    throw new Error("Invalid profile: missing or invalid classification");
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

  // A catalog that parses but lacks the skills array is invalid input,
  // not an absent catalog — fail closed rather than letting handlers
  // dereference it.
  if (catalog && !Array.isArray(catalog.skills)) {
    throw new Error("Invalid catalog: missing or invalid skills");
  }

  // Load co-located validation report, then fallback to discovered .sdp root.
  // A present-but-malformed report is an invalid artifact, not an absent one —
  // fail closed rather than letting handlers read undefined fields.
  const validationReport =
    loadValidationReport(path.join(profileDir, "validation-report.json")) ||
    (rootSdpDir
      ? loadValidationReport(path.join(rootSdpDir, "validation-report.json"))
      : null);

  return { profile, catalog, validationReport, args };
}

function loadValidationReport(filePath: string): ValidationReport | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`Invalid validation report: ${filePath} is not valid JSON`);
  }
  const result = ValidationReportSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid validation report: ${filePath} does not match the report schema`);
  }
  return result.data;
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
