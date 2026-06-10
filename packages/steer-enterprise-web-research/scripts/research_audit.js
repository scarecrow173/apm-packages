#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/research_audit.ts
var research_audit_exports = {};
__export(research_audit_exports, {
  audit: () => audit,
  countSourceIds: () => countSourceIds,
  hasSufficiencyDecision: () => hasSufficiencyDecision,
  hasTableRows: () => hasTableRows,
  runCli: () => runCli
});
module.exports = __toCommonJS(research_audit_exports);
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var REQUIRED_FILES = [
  "todo.md",
  "persona.md",
  "query-log.md",
  "evidence-ledger.md",
  "running-summary.md",
  "audit.md",
  "final-report.md"
];
function read(filePath) {
  return import_node_fs.default.existsSync(filePath) ? import_node_fs.default.readFileSync(filePath, "utf8") : "";
}
function hasTableRows(md) {
  const lines = md.split(/\r?\n/).map((line) => line.trim());
  const dataRows = lines.filter(
    (line) => line.startsWith("|") && line.endsWith("|") && !/^\|[-:\s|]+\|$/.test(line)
  );
  return dataRows.length >= 2;
}
function countSourceIds(md) {
  const ids = new Set(md.match(/\bS\d+\b/g) ?? []);
  return ids.size;
}
function hasSufficiencyDecision(auditMd, finalMd) {
  const unresolvedMarkers = ["needs-more-search", "insufficient-tools", "remaining gaps", "unresolved"];
  const loweredAudit = auditMd.toLowerCase();
  const loweredFinal = finalMd.toLowerCase();
  const hasDisclosedGaps = unresolvedMarkers.some(
    (marker) => loweredAudit.includes(marker) || loweredFinal.includes(marker)
  );
  const hasSufficient = loweredAudit.includes("sufficient");
  return hasSufficient || hasDisclosedGaps;
}
function audit(root) {
  const checks = [];
  for (const filename of REQUIRED_FILES) {
    const full = import_node_path.default.join(root, filename);
    const exists = import_node_fs.default.existsSync(full);
    checks.push({
      name: `required file: ${filename}`,
      passed: exists,
      detail: exists ? "exists" : "missing"
    });
  }
  const evidence = read(import_node_path.default.join(root, "evidence-ledger.md"));
  const final = read(import_node_path.default.join(root, "final-report.md"));
  const queryLog = read(import_node_path.default.join(root, "query-log.md"));
  const auditMd = read(import_node_path.default.join(root, "audit.md"));
  checks.push({
    name: "evidence ledger has table rows",
    passed: hasTableRows(evidence),
    detail: hasTableRows(evidence) ? "evidence table appears populated" : "evidence table appears empty"
  });
  const sourceCount = countSourceIds(`${evidence}
${final}`);
  checks.push({
    name: "source identifiers present",
    passed: sourceCount >= 2,
    detail: `found ${sourceCount} unique S# identifiers`
  });
  checks.push({
    name: "query log has entries",
    passed: hasTableRows(queryLog),
    detail: hasTableRows(queryLog) ? "query log appears populated" : "query log appears empty"
  });
  const hasDecision = hasSufficiencyDecision(auditMd, final);
  checks.push({
    name: "sufficiency decision present",
    passed: hasDecision,
    detail: hasDecision ? "found sufficiency/gap marker" : "no sufficiency or gap marker found"
  });
  const confidenceLabels = ["High", "Medium", "Low", "\u9AD8", "\u4E2D", "\u4F4E"];
  const hasConfidence = confidenceLabels.some((label) => final.includes(label));
  checks.push({
    name: "confidence labels present",
    passed: hasConfidence,
    detail: hasConfidence ? "found confidence labels" : "no confidence labels found"
  });
  return checks;
}
function runCli(argv) {
  const root = argv.length > 2 ? argv[2] : "research";
  const checks = audit(root);
  console.log(`Research audit: ${root}`);
  let failures = 0;
  for (const check of checks) {
    const status = check.passed ? "PASS" : "FAIL";
    console.log(`[${status}] ${check.name}: ${check.detail}`);
    if (!check.passed) failures += 1;
  }
  if (failures > 0) {
    console.log(`
Result: NOT READY (${failures} failed checks)`);
    return 1;
  }
  console.log("\nResult: structurally ready for human review");
  return 0;
}
if (require.main === module) {
  process.exitCode = runCli(process.argv);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  audit,
  countSourceIds,
  hasSufficiencyDecision,
  hasTableRows,
  runCli
});
