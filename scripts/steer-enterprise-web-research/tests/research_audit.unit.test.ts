import assert from "node:assert/strict";
import test from "node:test";

import { resolveOutputPath } from "../build/build-research-audit";
import {
  countSourceIds,
  hasSufficiencyDecision,
  hasTableRows,
} from "../src/research_audit";

test("resolveOutputPath points to package artifact location", () => {
  const out = resolveOutputPath(path.join("workspace", "scripts", "steer-enterprise-web-research"));
  assert.equal(
    out.replaceAll("\\", "/").endsWith("/packages/steer-enterprise-web-research/scripts/research_audit.js"),
    true,
  );
});

test("hasTableRows returns true when markdown table has header + data row", () => {
  const md = [
    "| source_id | claim |",
    "|---|---|",
    "| S1 | A |",
  ].join("\n");
  assert.equal(hasTableRows(md), true);
});

test("hasTableRows returns false when table has only separator", () => {
  const md = ["| source_id | claim |", "|---|---|"].join("\n");
  assert.equal(hasTableRows(md), false);
});

test("countSourceIds deduplicates S# markers", () => {
  assert.equal(countSourceIds("S1 S2 S1"), 2);
});

test("hasSufficiencyDecision accepts sufficient marker", () => {
  assert.equal(hasSufficiencyDecision("Sufficient for handoff", ""), true);
});

test("hasSufficiencyDecision accepts unresolved marker disclosure", () => {
  assert.equal(hasSufficiencyDecision("", "remaining gaps in evidence"), true);
});