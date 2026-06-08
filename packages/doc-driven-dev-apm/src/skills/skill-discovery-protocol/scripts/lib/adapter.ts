"use strict";

const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

import type { AdapterConfig } from "./types";

function loadYamlFile(filePath: string): unknown {
  const content = fs.readFileSync(filePath, "utf8");
  return yaml.load(content);
}

function resolveExtends(searchDirs: string[], names: string[], visited: Set<string>): object[] {
  const results: object[] = [];
  for (const name of names) {
    // Prevent path traversal in extends names
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new Error(`Invalid extends name "${name}": must be a simple identifier (no path separators or '..')`);
    }
    if (visited.has(name)) {
      throw new Error(`Circular extends detected: "${name}" already in chain [${[...visited].join(" -> ")}]`);
    }
    visited.add(name);

    let parentPath: string | null = null;
    for (const dir of searchDirs) {
      const yamlPath = path.join(dir, `${name}.yaml`);
      const ymlPath = path.join(dir, `${name}.yml`);
      const yamlExists = fs.existsSync(yamlPath);
      const ymlExists = fs.existsSync(ymlPath);

      if (yamlExists && ymlExists) {
        throw new Error(`Both ${name}.yaml and ${name}.yml exist in ${dir} — ambiguous extends`);
      }
      if (yamlExists) { parentPath = yamlPath; break; }
      if (ymlExists) { parentPath = ymlPath; break; }
    }

    if (!parentPath) {
      const searched = searchDirs.join(", ");
      throw new Error(`Cannot resolve extends "${name}": not found in [${searched}]`);
    }

    const parent = loadYamlFile(parentPath) as Record<string, unknown>;

    if (parent.extends && Array.isArray(parent.extends)) {
      const grandparents = resolveExtends(searchDirs, parent.extends as string[], new Set(visited));
      results.push(...grandparents);
    }

    results.push(parent);
  }
  return results;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal !== null && typeof srcVal === "object" && !Array.isArray(srcVal) &&
      tgtVal !== null && typeof tgtVal === "object" && !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

function findAdapterSearchDirs(adapterDir: string): string[] {
  const dirs: string[] = [];
  // Search only within the current skill tree first so legacy root copies
  // outside .apm/skills are never considered.
  let current = adapterDir;
  const skillTreeRoot = path.resolve(adapterDir, "..", "..", "..");
  for (;;) {
    const candidate = path.join(current, "assets", "adapters");
    if (fs.existsSync(candidate)) {
      dirs.push(candidate);
    }
    const parent = path.dirname(current);
    if (current === skillTreeRoot || parent === current) break;
    current = parent;
  }

  const bundledAdaptersDir = path.resolve(__dirname, "..", "..", "assets", "adapters");
  if (fs.existsSync(bundledAdaptersDir) && !dirs.includes(bundledAdaptersDir)) {
    dirs.push(bundledAdaptersDir);
  }
  return dirs;
}

function loadAdapter(adapterPath: string): AdapterConfig {
  const absPath = path.resolve(adapterPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Adapter not found: ${adapterPath}`);
  }

  const raw = loadYamlFile(absPath) as Record<string, unknown>;
  const adapterDir = path.dirname(absPath);

  // Build search paths for extends resolution by walking up from adapter location
  const searchDirs = findAdapterSearchDirs(adapterDir);

  let merged: Record<string, unknown> = {};

  if (raw.extends && Array.isArray(raw.extends)) {
    const parents = resolveExtends(searchDirs, raw.extends as string[], new Set<string>());
    for (const parent of parents) {
      merged = deepMerge(merged, parent as Record<string, unknown>);
    }
  }

  merged = deepMerge(merged, raw);
  delete merged.extends;

  // Apply compatibility defaults when omitted in leaf adapters.
  if (!("schema_version" in merged)) {
    merged.schema_version = "1.0";
  }
  if (!("protocol" in merged)) {
    merged.protocol = {
      name: "skill-discovery-protocol",
      min_version: "1.0",
    };
  }
  if (!("validation" in merged)) {
    merged.validation = {
      schema: true,
      staleness: {
        enabled: true,
        basis: "validated_at",
        max_age_days: 30,
      },
      deterministic: {
        enabled: true,
        compare: ["profile", "profile+catalog-artifacts", "validation-report:exclude-timestamp"],
      },
      invocation: {
        enabled: false,
      },
    };
  }
  if (typeof merged.validation === "object" && merged.validation !== null) {
    const v = merged.validation as Record<string, unknown>;
    if (!("schema" in v)) {
      v.schema = true;
    }

    if (typeof v.staleness === "object" && v.staleness !== null) {
      const s = v.staleness as Record<string, unknown>;
      if (!("enabled" in s)) s.enabled = true;
      if (!("basis" in s)) s.basis = "validated_at";
      if (!("max_age_days" in s)) s.max_age_days = 30;
    }

    if (typeof v.deterministic === "object" && v.deterministic !== null) {
      const d = v.deterministic as Record<string, unknown>;
      if (!("enabled" in d)) d.enabled = true;
      if (!("compare" in d)) {
        d.compare = ["profile", "profile+catalog-artifacts", "validation-report:exclude-timestamp"];
      }
    }

    if (typeof v.invocation === "object" && v.invocation !== null) {
      const i = v.invocation as Record<string, unknown>;
      if (!("enabled" in i)) i.enabled = false;
    }
  }
  if (!("artifacts" in merged)) {
    merged.artifacts = {
      protocol: {
        skill_reference_catalog: "skill-reference-catalog.json",
      },
    };
  }

  // Validate required keys
  const requiredKeys = [
    "adapter_id", "scan", "profile",
    "flow_stack", "classification", "invocation_resolution",
    "render", "readable_outputs",
  ];
  const missing = requiredKeys.filter((k) => !(k in merged));
  if (missing.length > 0) {
    throw new Error(`Adapter missing required keys: ${missing.join(", ")}`);
  }

  return merged as unknown as AdapterConfig;
}

module.exports = { loadAdapter, loadYamlFile, deepMerge };
