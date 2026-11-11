import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTypeScope,
  checkTypeScope,
  DIRECTORY_CONTRACTS,
  ownershipForDir,
  scopeTypesForQuery,
  sharedRepairAllowed,
  sharedTypesResidentIn,
} from "../src/skills/lib/doc_ownership";
import { CANONICAL_DOC_DIRS } from "../src/skills/lib/document_utils";

test("every canonical doc dir resolves to a contract owned by the expected skill", () => {
  const expected: Record<string, string> = {
    "docs/ideas": "doc-suite",
    "docs/discovery": "doc-suite",
    "docs/specs": "doc-suite",
    "docs/designs": "doc-suite",
    "docs/plans": "doc-suite",
    "docs/tasks": "doc-suite",
    "docs/test-specs": "doc-suite",
    "docs/adr": "adr-doc",
    "docs/impl/ir": "impl-doc",
    "docs/impl/exp": "impl-doc",
  };
  for (const dir of CANONICAL_DOC_DIRS) {
    assert.equal(ownershipForDir(dir)?.owner, expected[dir], dir);
  }
});

test("alias dirs resolve to the same owner as their canonical dir", () => {
  assert.equal(ownershipForDir("docs/decisions")?.owner, "adr-doc");
  assert.equal(ownershipForDir("docs/spec")?.owner, "doc-suite");
  assert.equal(ownershipForDir("work-items")?.owner, "doc-suite");
});

test("docs/discovery hosts the official brainstorm + discovery co-residence", () => {
  const residents = ownershipForDir("docs/discovery")?.residentTypes ?? [];
  assert.deepEqual([...residents].sort(), ["brainstorm", "discovery"]);
});

test("checkTypeScope accepts resident types and custom dirs, rejects foreign owners", () => {
  assert.equal(checkTypeScope("spec", "docs/specs").ok, true);
  assert.equal(checkTypeScope("spec", "docs/specs/drafts").ok, true); // nested inside own canonical
  assert.equal(checkTypeScope("brainstorm", "docs/discovery").ok, true);
  assert.equal(checkTypeScope("adr", "docs/decisions").ok, true);
  assert.equal(checkTypeScope("spec", "custom/dir").ok, true); // unclaimed custom dir stays allowed

  for (const [type, dir] of [
    ["spec", "docs/impl/ir"],
    ["spec", "docs/impl/exp"],
    ["task", "docs/impl"],
    ["spec", "docs/decisions"],   // adr-owned alias
    ["task", "docs/discovery"],   // task not resident
    ["impl", "docs/specs"],       // impl in shared dir
    ["exp", "docs/impl/ir"],      // exp in the ir dir
    ["spec", "docs/impl/ir/deep"],// nested inside foreign owner
  ] as const) {
    const check = checkTypeScope(type, dir);
    assert.equal(check.ok, false, `${type} in ${dir} must be rejected`);
    assert.match(check.reason ?? "", /Scope mismatch|not resident/);
  }
});

test("assertTypeScope throws with a reason naming owner and residents", () => {
  assert.throws(
    () => assertTypeScope("spec", "docs/impl/ir"),
    /not resident.*impl-doc|impl-doc.*resident/,
  );
  assert.doesNotThrow(() => assertTypeScope("spec", "docs/specs"));
});

test("sharedTypesResidentIn narrows owned dirs and keeps custom dirs open", () => {
  assert.deepEqual(sharedTypesResidentIn("docs/specs"), ["spec"]);
  assert.deepEqual(sharedTypesResidentIn("docs/discovery").sort(), ["brainstorm", "discovery"]);
  assert.deepEqual(sharedTypesResidentIn("docs/impl/ir"), []);
  assert.deepEqual(sharedTypesResidentIn("docs/impl"), []);
  assert.equal(sharedTypesResidentIn("custom/dir").length, 9);
});

test("sharedRepairAllowed only permits shared-4col territory", () => {
  assert.equal(sharedRepairAllowed("docs/specs"), true);
  assert.equal(sharedRepairAllowed("docs/adr"), true);
  assert.equal(sharedRepairAllowed("custom/dir"), true);
  assert.equal(sharedRepairAllowed("docs/impl/ir"), false);
  assert.equal(sharedRepairAllowed("docs/impl/exp"), false);
  assert.equal(sharedRepairAllowed("docs/impl"), false);
});

test("scopeTypesForQuery narrows, validates, and rejects", () => {
  // canonical resolution (no dir): all types or the requested one
  assert.equal(scopeTypesForQuery(null, undefined).length, 9);
  assert.deepEqual(scopeTypesForQuery(null, "spec"), ["spec"]);
  assert.throws(() => scopeTypesForQuery(null, "impl"), /Unknown document type/);

  // explicit dir + no type: narrow to residents; empty => reject
  assert.deepEqual(scopeTypesForQuery("docs/discovery", undefined)!.sort(), ["brainstorm", "discovery"]);
  assert.throws(() => scopeTypesForQuery("docs/impl/ir", undefined), /no shared-suite document types|Scope mismatch/);
  assert.throws(() => scopeTypesForQuery("docs/impl", "all"), /Scope mismatch/);

  // explicit dir + explicit type
  assert.deepEqual(scopeTypesForQuery("docs/discovery", "brainstorm"), ["brainstorm"]);
  assert.throws(() => scopeTypesForQuery("docs/discovery", "spec"), /not resident/);
  assert.deepEqual(scopeTypesForQuery("custom/dir", "spec"), ["spec"]);
});

test("contract table invariants hold", () => {
  const dirs = DIRECTORY_CONTRACTS.map((row) => row.dir);
  assert.equal(new Set(dirs).size, dirs.length, "contract dirs must be unique");
  // every shared type contributes at least one contract row covering its canonical dir
  for (const dir of ["docs/ideas", "docs/discovery", "docs/specs", "docs/designs", "docs/plans", "docs/tasks", "docs/test-specs", "docs/adr"]) {
    assert.ok(dirs.includes(dir), `missing contract row for ${dir}`);
  }
  // docs/impl is the impl-doc container: owned, zero residents, no index
  const impl = DIRECTORY_CONTRACTS.find((row) => row.dir === "docs/impl");
  assert.ok(impl);
  assert.equal(impl.owner, "impl-doc");
  assert.deepEqual(impl.residentTypes, []);
  assert.equal(impl.indexFormat, "none");
});
