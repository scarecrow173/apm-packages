import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";
import test from "node:test";
import {
  canonicalEvidenceMatches, canonicalReference, captureBaseline,
  commitGatePasses, evidenceReceipts, hasEvidence, isReusableCompletedOutcome,
  OutcomeRejection, persistEvidence, persistOutcome, storedOutcomes,
  assertEffectOutcome,
  type CanonicalReference, type CompletedEffectOutcome,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";

const PROOF = "docs/tasks/0001-task.md";

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caller-runner-unit-"));
  fs.mkdirSync(path.join(dir, "docs/tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, PROOF),
    "---\nid: TASK-0001\ntype: task\nstatus: todo\n---\n# Task\n", "utf8");
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}
function writeDoc(dir: string, rel: string, data: Record<string, unknown>, body: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), matter.stringify(body, data), "utf8");
}
function ref(dir: string, rel: string): CanonicalReference { return canonicalReference(dir, rel); }

test("persistOutcome/storedOutcomes round-trips through canonical front matter", () => {
  const dir = repo();
  const outcome: CompletedEffectOutcome = {
    status: "completed", edgeId: "a-to-b", stage: "audit",
    effect: { kind: "audit", id: "spec" },
    authoritativeInputs: [ref(dir, PROOF)], evidence: [ref(dir, PROOF)],
    proof: { canonicalEvidence: ref(dir, PROOF) },
  };
  persistOutcome(dir, PROOF, outcome);
  assert.deepEqual(storedOutcomes(dir, PROOF), [outcome]);
  // outcome bookkeeping must not perturb the artifact's own fingerprint:
  // `effectOutcomes`/`checkpointEvidence` are stripped from the fingerprinted
  // front matter, so the hash equals the pre-bookkeeping canonical content.
  assert.equal(canonicalReference(dir, PROOF).fingerprint,
    crypto.createHash("sha256").update(matter.stringify("# Task\n", {
      id: "TASK-0001", type: "task", status: "todo",
    })).digest("hex"));
});

test("evidence receipts persist per-edge and hasEvidence detects them", () => {
  const dir = repo();
  assert.equal(hasEvidence(dir, PROOF, "a-to-b"), false);
  persistEvidence(dir, PROOF, "a-to-b");
  assert.equal(hasEvidence(dir, PROOF, "a-to-b"), true);
  assert.equal(hasEvidence(dir, PROOF, "other"), false);
  assert.equal(evidenceReceipts(dir, PROOF).length, 1);
});

test("commit gate requires dirty entries ⊆ baseline — head advance alone fails", () => {
  const dir = repo();
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: dir });
  const baseline = captureBaseline(dir);
  fs.writeFileSync(path.join(dir, "dirty.txt"), "x");
  assert.equal(commitGatePasses(baseline, captureBaseline(dir)), false);
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "w"], { cwd: dir });
  assert.equal(commitGatePasses(baseline, captureBaseline(dir)), true);
});

test("assertEffectOutcome rejects malformed outcomes with OutcomeRejection", () => {
  const dir = repo();
  const route = { edgeId: "a-to-b", taskGraph: null } as any; // minimal shape used by checks
  const good: CompletedEffectOutcome = {
    status: "completed", edgeId: "a-to-b", stage: "audit",
    effect: { kind: "audit", id: "spec" },
    authoritativeInputs: [ref(dir, PROOF)], evidence: [ref(dir, PROOF)],
    proof: { canonicalEvidence: ref(dir, PROOF) },
  };
  const inputs = good.authoritativeInputs;
  assert.doesNotThrow(() => assertEffectOutcome(dir, route, good, "audit", good.effect, inputs));
  assert.throws(() => assertEffectOutcome(dir, route,
    { ...good, edgeId: "wrong" }, "audit", good.effect, inputs), OutcomeRejection);
  assert.throws(() => assertEffectOutcome(dir, route,
    { ...good, proof: {} }, "audit", good.effect, inputs), OutcomeRejection);          // missing proof
  assert.throws(() => assertEffectOutcome(dir, route,
    { ...good, authoritativeInputs: [] }, "audit", good.effect, inputs), OutcomeRejection); // scope mismatch
  const stale = { ...good, evidence: [{ path: PROOF, id: "TASK-0001", fingerprint: "0".repeat(64) }] };
  assert.throws(() => assertEffectOutcome(dir, route, stale, "audit", good.effect, inputs), OutcomeRejection); // stale fingerprint
});

test("isReusableCompletedOutcome requires stored outcome with live fingerprint", () => {
  const dir = repo();
  const outcome: CompletedEffectOutcome = {
    status: "completed", edgeId: "a-to-b", stage: "audit",
    effect: { kind: "audit", id: "spec" },
    authoritativeInputs: [ref(dir, PROOF)], evidence: [ref(dir, PROOF)],
    proof: { canonicalEvidence: ref(dir, PROOF) },
  };
  const route = { edgeId: "a-to-b", taskGraph: null } as any;
  assert.equal(isReusableCompletedOutcome(dir, route, outcome), false); // not persisted
  persistOutcome(dir, PROOF, outcome);
  assert.equal(isReusableCompletedOutcome(dir, route, outcome), true);
  writeDoc(dir, PROOF, { id: "TASK-0001", type: "task", status: "todo" }, "# Changed\n");
  assert.equal(isReusableCompletedOutcome(dir, route, outcome), false); // stale
});
