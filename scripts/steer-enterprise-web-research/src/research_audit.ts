#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const REQUIRED_FILES = [
  "todo.md",
  "persona.md",
  "query-log.md",
  "evidence-ledger.md",
  "running-summary.md",
  "audit.md",
  "final-report.md",
] as const;

export type Check = {
  name: string;
  passed: boolean;
  detail: string;
};

function read(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

export function hasTableRows(md: string): boolean {
  const lines = md.split(/\r?\n/).map((line) => line.trim());
  const dataRows = lines.filter(
    (line) => line.startsWith("|") && line.endsWith("|") && !/^\|[-:\s|]+\|$/.test(line),
  );
  return dataRows.length >= 2;
}

export function countSourceIds(md: string): number {
  const ids = new Set(md.match(/\bS\d+\b/g) ?? []);
  return ids.size;
}

export function hasSufficiencyDecision(auditMd: string, finalMd: string): boolean {
  const unresolvedMarkers = ["needs-more-search", "insufficient-tools", "remaining gaps", "unresolved"];
  const loweredAudit = auditMd.toLowerCase();
  const loweredFinal = finalMd.toLowerCase();
  const hasDisclosedGaps = unresolvedMarkers.some(
    (marker) => loweredAudit.includes(marker) || loweredFinal.includes(marker),
  );
  const hasSufficient = loweredAudit.includes("sufficient");
  return hasSufficient || hasDisclosedGaps;
}

export function audit(root: string): Check[] {
  const checks: Check[] = [];

  for (const filename of REQUIRED_FILES) {
    const full = path.join(root, filename);
    const exists = fs.existsSync(full);
    checks.push({
      name: `required file: ${filename}`,
      passed: exists,
      detail: exists ? "exists" : "missing",
    });
  }

  const evidence = read(path.join(root, "evidence-ledger.md"));
  const final = read(path.join(root, "final-report.md"));
  const queryLog = read(path.join(root, "query-log.md"));
  const auditMd = read(path.join(root, "audit.md"));

  checks.push({
    name: "evidence ledger has table rows",
    passed: hasTableRows(evidence),
    detail: hasTableRows(evidence) ? "evidence table appears populated" : "evidence table appears empty",
  });

  const sourceCount = countSourceIds(`${evidence}\n${final}`);
  checks.push({
    name: "source identifiers present",
    passed: sourceCount >= 2,
    detail: `found ${sourceCount} unique S# identifiers`,
  });

  checks.push({
    name: "query log has entries",
    passed: hasTableRows(queryLog),
    detail: hasTableRows(queryLog) ? "query log appears populated" : "query log appears empty",
  });

  const hasDecision = hasSufficiencyDecision(auditMd, final);
  checks.push({
    name: "sufficiency decision present",
    passed: hasDecision,
    detail: hasDecision ? "found sufficiency/gap marker" : "no sufficiency or gap marker found",
  });

  const confidenceLabels = ["High", "Medium", "Low", "高", "中", "低"];
  const hasConfidence = confidenceLabels.some((label) => final.includes(label));
  checks.push({
    name: "confidence labels present",
    passed: hasConfidence,
    detail: hasConfidence ? "found confidence labels" : "no confidence labels found",
  });

  return checks;
}

export function runCli(argv: string[]): number {
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
    console.log(`\nResult: NOT READY (${failures} failed checks)`);
    return 1;
  }

  console.log("\nResult: structurally ready for human review");
  return 0;
}

if (require.main === module) {
  process.exitCode = runCli(process.argv);
}