import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  checkDeps,
  checkLockfile,
  checkMarketplace,
  checkPackageDir,
  hasMarketplaceFailures,
  runMarketplaceChecks,
} from "../src/check-marketplace.js";
import { load } from "js-yaml";

// A minimal repo root: `apm.yml` carrying the two registration sites
// (devDependencies.apm entry + marketplace.packages entry), the
// `apm install`-generated `apm.lock.yaml` dependency block, and the
// package directory itself. Cases override the manifest/lockfile text
// or delete the package dir after fixture() returns.
const APMLIST = [
  "- ./packages/basic-dev-foundation",
  "- ./packages/pstack-devin",
].join("\n  ");

// Continuation lines carry their full 4-space indent: the first line
// gets its 2-space list indent from the `  ${marketEntry}` template.
const MARKET_ENTRY = [
  "- name: pstack-devin",
  "    category: workflow",
  "    source: scarecrow173/apm-packages",
  "    subdir: packages/pstack-devin",
].join("\n");

function manifestYaml(opts: { apmList?: string; marketEntry?: string } = {}) {
  const apmList = opts.apmList ?? APMLIST;
  const marketEntry = opts.marketEntry ?? MARKET_ENTRY;
  return (
    "name: fixture-repo\n" +
    "version: 0.1.0\n" +
    "devDependencies:\n" +
    "  apm:\n" +
    `  ${apmList}\n` +
    "marketplace:\n" +
    "  versioning:\n" +
    "    strategy: lockstep\n" +
    "  packages:\n" +
    `  ${marketEntry}\n`
  );
}

const LOCKFILE = [
  "lockfile_version: '1'",
  "dependencies:",
  "- repo_url: _local/pstack-devin",
  "  name: pstack-devin",
  "  version: 0.1.0",
  "  package_type: apm_package",
  "  source: local",
  "  local_path: ./packages/pstack-devin",
  "  is_dev: true",
  "",
].join("\n");

function fixture(opts: { manifest?: string; lockfile?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "marketplace-"));
  const files: Record<string, string> = {
    "apm.yml": opts.manifest ?? manifestYaml(),
    "apm.lock.yaml": opts.lockfile ?? LOCKFILE,
    "packages/pstack-devin/apm.yml": "name: pstack-devin\nversion: 0.1.0\n",
  };
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body, "utf8");
  }
  return root;
}

test("clean fixture produces no findings", () => {
  const r = runMarketplaceChecks(fixture());
  assert.deepEqual(r.deps, []);
  assert.deepEqual(r.marketplace, []);
  assert.deepEqual(r.lockfile, []);
  assert.deepEqual(r.packageDir, []);
  assert.equal(hasMarketplaceFailures(r), false);
});

test("deps: missing devDependency entry fails the deps group", () => {
  const root = fixture({
    manifest: manifestYaml({ apmList: "- ./packages/basic-dev-foundation" }),
  });
  const r = runMarketplaceChecks(root);
  assert.equal(r.deps.length, 1);
  assert.match(r.deps[0].issue, /\.\/packages\/pstack-devin/);
  assert.equal(hasMarketplaceFailures(r), true);
  // Other groups still pass — the label isolates the failure.
  assert.deepEqual(r.marketplace, []);
});

test("deps: the entry must appear exactly once", () => {
  const root = fixture({
    manifest: manifestYaml({
      apmList: "- ./packages/pstack-devin\n  - ./packages/pstack-devin",
    }),
  });
  const r = runMarketplaceChecks(root);
  assert.equal(r.deps.length, 1);
  assert.match(r.deps[0].issue, /exactly once|2 times|duplicate/);
});

test("marketplace: missing packages entry fails the marketplace group", () => {
  const root = fixture({
    manifest: manifestYaml({
      marketEntry:
        "- name: other-package\n" +
        "    category: workflow\n" +
        "    source: scarecrow173/apm-packages\n" +
        "    subdir: packages/other-package",
    }),
  });
  const r = runMarketplaceChecks(root);
  assert.equal(r.marketplace.length, 1);
  assert.match(r.marketplace[0].issue, /pstack-devin/);
  assert.deepEqual(r.deps, []);
});

test("marketplace: wrong subdir, source, or empty category each named", () => {
  const variants: Array<[string, RegExp]> = [
    [
      "- name: pstack-devin\n" +
        "    category: workflow\n" +
        "    source: scarecrow173/apm-packages\n" +
        "    subdir: packages/wrong-dir",
      /subdir/,
    ],
    [
      "- name: pstack-devin\n" +
        "    category: workflow\n" +
        "    source: someone/else\n" +
        "    subdir: packages/pstack-devin",
      /source/,
    ],
    [
      "- name: pstack-devin\n" +
        "    category: ''\n" +
        "    source: scarecrow173/apm-packages\n" +
        "    subdir: packages/pstack-devin",
      /category/,
    ],
  ];
  for (const [entry, re] of variants) {
    const doc = load(manifestYaml({ marketEntry: entry })) as Record<
      string,
      unknown
    >;
    const findings = checkMarketplace(doc);
    assert.equal(findings.length, 1, `expected one finding for ${re}`);
    assert.match(findings[0].issue, re);
  }
});

test("marketplace: a second pstack-devin entry is flagged", () => {
  const root = fixture({
    manifest: manifestYaml({
      marketEntry: `${MARKET_ENTRY}\n  ${MARKET_ENTRY}`,
    }),
  });
  const r = runMarketplaceChecks(root);
  assert.ok(r.marketplace.length >= 1);
  assert.match(r.marketplace[0].issue, /exactly once|2 entr|duplicate/);
});

test("lockfile: missing local_path entry fails the lockfile group", () => {
  const root = fixture({
    lockfile:
      "lockfile_version: '1'\n" +
      "dependencies:\n" +
      "- repo_url: _local/other\n" +
      "  name: other\n" +
      "  source: local\n" +
      "  local_path: ./packages/other\n" +
      "  is_dev: true\n",
  });
  const r = runMarketplaceChecks(root);
  assert.equal(r.lockfile.length, 1);
  assert.match(r.lockfile[0].issue, /local_path|pstack-devin/);
  assert.deepEqual(r.deps, []);
});

test("lockfile: local_path entry must name package pstack-devin", () => {
  const root = fixture({
    lockfile: LOCKFILE.replace("name: pstack-devin", "name: mislabeled"),
  });
  const findings = checkLockfile(root);
  assert.equal(findings.length, 1);
  assert.match(findings[0].issue, /name/);
});

test("packageDir: missing packages/pstack-devin fails its group", () => {
  const root = fixture();
  rmSync(join(root, "packages", "pstack-devin"), { recursive: true });
  const findings = checkPackageDir(root);
  assert.equal(findings.length, 1);
  assert.match(findings[0].issue, /missing|directory/);
});

test("unreadable or malformed apm.yml fails loudly, not silently", () => {
  const r = runMarketplaceChecks(fixture({ manifest: "{not: a: mapping" }));
  assert.ok(r.deps.length >= 1 || r.marketplace.length >= 1);
  assert.equal(hasMarketplaceFailures(r), true);
  const missing = fixture();
  rmSync(join(missing, "apm.yml"));
  const r2 = runMarketplaceChecks(missing);
  assert.equal(hasMarketplaceFailures(r2), true);
});

const repoRoot = join(__dirname, "../../..");

test("real repo passes marketplace registration checks", () => {
  assert.ok(existsSync(join(repoRoot, "apm.yml")), "root apm.yml missing");
  const r = runMarketplaceChecks(repoRoot);
  assert.deepEqual(r.deps, []);
  assert.deepEqual(r.marketplace, []);
  assert.deepEqual(r.lockfile, []);
  assert.deepEqual(r.packageDir, []);
  assert.equal(hasMarketplaceFailures(r), false);
});
