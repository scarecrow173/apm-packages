import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRoles } from "../src/role-registry.js";

/** Minimal roles.json shape: { roles: [{key}, ...] } beside a scanned tree. */
function fixture(
  keys: string[],
  files: Record<string, string>,
): { root: string; rolesJson: string } {
  const root = mkdtempSync(join(tmpdir(), "role-registry-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body, "utf8");
  }
  const rolesJson = join(root, "roles.json");
  writeFileSync(
    rolesJson,
    JSON.stringify({ schema: 2, roles: keys.map((key) => ({ key, default: "m" })) }),
    "utf8",
  );
  return { root, rolesJson };
}

test("consumer role labels covered by roles.json, all keys referenced → clean", () => {
  const { root, rolesJson } = fixture(["alpha role", "beta role"], {
    "skills/x/SKILL.md":
      "Use the `alpha role` line in `~/.cursor/rules/pstack-models.mdc`. " +
      "Changes read `beta role`.\n",
  });
  const r = checkRoles(root, rolesJson);
  assert.equal(r.unknown.length, 0);
  assert.equal(r.dead.length, 0);
});

test("consumer naming a role missing from roles.json → unknown", () => {
  const { root, rolesJson } = fixture(["alpha role"], {
    "skills/x/SKILL.md": "Use the `new-role` line in `pstack-models.mdc`.\n",
  });
  const r = checkRoles(root, rolesJson);
  assert.equal(r.unknown.length, 1);
  assert.equal(r.unknown[0].role, "new-role");
  assert.equal(r.unknown[0].file, "skills/x/SKILL.md");
  assert.equal(r.unknown[0].line, 1);
});

test("roles.json key no consumer references → dead", () => {
  const { root, rolesJson } = fixture(["alpha role", "ghost role"], {
    "skills/x/SKILL.md": "Use the `alpha role` line in `pstack-models.mdc`.\n",
  });
  const r = checkRoles(root, rolesJson);
  assert.equal(r.unknown.length, 0);
  assert.deepEqual(r.dead, ["ghost role"]);
});

test("non-role-shaped tokens in role-line contexts are not roles", () => {
  const { root, rolesJson } = fixture(["alpha role"], {
    "skills/x/SKILL.md":
      "The `# budget` line and the `# defaults: 3` line are rule lines. " +
      "Read `docs/harness/devin.md` first. The `SomeFlag` line too. " +
      "Use the `alpha role` line.\n",
  });
  const r = checkRoles(root, rolesJson);
  assert.equal(r.unknown.length, 0);
  assert.equal(r.dead.length, 0);
});

test("role/default table row counts as a role reference", () => {
  const { root, rolesJson } = fixture(["beta role"], {
    "skills/reflect/SKILL.md":
      "| Judgment | `beta role` | `claude-x-1-high` | `references/j.md` |\n",
  });
  const r = checkRoles(root, rolesJson);
  assert.equal(r.unknown.length, 0);
  assert.equal(r.dead.length, 0);
});

test("table row naming an unregistered role → unknown", () => {
  const { root, rolesJson } = fixture(["beta role"], {
    "skills/reflect/SKILL.md":
      "| Judgment | `mystery role` | `claude-x-1-high` | `references/j.md` |\n" +
      "The `beta role` line sets it.\n",
  });
  const r = checkRoles(root, rolesJson);
  assert.equal(r.unknown.length, 1);
  assert.equal(r.unknown[0].role, "mystery role");
});

test("in place of / configures / `<role>` model phrasings extract", () => {
  const { root, rolesJson } = fixture(
    ["alpha role", "beta role", "gamma role"],
    {
      "skills/x/SKILL.md":
        "Read the `alpha role` line in place of `beta role`. " +
        "Setup also configures `gamma role`, and it stays on the `gamma role` model.\n",
    },
  );
  const r = checkRoles(root, rolesJson);
  assert.equal(r.unknown.length, 0);
  assert.equal(r.dead.length, 0);
});

test("malformed roles.json throws", () => {
  const root = mkdtempSync(join(tmpdir(), "role-registry-"));
  const rolesJson = join(root, "roles.json");
  writeFileSync(rolesJson, '{"schema": 2, "roles": [{"default": "m"}]}', "utf8");
  assert.throws(() => checkRoles(root, rolesJson), /key/);
});

// Real shipped tree: every roles.json key is referenced by an upstream
// consumer and no consumer names a role the registry lacks.
const repoRoot = join(__dirname, "..", "..", "..");
const realRoot = join(repoRoot, "packages", "pstack-devin", "devin-plugin");
const realRoles = join(
  repoRoot,
  "packages", "pstack-devin", "overlay", "skills",
  "setup-pstack-devin", "scripts", "roles.json",
);

test("real devin-plugin tree: 0 unknown, 0 dead", () => {
  assert.ok(
    existsSync(realRoot),
    "devin-plugin/ missing — run `pnpm --dir scripts/pstack-devin run build`",
  );
  const r = checkRoles(realRoot, realRoles);
  assert.deepEqual(r.unknown, []);
  assert.deepEqual(r.dead, []);
});
