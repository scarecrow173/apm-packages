import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../../..");
const pkgRoot = path.join(repoRoot, "packages", "pstack-devin");

const upstream = load(
  fs.readFileSync(path.join(pkgRoot, "upstream.yml"), "utf8"),
) as { upstream: { repo: string; path: string; commit: string } };

const manifest = load(
  fs.readFileSync(path.join(pkgRoot, "apm.yml"), "utf8"),
) as Record<string, unknown>;

const COMMIT_RE = /^[0-9a-f]{40}$/;

test("required package files exist", () => {
  for (const rel of [
    "apm.yml",
    "upstream.yml",
    "README.md",
    "README.ja.md",
    "AGENTS.md",
    "AGENTS.ja.md",
    ".gitignore",
    ".markdownlint-cli2.jsonc",
    ".apm/skills/setup-pstack-devin/SKILL.md",
    ".apm/skills/setup-pstack-devin/scripts/setup.mjs",
    ".apm/skills/setup-pstack-devin/scripts/roles.json",
    "docs/verification-apm-0.33.0.md",
    "docs/upstream-source-decision.md",
    "apm.lock.yaml",
  ]) {
    assert.ok(fs.existsSync(path.join(pkgRoot, rel)), `missing: ${rel}`);
  }
});

test("upstream.yml pins a full 40-hex commit for cursor/plugins", () => {
  assert.equal(upstream.upstream.repo, "cursor/plugins");
  assert.equal(upstream.upstream.path, "harness/pstack/claude-code");
  assert.match(upstream.upstream.commit, COMMIT_RE);
});

test("manifest carries the upstream pin only as a copilot-scoped devDependency", () => {
  assert.equal(manifest.name, "pstack-devin");
  assert.ok(
    !("dependencies" in manifest),
    "upstream tree must not ship via `dependencies:`",
  );
  const dev = (manifest.devDependencies as { apm: unknown[] }).apm;
  assert.equal(dev.length, 1);
  const dep = dev[0] as Record<string, unknown>;
  assert.equal(dep.git, "https://github.com/cursor/plugins.git");
  assert.equal(dep.path, "harness/pstack/claude-code");
  assert.equal(dep.ref, upstream.upstream.commit);
  assert.deepEqual(dep.targets, ["copilot"]);
  assert.ok(
    (manifest.targets as string[]).includes("copilot"),
    "manifest targets must include copilot for the devDep pin to resolve",
  );
});

test("lockfile attests the same commit as upstream.yml", () => {
  const lock = load(
    fs.readFileSync(path.join(pkgRoot, "apm.lock.yaml"), "utf8"),
  ) as {
    dependencies: Array<Record<string, unknown>>;
    deployments?: unknown[];
  };
  assert.equal(lock.dependencies.length, 1);
  const entry = lock.dependencies[0];
  assert.equal(entry.resolved_commit, upstream.upstream.commit);
  assert.equal(entry.is_dev, true);
  assert.equal(entry.package_type, "agent_plugin");
  assert.deepEqual(entry.target_subset, ["copilot"]);
  assert.ok(
    typeof entry.content_hash === "string" &&
      entry.content_hash.startsWith("sha256:"),
    "lockfile must attest content_hash",
  );
  // `apm install` records deployments of this package's own `.apm`
  // primitive into `.claude/` and `.agents/` (gitignored side-effects) —
  // legitimate local bookkeeping. What the contract forbids is a
  // deployment of the UPSTREAM tree: any path outside the local skill's
  // deployment roots means upstream content shipped as installed files
  // rather than the built devin-plugin tree.
  const deployments = (lock.deployments ?? []) as Array<{
    value?: unknown;
  }>;
  const foreign = deployments.filter(
    (d) =>
      typeof d.value !== "string" ||
      !/^\.(claude|agents)\/skills\/setup-pstack-devin(?:\/|$)/.test(d.value),
  );
  assert.deepEqual(
    foreign,
    [],
    "lockfile deployments must cover only the local .apm skill — " +
      "the upstream tree is built, not installed",
  );
});
