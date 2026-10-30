import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDelegateHandoff,
  selectDelegateMode,
  toExecutionMode,
  type PolicyFacts,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/delegate_policy";

const ALL_MODES = new Set(["same-context", "subagent-as-tool", "isolated-subagent"] as const);

function facts(partial: Partial<PolicyFacts> = {}): PolicyFacts {
  return {
    effectId: "briefing-flow", stage: "delegate",
    independentScope: false, sharedJudgment: false,
    contextCost: "low", parallelCandidate: false,
    hostCapabilities: ALL_MODES,
    ...partial,
  };
}

test("tightly coupled work stays same-context", () => {
  const decision = selectDelegateMode(facts({ sharedJudgment: true }));
  assert.equal(decision.mode, "same-context");
  assert.ok(decision.reasons.includes("shared-judgment"));
});

test("independent scope with parallel candidacy selects isolated subagent", () => {
  const decision = selectDelegateMode(facts({ independentScope: true, parallelCandidate: true }));
  assert.equal(decision.mode, "isolated-subagent");
});

test("independent research without parallelism selects subagent-as-tool", () => {
  const decision = selectDelegateMode(facts({ independentScope: true }));
  assert.equal(decision.mode, "subagent-as-tool");
});

test("high context cost favors delegation when host supports it", () => {
  const decision = selectDelegateMode(facts({ contextCost: "high" }));
  assert.equal(decision.mode, "subagent-as-tool");
});

test("host-unsupported mode falls back with recorded reason, never silently", () => {
  const caps = new Set(["same-context"] as const);
  const decision = selectDelegateMode(facts({
    independentScope: true, parallelCandidate: true, hostCapabilities: caps,
  }));
  assert.equal(decision.mode, "same-context");
  assert.equal(decision.fallbackFrom, "isolated-subagent");
  assert.ok(decision.reasons.some((r) => r.startsWith("host-unsupported:")));
});

test("explicit override wins and records its reason", () => {
  const decision = selectDelegateMode(facts({
    sharedJudgment: true,
    override: { mode: "isolated-subagent", reason: "eval-fixture" },
  }));
  assert.equal(decision.mode, "isolated-subagent");
  assert.ok(decision.reasons.includes("override:eval-fixture"));
});

test("override to host-unsupported mode is refused, not switched silently", () => {
  const caps = new Set(["same-context"] as const);
  const decision = selectDelegateMode(facts({
    override: { mode: "isolated-subagent", reason: "eval" },
    hostCapabilities: caps,
  }));
  assert.equal(decision.mode, "same-context");
  assert.ok(decision.reasons.includes("host-unsupported:isolated-subagent"));
});

test("type and document kind alone never justify delegation", () => {
  const decision = selectDelegateMode(facts({ effectId: "design-doc" }));
  assert.equal(decision.mode, "same-context");
});

test("mode taxonomy maps onto the trace ExecutionMode enum", () => {
  assert.equal(toExecutionMode("same-context"), "same-context");
  assert.equal(toExecutionMode("subagent-as-tool"), "tool");
  assert.equal(toExecutionMode("isolated-subagent"), "subagent");
});

test("handoff carries mode, canonical refs, permissions, budget, completion — no summaries", () => {
  const handoff = buildDelegateHandoff({
    mode: "subagent",
    focus: ["docs/specs/0001-graph.md"],
    inputs: [{ path: "docs/specs/0001-graph.md", id: "SPEC-0001", fingerprint: "sha256:abc" }],
    sourceRefs: [{ path: "docs/discovery/0001-graph.md", id: "DISC-0001", fingerprint: "sha256:def" }],
    criteria: ["briefing gate passes"],
    permissions: { read: ["docs/**"], write: ["docs/specs/**", "docs/adr/**"] },
    toolLimits: ["read", "write", "exec:test"],
    maxHops: 4,
    completion: "EffectOutcome footer with canonical evidence",
  });
  assert.equal(handoff.executionMode, "subagent");
  assert.deepEqual(handoff.focus, ["docs/specs/0001-graph.md"]);
  assert.equal(handoff.authoritativeInputs[0].id, "SPEC-0001");
  assert.equal(handoff.budget.maxHops, 4);
  assert.equal(handoff.completion.includes("EffectOutcome"), true);
  assert.doesNotThrow(() => JSON.stringify(handoff));
  assert.deepEqual(JSON.parse(JSON.stringify(handoff)), handoff);
});
