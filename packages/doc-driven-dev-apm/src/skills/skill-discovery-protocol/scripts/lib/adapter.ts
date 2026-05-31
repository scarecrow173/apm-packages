"use strict";

const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

import type { AdapterConfig } from "./types";

function loadYamlFile(filePath: string): unknown {
  const content = fs.readFileSync(filePath, "utf8");
  return yaml.load(content);
}

function resolveExtends(adapterDir: string, names: string[], visited: Set<string>): object[] {
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

    const yamlPath = path.join(adapterDir, "references", `${name}.yaml`);
    const ymlPath = path.join(adapterDir, "references", `${name}.yml`);
    const yamlExists = fs.existsSync(yamlPath);
    const ymlExists = fs.existsSync(ymlPath);

    if (yamlExists && ymlExists) {
      throw new Error(`Both ${name}.yaml and ${name}.yml exist — ambiguous extends`);
    }
    if (!yamlExists && !ymlExists) {
      throw new Error(`Cannot resolve extends "${name}": neither ${name}.yaml nor ${name}.yml found in references/`);
    }

    const parentPath = yamlExists ? yamlPath : ymlPath;
    const parent = loadYamlFile(parentPath) as Record<string, unknown>;

    if (parent.extends && Array.isArray(parent.extends)) {
      const grandparents = resolveExtends(adapterDir, parent.extends as string[], new Set(visited));
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

function loadAdapter(adapterPath: string): AdapterConfig {
  const absPath = path.resolve(adapterPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Adapter not found: ${adapterPath}`);
  }

  const raw = loadYamlFile(absPath) as Record<string, unknown>;
  const adapterDir = path.dirname(absPath);

  let merged: Record<string, unknown> = {};

  if (raw.extends && Array.isArray(raw.extends)) {
    const parents = resolveExtends(adapterDir, raw.extends as string[], new Set<string>());
    for (const parent of parents) {
      merged = deepMerge(merged, parent as Record<string, unknown>);
    }
  }

  merged = deepMerge(merged, raw);
  delete merged.extends;

  // Validate required keys
  const requiredKeys = [
    "schema_version", "adapter_id", "protocol", "scan", "profile",
    "flow_stack", "classification", "invocation_resolution", "validation",
    "render", "artifacts", "readable_outputs",
  ];
  const missing = requiredKeys.filter((k) => !(k in merged));
  if (missing.length > 0) {
    throw new Error(`Adapter missing required keys: ${missing.join(", ")}`);
  }

  return merged as unknown as AdapterConfig;
}

module.exports = { loadAdapter, loadYamlFile, deepMerge };
