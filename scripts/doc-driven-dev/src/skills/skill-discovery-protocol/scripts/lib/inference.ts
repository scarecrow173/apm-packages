"use strict";

const fs = require("node:fs");
const path = require("node:path");

import { SkillScanListDocumentSchema } from "./schemas/scan";
import { SkillReferenceInferenceDocumentSchema } from "./schemas/inference";
const { validateInferenceCompleteness } = require("./inference_validation.ts");
import type {
  RawScannedSkill,
  ScannedSkill,
  SkillScanListDocument,
  SkillReferenceInference,
  SkillReferenceInferenceDocument,
} from "./types";

function defaultScanListPath(cwd: string): string {
  return path.join(cwd, ".sdp", "skill-scan-list.json");
}

function defaultInferencePath(cwd: string): string {
  return path.join(cwd, ".sdp", "skill-reference-inferences.json");
}

function loadInferenceDocument(filePath: string): SkillReferenceInferenceDocument | null {
  if (!fs.existsSync(filePath)) return null;
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const parsed = SkillReferenceInferenceDocumentSchema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid skill reference inference document: ${details}`);
  }
  return parsed.data as SkillReferenceInferenceDocument;
}

function readInferenceOrThrow(filePath: string): SkillReferenceInferenceDocument {
  const loaded = loadInferenceDocument(filePath);
  if (!loaded) {
    throw new Error(`Inference file not found: ${filePath}`);
  }
  return loaded;
}

function writeInferenceDocument(filePath: string, doc: SkillReferenceInferenceDocument): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

function buildScanList(rawSkills: RawScannedSkill[]): SkillScanListDocument {
  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    skills: rawSkills,
  };
}

function writeScanList(cwd: string, rawSkills: RawScannedSkill[]): string {
  const outputPath = defaultScanListPath(cwd);
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(buildScanList(rawSkills), null, 2) + "\n", "utf8");
  return outputPath;
}

function loadScanList(filePath: string): SkillScanListDocument {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const parsed = SkillScanListDocumentSchema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid skill scan list document: ${details}`);
  }
  return parsed.data as SkillScanListDocument;
}

function enrichSkills(rawSkills: RawScannedSkill[], inferenceDoc: SkillReferenceInferenceDocument): ScannedSkill[] {
  const byName = new Map<string, SkillReferenceInference>();
  for (const inference of inferenceDoc.skills) {
    byName.set(inference.name, inference);
  }

  const missing = rawSkills.filter((skill) => !byName.has(skill.name)).map((skill) => skill.name).sort();
  if (missing.length > 0) {
    throw new Error(`Missing inferred skill references for: ${missing.join(", ")}`);
  }

  const rawNames = new Set(rawSkills.map((skill) => skill.name));
  const stale = inferenceDoc.skills.filter((skill) => !rawNames.has(skill.name)).map((skill) => skill.name).sort();
  if (stale.length > 0) {
    throw new Error(`Inference document contains skills that were not scanned: ${stale.join(", ")}`);
  }

  return rawSkills.map((raw) => {
    const inferred = byName.get(raw.name)!;
    return {
      name: raw.name,
      description: raw.description,
      provides: inferred.provides,
      uses: inferred.uses,
      execution_policy: inferred.execution_policy,
      runtime_guidance: inferred.runtime_guidance,
      tags: inferred.tags,
    };
  });
}

function assertInferenceComplete(
  scanList: SkillScanListDocument,
  inferenceDoc: SkillReferenceInferenceDocument,
): void {
  const result = validateInferenceCompleteness(scanList, inferenceDoc);
  if (!result.ok) {
    throw new Error(result.message);
  }
}

module.exports = {
  defaultScanListPath,
  defaultInferencePath,
  loadInferenceDocument,
  readInferenceOrThrow,
  writeInferenceDocument,
  buildScanList,
  writeScanList,
  loadScanList,
  enrichSkills,
  assertInferenceComplete,
};
