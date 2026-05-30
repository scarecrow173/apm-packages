"use strict";

const fs = require("node:fs");
const path = require("node:path");

import type { FlowProfile, SkillReferenceCatalog } from "../types";
import type { QueryArgs, QueryContext, ValidationReport } from "./registry";

export function loadQueryContext(args: QueryArgs): QueryContext {
  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const profilePath = path.resolve(cwd, args.profile!);

  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found: ${profilePath}`);
  }

  const profileContent = fs.readFileSync(profilePath, "utf8");
  const profile: FlowProfile = JSON.parse(profileContent);

  // Schema pre-validation
  if (!profile.schema_version) {
    throw new Error("Invalid profile: missing schema_version");
  }

  // Load co-located catalog
  const profileDir = path.dirname(profilePath);
  const catalog = loadOptionalJson<SkillReferenceCatalog>(
    path.join(profileDir, "skill-reference-catalog.json"),
  );

  // Load co-located validation report
  const validationReport = loadOptionalJson<ValidationReport>(
    path.join(profileDir, "validation-report.json"),
  );

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
