import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  inventoryAll,
  inventoryFlow,
} from "../src/skills/skill-discovery-protocol/scripts/lib/load_inventory";

const skillsRoot = path.resolve(
  __dirname,
  "../../../packages/doc-driven-dev/.apm/skills",
);

// ─── Fixture helpers ───

function writeFile(root: string, rel: string, content: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

const DEMO_BODY = `
# Demo Flow

## Load list

- Load [the guide](references/guide.md) for conventions.
- Run \`node scripts/do_thing.js --flag\`.
- Check \`.sdp/demo-flow-default/demo-profile.json\` before routing.
- If it does not exist → invoke \`skill-discovery-protocol\` with \`.apm/skills/demo-flow/assets/adapters/demo-adapter.yaml\`.
- See also \`references/missing-note.md\` when available.
- Use \`other-skill\` — see the [\`other-skill\` SKILL](../other-skill/SKILL.md) for details.
- Run \`sdp scan --adapter <yaml>\` then \`sdp validate\`.
- If needed, run \`node scripts/gone.js\` to repair.
`;

const DEMO_SKILL = `---
name: demo-flow
description: "Demo flow. Generates .sdp/demo-flow-default/demo-profile.json."
license: MIT
---
${DEMO_BODY}`;

const OTHER_SKILL = `---
name: other-skill
description: "Peer skill"
---

# Other Skill
`;

function createFixturePackage(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "load-inventory-test-"));
  writeFile(root, "demo-flow/SKILL.md", DEMO_SKILL);
  writeFile(root, "demo-flow/references/guide.md", "# Guide\n");
  writeFile(root, "demo-flow/scripts/do_thing.js", "console.log('x');\n");
  writeFile(root, "demo-flow/scripts/sdp.js", "// sdp cli stub\n");
  writeFile(root, "demo-flow/assets/adapters/demo-adapter.yaml", "schema_version: \"1.0\"\n");
  writeFile(root, "other-skill/SKILL.md", OTHER_SKILL);
  return root;
}

function directivesAt(
  inventory: ReturnType<typeof inventoryFlow>,
  line: number,
) {
  return inventory.directives.filter((d) => d.line === line);
}

// ─── Fixture tests ───

test("inventoryFlow classifies every directive kind with line and optional flag", () => {
  const root = createFixturePackage();
  const inventory = inventoryFlow(path.join(root, "demo-flow"), root);

  assert.equal(inventory.flow, "demo-flow");
  assert.equal(inventory.skillBytes, Buffer.byteLength(DEMO_SKILL, "utf8"));
  assert.equal(inventory.alwaysOnChars, DEMO_BODY.length);

  // line 3 (front matter): .sdp artifact inside the description is still a
  // load directive because the description is stage-0 loaded text.
  assert.deepEqual(directivesAt(inventory, 3), [
    {
      kind: "sdp-artifact",
      target: ".sdp/demo-flow-default/demo-profile.json",
      line: 3,
      optional: false,
    },
  ]);

  // line 11: markdown reference link.
  assert.deepEqual(directivesAt(inventory, 11), [
    {
      kind: "reference",
      target: "references/guide.md",
      line: 11,
      optional: false,
    },
  ]);

  // line 12: `node <script>` is a script directive.
  assert.deepEqual(directivesAt(inventory, 12), [
    {
      kind: "script",
      target: "scripts/do_thing.js",
      line: 12,
      optional: false,
    },
  ]);

  // line 13: .sdp path mention.
  assert.deepEqual(directivesAt(inventory, 13), [
    {
      kind: "sdp-artifact",
      target: ".sdp/demo-flow-default/demo-profile.json",
      line: 13,
      optional: false,
    },
  ]);

  // line 14: invoke verb + mount-point adapter path; the "- If ..." bullet
  // makes both directives optional.
  assert.deepEqual(directivesAt(inventory, 14), [
    {
      kind: "adapter",
      target: ".apm/skills/demo-flow/assets/adapters/demo-adapter.yaml",
      line: 14,
      optional: true,
    },
    {
      kind: "skill-invoke",
      target: "skill-discovery-protocol",
      line: 14,
      optional: true,
    },
  ]);

  // line 15: "See also" marks the reference optional.
  assert.deepEqual(directivesAt(inventory, 15), [
    {
      kind: "reference",
      target: "references/missing-note.md",
      line: 15,
      optional: true,
    },
  ]);

  // line 16: `use <name>` and `../<name>/SKILL.md` dedupe to one directive.
  // "See the" is not a marker (only "see also"), so not optional.
  assert.deepEqual(directivesAt(inventory, 16), [
    { kind: "skill-invoke", target: "other-skill", line: 16, optional: false },
  ]);

  // line 17: bare `sdp <verb>` invocations are script directives.
  assert.deepEqual(directivesAt(inventory, 17), [
    { kind: "script", target: "sdp scan", line: 17, optional: false },
    { kind: "script", target: "sdp validate", line: 17, optional: false },
  ]);

  // line 18: "If needed" marks the script optional.
  assert.deepEqual(directivesAt(inventory, 18), [
    {
      kind: "script",
      target: "scripts/gone.js",
      line: 18,
      optional: true,
    },
  ]);

  assert.equal(inventory.totals.directives, 11);
});

test("inventoryFlow resolves targets to package files and counts only shipped-kind misses", () => {
  const root = createFixturePackage();
  const inventory = inventoryFlow(path.join(root, "demo-flow"), root);
  const stat = (rel: string) => fs.statSync(path.join(root, rel)).size;

  assert.deepEqual(inventory.referencedFiles, [
    {
      path: ".sdp/demo-flow-default/demo-profile.json",
      exists: false,
      bytes: 0,
    },
    {
      path: "demo-flow/assets/adapters/demo-adapter.yaml",
      exists: true,
      bytes: stat("demo-flow/assets/adapters/demo-adapter.yaml"),
    },
    {
      path: "demo-flow/references/guide.md",
      exists: true,
      bytes: stat("demo-flow/references/guide.md"),
    },
    {
      path: "demo-flow/references/missing-note.md",
      exists: false,
      bytes: 0,
    },
    {
      path: "demo-flow/scripts/do_thing.js",
      exists: true,
      bytes: stat("demo-flow/scripts/do_thing.js"),
    },
    {
      path: "demo-flow/scripts/gone.js",
      exists: false,
      bytes: 0,
    },
    {
      path: "demo-flow/scripts/sdp.js",
      exists: true,
      bytes: stat("demo-flow/scripts/sdp.js"),
    },
    {
      path: "other-skill/SKILL.md",
      exists: true,
      bytes: stat("other-skill/SKILL.md"),
    },
    {
      path: "skill-discovery-protocol/SKILL.md",
      exists: false,
      bytes: 0,
    },
  ]);

  // Missing counts only reference/script/adapter targets: missing-note.md and
  // gone.js. The absent .sdp runtime artifact and the skill-invoke target are
  // recorded but not counted.
  assert.equal(inventory.totals.missing, 2);
  const expectedBytes =
    stat("demo-flow/assets/adapters/demo-adapter.yaml") +
    stat("demo-flow/references/guide.md") +
    stat("demo-flow/scripts/do_thing.js") +
    stat("demo-flow/scripts/sdp.js") +
    stat("other-skill/SKILL.md");
  assert.equal(inventory.totals.referencedBytes, expectedBytes);
});

test("inventoryAll inventories every skill dir with a SKILL.md, sorted by name", () => {
  const root = createFixturePackage();
  const result = inventoryAll(root);
  assert.deepEqual(
    result.flows.map((f) => f.flow),
    ["demo-flow", "other-skill"],
  );
  assert.equal(result.totals.flows, 2);
  assert.equal(result.flows[1].totals.directives, 0);
  assert.equal(
    result.totals.directives,
    result.flows.reduce((sum, f) => sum + f.totals.directives, 0),
  );
});

// ─── Real package tests ───

test("inventoryAll covers all 18 packaged skills", () => {
  const result = inventoryAll(skillsRoot);
  assert.equal(result.totals.flows, 18);
  assert.equal(result.flows.length, 18);
  assert.ok(result.totals.skillBytes > 0);
  assert.ok(result.totals.alwaysOnChars > 0);
});

test("implementation-flow exercises adapter, sdp-artifact, skill-invoke and references", () => {
  const result = inventoryAll(skillsRoot);
  const impl = result.flows.find((f) => f.flow === "implementation-flow");
  assert.ok(impl, "implementation-flow must be inventoried");

  const kinds = new Set(impl.directives.map((d) => d.kind));
  for (const kind of ["reference", "script", "sdp-artifact", "skill-invoke", "adapter"] as const) {
    assert.ok(kinds.has(kind), `implementation-flow should have ≥1 ${kind} directive`);
  }
  assert.ok(
    impl.directives.filter((d) => d.kind === "reference").length >= 3,
    "implementation-flow links several references",
  );
  assert.ok(
    impl.directives.some((d) => d.kind === "skill-invoke" && d.target === "skill-discovery-protocol"),
  );
  assert.ok(
    impl.directives.some((d) => d.kind === "adapter" && d.target.includes("implementation-adapter.yaml")),
  );
});

test("every shipped-kind directive target exists or is counted in missing", () => {
  const result = inventoryAll(skillsRoot);
  for (const flow of result.flows) {
    // Files not counted toward `missing` are only runtime .sdp artifacts and
    // skill-invoke targets (<skill>/SKILL.md).
    const expectedMissing = flow.referencedFiles.filter(
      (f) => !f.exists && !f.path.startsWith(".sdp/") && !f.path.endsWith("/SKILL.md"),
    ).length;
    assert.equal(
      flow.totals.missing,
      expectedMissing,
      `${flow.flow}: missing count must match non-shipped-kind misses`,
    );
  }
  const flagged = result.flows.filter((f) => f.totals.missing > 0);
  if (flagged.length > 0) {
    const detail = flagged
      .map(
        (f) =>
          `${f.flow}: ${f.referencedFiles
            .filter((r) => !r.exists && !r.path.startsWith(".sdp/") && !r.path.endsWith("/SKILL.md"))
            .map((r) => r.path)
            .join(", ")}`,
      )
      .join("\n");
    console.log(`Missing shipped-kind targets (doc bugs to audit):\n${detail}`);
  }
});

test("inventory is deterministic across runs", () => {
  assert.deepEqual(inventoryAll(skillsRoot), inventoryAll(skillsRoot));
});
