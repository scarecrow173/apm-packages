const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const adapterPath = path.resolve(
  __dirname,
  "../../../../packages/doc-driven-dev/.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml",
);

function loadAdapter() {
  return yaml.load(fs.readFileSync(adapterPath, "utf8"));
}

test("implementation-flow adapter declares subagent cost capability slots", () => {
  const adapter = loadAdapter();
  const slots = adapter.flow_stack.slots;

  const subagentSlot = slots.find((slot: { slot_id: string }) => slot.slot_id === "subagent_utilization");
  assert.deepEqual(subagentSlot, {
    slot_id: "subagent_utilization",
    slot_type: "layerable",
    activation: "conditional",
  });

  const costSlot = slots.find((slot: { slot_id: string }) => slot.slot_id === "cost_optimization");
  assert.deepEqual(costSlot, {
    slot_id: "cost_optimization",
    slot_type: "layerable",
    activation: "conditional",
  });
});

test("implementation-flow taxonomy exposes subagent cost capability vocabulary", () => {
  const adapter = loadAdapter();
  const taxonomy = adapter.classification.taxonomy;

  const build = taxonomy.find((entry: { id: string }) => entry.id === "build");
  assert.ok(build, "build taxonomy entry should exist");
  assert.ok(
    build.match.capabilities.includes("subagent_dispatch"),
    "build taxonomy should classify subagent dispatch capability",
  );
  assert.ok(build.match.tags.includes("subagent"), "build taxonomy should classify subagent tags");
  assert.ok(
    build.match.description_patterns.includes("subagent"),
    "build taxonomy should classify subagent description patterns",
  );
  assert.ok(
    build.match.description_patterns.includes("delegat"),
    "build taxonomy should classify delegation description patterns",
  );

  const tooling = taxonomy.find((entry: { id: string }) => entry.id === "tooling");
  assert.ok(tooling, "tooling taxonomy entry should exist");
  assert.ok(
    tooling.match.capabilities.includes("cost_optimization"),
    "tooling taxonomy should classify cost optimization capability",
  );
  assert.ok(
    tooling.match.capabilities.includes("model_cost_control"),
    "tooling taxonomy should classify model cost control capability",
  );
  assert.ok(tooling.match.tags.includes("cost"), "tooling taxonomy should classify cost tags");
  assert.ok(
    tooling.match.tags.includes("model-selection"),
    "tooling taxonomy should classify model-selection tags",
  );
  assert.ok(
    tooling.match.description_patterns.includes("low-cost"),
    "tooling taxonomy should classify low-cost description patterns",
  );
});
