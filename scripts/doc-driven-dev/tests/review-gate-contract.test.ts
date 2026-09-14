const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "../../..");
const implFlowRoot = path.join(
  repoRoot,
  "packages",
  "doc-driven-dev",
  ".apm",
  "skills",
  "implementation-flow",
);

const CANONICAL_SKILL = "requesting-code-review";

function read(relativePath: string) {
  return fs.readFileSync(path.join(implFlowRoot, relativePath), "utf8");
}

test("review gate contract exists in both locales and names the canonical skill", () => {
  for (const locale of ["references/review-gate-contract.md", "references/review-gate-contract.ja.md"]) {
    const contract = read(locale);
    assert.ok(
      contract.includes(CANONICAL_SKILL),
      `${locale} must name the canonical review skill ${CANONICAL_SKILL}`,
    );
  }
});

test("implementation-flow skills link the review gate contract and canonical skill", () => {
  for (const [skill, contract] of [
    ["SKILL.md", "references/review-gate-contract.md"],
    ["SKILL.ja.md", "references/review-gate-contract.ja.md"],
  ]) {
    const body = read(skill);
    assert.ok(
      body.includes(`(${contract})`),
      `${skill} must link ${contract}`,
    );
    assert.ok(
      body.includes(CANONICAL_SKILL),
      `${skill} must name the canonical review skill ${CANONICAL_SKILL}`,
    );
  }
});

test("implementation adapter declares an exclusive always-on review_gate slot", () => {
  const adapter = read("assets/adapters/implementation-adapter.yaml");
  const slot = adapter
    .split(/\n\s*- slot_id: /)
    .slice(1)
    .map((chunk) => `slot_id: ${chunk}`)
    .find((chunk) => chunk.startsWith('slot_id: "review_gate"'));
  assert.ok(slot, "adapter must declare a review_gate slot");
  assert.match(slot, /slot_type:\s*"exclusive"/);
  assert.match(slot, /activation:\s*"always"/);
});
