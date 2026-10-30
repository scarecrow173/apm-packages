"use strict";

import fs from "node:fs";
import path from "node:path";

type DeterministicComparison = {
  target: string;
  diff_found: boolean;
};

type DeterministicResult = {
  result: "pass" | "fail" | "skipped";
  comparisons: DeterministicComparison[];
  reason?: string;
};

/**
 * Strip timestamp fields from a JSON string for comparison.
 */
function stripTimestampsForCompare(content: string): string {
  return content
    .replace(/"generated_at"\s*:\s*"[^"]*"/g, '"generated_at": ""')
    .replace(/"validated_at"\s*:\s*"[^"]*"/g, '"validated_at": ""');
}

/**
 * Which artifact targets a `validation.deterministic.compare` entry selects.
 * Entries are document-level selectors, not file labels: the composite
 * "profile+catalog-artifacts" selects both regenerated artifacts. Entries
 * that name no regenerated artifact — e.g. "validation-report:exclude-
 * timestamp", which records that timestamp fields are stripped from every
 * comparison (see stripTimestampsForCompare) — select nothing.
 */
const COMPARE_TARGET_LABELS: Record<string, string[]> = {
  profile: ["profile"],
  catalog: ["catalog"],
  "profile+catalog-artifacts": ["profile", "catalog"],
};

/**
 * Run the deterministic gate:
 * 1. Save current profile/catalog
 * 2. Re-run generate via adapter
 * 3. Compare outputs (excluding timestamps)
 * 4. Report diff
 */
function runDeterministicGate(
  profilePath: string | null,
  catalogPath: string | null,
  adapterPath: string | null,
  cwd: string,
  compare?: string[],
  referencesPath?: string | null,
): DeterministicResult {
  if (!adapterPath) {
    return {
      result: "skipped",
      comparisons: [],
      reason: "No --adapter provided; deterministic gate skipped",
    };
  }

  if (!fs.existsSync(adapterPath)) {
    return {
      result: "skipped",
      comparisons: [],
      reason: `Adapter not found: ${adapterPath}`,
    };
  }

  // Save current artifacts
  const savedArtifacts: { path: string; content: string }[] = [];
  let targets: { path: string; label: string }[] = [];

  if (profilePath && fs.existsSync(profilePath)) {
    savedArtifacts.push({ path: profilePath, content: fs.readFileSync(profilePath, "utf8") });
    targets.push({ path: profilePath, label: "profile" });
  }
  if (catalogPath && fs.existsSync(catalogPath)) {
    savedArtifacts.push({ path: catalogPath, content: fs.readFileSync(catalogPath, "utf8") });
    targets.push({ path: catalogPath, label: "catalog" });
  }

  // If compare config is provided, keep only the artifacts its entries
  // select. An entry that maps to no artifact target (unknown or
  // documentational) selects nothing; a compare list selecting no
  // artifacts leaves the gate with no targets and it reports "skipped".
  if (compare && compare.length > 0) {
    const selectedLabels = new Set(
      compare.flatMap((entry) => COMPARE_TARGET_LABELS[entry] ?? []),
    );
    targets = targets.filter((t) => selectedLabels.has(t.label));
  }

  if (targets.length === 0) {
    return {
      result: "skipped",
      comparisons: [],
      reason: "No artifacts to compare",
    };
  }

  // Re-run generation
  try {
    const { loadAdapter } = require("../adapter.ts");
    const { scanSkills } = require("../scanner.ts");
    const { buildCatalog } = require("../catalog.ts");
    const { classifySkills } = require("../classifier.ts");
    const { resolveInvocations } = require("../resolver.ts");
    const { buildProfile } = require("../profile.ts");
    const { stabilizeCatalog, stabilizeProfile, renderJson } = require("../renderer.ts");
    const {
      defaultInferencePath,
      writeScanList,
      loadScanList,
      loadInferenceDocument,
      enrichSkills,
    } = require("../inference.ts");

    const adapter = loadAdapter(adapterPath);
    const rawSkills = scanSkills(cwd, adapter);
    const scanListPath = writeScanList(cwd, rawSkills);
    const scanList = loadScanList(scanListPath);
    const inferencePath = referencesPath || defaultInferencePath(cwd);
    const inferenceDoc = loadInferenceDocument(inferencePath);
    if (!inferenceDoc) {
      throw new Error(`Missing skill reference inference document: ${inferencePath}`);
    }
    const skills = enrichSkills(scanList.skills, inferenceDoc);
    const catalog = stabilizeCatalog(buildCatalog(skills));
    const { categories, unmatched_skills } = classifySkills(skills, adapter);
    const resolvedInvocations = resolveInvocations(skills, adapter);
    const profile = stabilizeProfile(
      buildProfile(adapter, catalog, categories, unmatched_skills, resolvedInvocations, skills),
    );

    const newCatalogJson = renderJson(catalog);
    const newProfileJson = renderJson(profile);

    const comparisons: DeterministicComparison[] = [];

    for (const target of targets) {
      const originalContent = savedArtifacts.find((a) => a.path === target.path)!.content;
      const newContent = target.label === "profile" ? newProfileJson : newCatalogJson;

      const originalNorm = stripTimestampsForCompare(originalContent);
      const newNorm = stripTimestampsForCompare(newContent);

      comparisons.push({
        target: target.label,
        diff_found: originalNorm !== newNorm,
      });
    }

    const hasDiff = comparisons.some((c) => c.diff_found);

    return {
      result: hasDiff ? "fail" : "pass",
      comparisons,
    };
  } catch (e: unknown) {
    return {
      result: "fail",
      comparisons: [],
      reason: `Generation failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export { runDeterministicGate, stripTimestampsForCompare };
