#!/usr/bin/env python3
"""
Lightweight static audit for SteER-style research artifacts.

Usage:
  python scripts/research_audit.py research

This does not verify factual correctness. It checks whether the expected
research artifacts contain the minimum structural evidence needed before
a report is treated as "ready".
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from dataclasses import dataclass


REQUIRED_FILES = [
    "todo.md",
    "persona.md",
    "query-log.md",
    "evidence-ledger.md",
    "running-summary.md",
    "audit.md",
    "final-report.md",
]


@dataclass
class Check:
    name: str
    passed: bool
    detail: str


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


def audit(root: Path) -> list[Check]:
    checks: list[Check] = []

    for filename in REQUIRED_FILES:
        path = root / filename
        checks.append(Check(
            f"required file: {filename}",
            path.exists(),
            "exists" if path.exists() else "missing",
        ))

    evidence = read(root / "evidence-ledger.md")
    final = read(root / "final-report.md")
    query_log = read(root / "query-log.md")
    audit_md = read(root / "audit.md")

    checks.append(Check(
        "evidence ledger has table rows",
        has_table_rows(evidence),
        "evidence table appears populated" if has_table_rows(evidence) else "evidence table appears empty",
    ))

    source_count = count_source_ids(evidence + "\n" + final)
    checks.append(Check(
        "source identifiers present",
        source_count >= 2,
        f"found {source_count} unique S# identifiers",
    ))

    checks.append(Check(
        "query log has entries",
        has_table_rows(query_log),
        "query log appears populated" if has_table_rows(query_log) else "query log appears empty",
    ))

    unresolved_markers = ["needs-more-search", "insufficient-tools", "remaining gaps", "unresolved"]
    has_disclosed_gaps = any(marker in audit_md.lower() or marker in final.lower() for marker in unresolved_markers)
    has_sufficient = "sufficient" in audit_md.lower()

    checks.append(Check(
        "sufficiency decision present",
        has_sufficient or has_disclosed_gaps,
        "found sufficiency/gap marker" if has_sufficient or has_disclosed_gaps else "no sufficiency or gap marker found",
    ))

    confidence_labels = ["High", "Medium", "Low", "高", "中", "低"]
    checks.append(Check(
        "confidence labels present",
        any(label in final for label in confidence_labels),
        "found confidence labels" if any(label in final for label in confidence_labels) else "no confidence labels found",
    ))

    return checks


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("research")
    checks = audit(root)

    print(f"Research audit: {root}")
    failures = 0

    for check in checks:
        status = "PASS" if check.passed else "FAIL"
        print(f"[{status}] {check.name}: {check.detail}")
        if not check.passed:
            failures += 1

    if failures:
        print(f"\nResult: NOT READY ({failures} failed checks)")
        return 1

    print("\nResult: structurally ready for human review")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
