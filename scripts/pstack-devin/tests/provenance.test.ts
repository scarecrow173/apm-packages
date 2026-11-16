import test from "node:test";
import assert from "node:assert/strict";
import { loadBuildConfig } from "../src/config.js";
import { buildProvenance, stableStringify } from "../src/provenance.js";
import type { Inventory } from "../src/inventory.js";
import type { OverlayResult } from "../src/overlay.js";
import { writeFixturePackage, tmpdir } from "./helpers.js";

function fixture(): {
  cfg: ReturnType<typeof loadBuildConfig>;
  inv: Inventory;
  ov: OverlayResult;
  u: { version: string; treeSha: string; fileCount: number };
} {
  const cfg = loadBuildConfig(writeFixturePackage(tmpdir(), {}));
  const inv: Inventory = {
    entries: [
      { path: "a.md", mode: "100644", type: "blob", sha: "1".repeat(40) },
      { path: "run.sh", mode: "100755", type: "blob", sha: "2".repeat(40) },
    ],
    executables: ["run.sh"],
  };
  const ov: OverlayResult = {
    additions: [{ path: "b.md", sha256: "3".repeat(64) }],
    overwrites: [
      { path: "a.md", sha256: "4".repeat(64), upstreamSha256: "5".repeat(64) },
    ],
  };
  const u = { version: "0.15.42", treeSha: "6".repeat(40), fileCount: 2 };
  return { cfg, inv, ov, u };
}

test("provenance is deterministic: sorted keys, sorted lists, no timestamps", () => {
  const { cfg, inv, ov, u } = fixture();
  const p1 = stableStringify(buildProvenance(cfg, u, inv, ov));
  const p2 = stableStringify(buildProvenance(cfg, u, inv, ov));
  assert.equal(p1, p2);
  assert.ok(!/timestamp|builtAt|date|time/i.test(p1), p1);
  assert.ok(!p1.includes("\r"), "LF only");
  assert.ok(p1.endsWith("}\n"), "trailing newline");
  const parsed = JSON.parse(p1);
  assert.deepEqual(
    Object.keys(parsed),
    [...Object.keys(parsed)].sort(),
    "top-level keys sorted",
  );
  assert.deepEqual(
    Object.keys(parsed.upstream),
    [...Object.keys(parsed.upstream)].sort(),
    "upstream keys sorted",
  );
});

test("provenance records upstream coords, distribution, overlay diff, executables", () => {
  const { cfg, inv, ov, u } = fixture();
  const p = JSON.parse(stableStringify(buildProvenance(cfg, u, inv, ov)));
  assert.equal(p.schema, "pstack-devin/provenance@1");
  assert.equal(p.upstream.repo, "cursor/plugins");
  assert.equal(p.upstream.host, "github.com");
  assert.equal(p.upstream.path, "harness/pstack/claude-code");
  assert.equal(p.upstream.commit, cfg.upstream.commit);
  assert.equal(p.upstream.version, "0.15.42");
  assert.equal(p.upstream.tree_sha, u.treeSha);
  assert.equal(p.upstream.file_count, 2);
  assert.equal(p.distribution.name, "pstack-devin");
  assert.equal(p.distribution.plugin_name, "pstack");
  assert.equal(p.distribution.version, "0.1.0");
  assert.deepEqual(p.overlay, {
    additions: ov.additions,
    overwrites: ov.overwrites,
  });
  assert.deepEqual(p.executables, inv.executables);
  assert.equal(p.generator, "scripts/pstack-devin build");
});
