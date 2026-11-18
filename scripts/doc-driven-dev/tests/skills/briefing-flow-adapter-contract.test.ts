import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import * as yaml from "js-yaml";

const adapterPath = path.resolve(
  __dirname,
  "../../../../packages/doc-driven-dev/.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml",
);

function loadAdapter(): any {
  return yaml.load(fs.readFileSync(adapterPath, "utf8"));
}

// Issue #244: briefing is a sufficiency contract, not a generation contract.
// The spec/ADR output slots are conditional — the flow audits and reuses
// existing documents and only creates or updates them when sufficiency fails.
test("briefing adapter makes spec/ADR output slots conditional on sufficiency", () => {
  const adapter = loadAdapter();
  const slots = adapter.flow_stack.slots;

  for (const [slotId, skill] of [["spec_output", "spec-doc"], ["adr_output", "adr-doc"]] as const) {
    const slot = slots.find((entry: { slot_id: string }) => entry.slot_id === slotId);
    assert.ok(slot, `${slotId} slot should exist`);
    assert.equal(slot.activation, "conditional", `${slotId} must not be always-on`);
    assert.equal(slot.slot_type, "layerable");
    const defaults = slot.default as { skill: string; reason: string }[];
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].skill, skill);
    assert.match(defaults[0].reason, /existing|reuse|sufficien/i);
  }
});

test("briefing adapter never defaults to legacy migration-only writers", () => {
  const adapter = loadAdapter();
  for (const slot of adapter.flow_stack.slots as { default?: { skill: string }[] }[]) {
    for (const entry of slot.default ?? []) {
      assert.ok(
        !["test-spec-doc", "impl-doc", "plan-doc", "task-doc"].includes(entry.skill),
        `${entry.skill} is migration-only/execution-bound and must not be a flow default`,
      );
    }
  }
});
