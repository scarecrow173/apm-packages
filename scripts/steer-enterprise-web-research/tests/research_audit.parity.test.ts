import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function mkResearchFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "steer-audit-parity-"));
  const research = path.join(root, "research");
  fs.mkdirSync(research, { recursive: true });

  fs.writeFileSync(path.join(research, "todo.md"), "- [ ] done\n", "utf8");
  fs.writeFileSync(path.join(research, "persona.md"), "persona\n", "utf8");
  fs.writeFileSync(path.join(research, "query-log.md"), "| q | r |\n|---|---|\n| a | b |\n", "utf8");
  fs.writeFileSync(path.join(research, "evidence-ledger.md"), "| source_id | claim |\n|---|---|\n| S1 | c1 |\n| S2 | c2 |\n", "utf8");
  fs.writeFileSync(path.join(research, "running-summary.md"), "summary\n", "utf8");
  fs.writeFileSync(path.join(research, "audit.md"), "sufficient\n", "utf8");
  fs.writeFileSync(path.join(research, "final-report.md"), "Confidence: High\nS1\nS2\n", "utf8");

  return root;
}

function run(cmd: string, args: string[], cwd: string) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", windowsHide: true });
}

test("python and typescript audit return same exit code and summary", () => {
  const root = mkResearchFixture();
  const repoRoot = path.resolve(process.cwd(), "..", "..");

  const pythonScript = String.raw`
from __future__ import annotations

import re
import sys
from pathlib import Path

REQUIRED_FILES = [
  "todo.md",
  "persona.md",
  "query-log.md",
  "evidence-ledger.md",
  "running-summary.md",
  "audit.md",
  "final-report.md",
]


def read(path: Path) -> str:
  return path.read_text(encoding="utf-8") if path.exists() else ""


def has_table_rows(md: str) -> bool:
  lines = [line.strip() for line in md.splitlines()]
  data_rows = [
    line for line in lines
    if line.startswith("|") and line.endswith("|") and not re.match(r"^\|[-:\s|]+\|$", line)
  ]
  return len(data_rows) >= 2


def count_source_ids(md: str) -> int:
  return len(set(re.findall(r"\bS\d+\b", md)))


def audit(root: Path) -> list[tuple[str, bool, str]]:
  checks: list[tuple[str, bool, str]] = []

  for filename in REQUIRED_FILES:
    file_path = root / filename
    exists = file_path.exists()
    checks.append((
      f"required file: {filename}",
      exists,
      "exists" if exists else "missing",
    ))

  evidence = read(root / "evidence-ledger.md")
  final = read(root / "final-report.md")
  query_log = read(root / "query-log.md")
  audit_md = read(root / "audit.md")

  checks.append((
    "evidence ledger has table rows",
    has_table_rows(evidence),
    "evidence table appears populated" if has_table_rows(evidence) else "evidence table appears empty",
  ))

  source_count = count_source_ids(evidence + "\n" + final)
  checks.append((
    "source identifiers present",
    source_count >= 2,
    f"found {source_count} unique S# identifiers",
  ))

  checks.append((
    "query log has entries",
    has_table_rows(query_log),
    "query log appears populated" if has_table_rows(query_log) else "query log appears empty",
  ))

  unresolved_markers = ["needs-more-search", "insufficient-tools", "remaining gaps", "unresolved"]
  has_disclosed_gaps = any(marker in audit_md.lower() or marker in final.lower() for marker in unresolved_markers)
  has_sufficient = "sufficient" in audit_md.lower()

  checks.append((
    "sufficiency decision present",
    has_sufficient or has_disclosed_gaps,
    "found sufficiency/gap marker" if has_sufficient or has_disclosed_gaps else "no sufficiency or gap marker found",
  ))

  confidence_labels = ["High", "Medium", "Low", "高", "中", "低"]
  has_confidence = any(label in final for label in confidence_labels)
  checks.append((
    "confidence labels present",
    has_confidence,
    "found confidence labels" if has_confidence else "no confidence labels found",
  ))

  return checks


def main() -> int:
  root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("research")
  checks = audit(root)

  print(f"Research audit: {root}")
  failures = 0

  for name, passed, detail in checks:
    status = "PASS" if passed else "FAIL"
    print(f"[{status}] {name}: {detail}")
    if not passed:
      failures += 1

  if failures:
    print(f"\nResult: NOT READY ({failures} failed checks)")
    raise SystemExit(1)

  print("\nResult: structurally ready for human review")
  raise SystemExit(0)


if __name__ == "__main__":
  raise SystemExit(main())
`;

  const py = run("python", ["-c", pythonScript, path.join(root, "research")], repoRoot);
  const ts = run("node", ["packages/steer-enterprise-web-research/scripts/research_audit.js", path.join(root, "research")], repoRoot);

  assert.equal(ts.status, py.status);

  const tsLines = ts.stdout.split(/\r?\n/).filter((line) => line.startsWith("[PASS]") || line.startsWith("[FAIL]") || line.startsWith("Result:"));
  const pyLines = py.stdout.split(/\r?\n/).filter((line) => line.startsWith("[PASS]") || line.startsWith("[FAIL]") || line.startsWith("Result:"));

  assert.deepEqual(tsLines, pyLines);
});