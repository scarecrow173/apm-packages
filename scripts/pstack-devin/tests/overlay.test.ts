import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadBuildConfig } from "../src/config.js";
import { applyOverlay } from "../src/overlay.js";
import { writeFixturePackage, tmpdir } from "./helpers.js";

const sha = (s: string | Buffer): string =>
  createHash("sha256").update(s).digest("hex");

/** Stage a fake "upstream" tree under `outDir` and return its sha256 map. */
function stageUpstream(
  outDir: string,
  files: Record<string, string>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    map.set(rel, sha(content));
  }
  return map;
}

test("non-allowlisted overwrite of an upstream path hard-fails and names the path", () => {
  const root = writeFixturePackage(tmpdir(), {
    overlayFiles: [{ path: "skills/x/SKILL.md", content: "overlay body" }],
  });
  const cfg = loadBuildConfig(root);
  const outDir = path.join(tmpdir(), "out");
  const upstream = stageUpstream(outDir, {
    "skills/x/SKILL.md": "upstream body",
  });
  assert.throws(
    () => applyOverlay(cfg, outDir, upstream),
    /allowlist|overwrite.*skills\/x\/SKILL\.md/i,
  );
  // the staged upstream file is untouched — validation precedes any write
  assert.equal(
    fs.readFileSync(path.join(outDir, "skills/x/SKILL.md"), "utf8"),
    "upstream body",
  );
});

test("allowlisted overwrite is applied and records upstreamSha256", () => {
  const root = writeFixturePackage(tmpdir(), {
    overlayFiles: [
      { path: "skills/setup-pstack/SKILL.md", content: "patched\n" },
    ],
  });
  const cfg = loadBuildConfig(root);
  const outDir = path.join(tmpdir(), "out");
  const upstream = stageUpstream(outDir, {
    "skills/setup-pstack/SKILL.md": "original\n",
  });
  const res = applyOverlay(cfg, outDir, upstream);
  assert.deepEqual(res.overwrites, [
    {
      path: "skills/setup-pstack/SKILL.md",
      sha256: sha("patched\n"),
      upstreamSha256: sha("original\n"),
    },
  ]);
  assert.deepEqual(res.additions, []);
  assert.equal(
    fs.readFileSync(
      path.join(outDir, "skills/setup-pstack/SKILL.md"),
      "utf8",
    ),
    "patched\n",
  );
});

test("additions are written and hashed; unused allowlist entries warn only", (t) => {
  const root = writeFixturePackage(tmpdir(), {
    overlayFiles: [
      { path: "z/last.md", content: "z" },
      { path: "a/first.md", content: "a" },
    ],
  });
  const cfg = loadBuildConfig(root);
  const outDir = path.join(tmpdir(), "out");
  // the allowlisted path exists upstream but the overlay does not touch it
  const upstream = stageUpstream(outDir, {
    "skills/setup-pstack/SKILL.md": "upstream",
  });
  const warn = t.mock.method(console, "warn");
  const res = applyOverlay(cfg, outDir, upstream);
  assert.deepEqual(res.additions, [
    { path: "a/first.md", sha256: sha("a") },
    { path: "z/last.md", sha256: sha("z") },
  ]);
  assert.deepEqual(res.overwrites, []);
  assert.equal(fs.readFileSync(path.join(outDir, "a/first.md"), "utf8"), "a");
  assert.equal(fs.readFileSync(path.join(outDir, "z/last.md"), "utf8"), "z");
  assert.ok(
    warn.mock.calls.some((c) =>
      /skills\/setup-pstack\/SKILL\.md/.test(String(c.arguments[0])),
    ),
    "expected an unused-allowlist warning naming skills/setup-pstack/SKILL.md",
  );
});

test("case-folded overlay name colliding with upstream still requires the allowlist", () => {
  const root = writeFixturePackage(tmpdir(), {
    overlayFiles: [
      { path: "skills/setup-pstack/skill.md", content: "overlay body" },
    ],
  });
  const cfg = loadBuildConfig(root);
  // the canonical upstream path is NOT allowlisted
  cfg.overlay.allowOverwrite = cfg.overlay.allowOverwrite.filter(
    (e) => e !== "skills/setup-pstack/SKILL.md",
  );
  const outDir = path.join(tmpdir(), "out");
  const upstream = stageUpstream(outDir, {
    "skills/setup-pstack/SKILL.md": "upstream body",
  });
  // exact-match lookup misses on a case-insensitive fs, where the write
  // would silently replace upstream bytes — the error names both paths
  assert.throws(
    () => applyOverlay(cfg, outDir, upstream),
    /not allowlisted: skills\/setup-pstack\/skill\.md.*skills\/setup-pstack\/SKILL\.md/,
  );
  // validation precedes any write — staged upstream file is untouched
  assert.equal(
    fs.readFileSync(
      path.join(outDir, "skills/setup-pstack/SKILL.md"),
      "utf8",
    ),
    "upstream body",
  );
});

test("allowlisted case-folded overwrite lands on the canonical upstream path", (t) => {
  const root = writeFixturePackage(tmpdir(), {
    overlayFiles: [
      { path: "skills/setup-pstack/skill.md", content: "patched\n" },
    ],
  });
  // fixture allowlist names the canonical skills/setup-pstack/SKILL.md
  const cfg = loadBuildConfig(root);
  const outDir = path.join(tmpdir(), "out");
  const upstream = stageUpstream(outDir, {
    "skills/setup-pstack/SKILL.md": "original\n",
  });
  const warn = t.mock.method(console, "warn");
  const res = applyOverlay(cfg, outDir, upstream);
  // recorded under the canonical casing so provenance is byte-stable
  // across case-insensitive and case-sensitive filesystems
  assert.deepEqual(res.overwrites, [
    {
      path: "skills/setup-pstack/SKILL.md",
      sha256: sha("patched\n"),
      upstreamSha256: sha("original\n"),
    },
  ]);
  assert.deepEqual(res.additions, []);
  // bytes land on the canonical path — no differently-cased second file
  assert.equal(
    fs.readFileSync(
      path.join(outDir, "skills/setup-pstack/SKILL.md"),
      "utf8",
    ),
    "patched\n",
  );
  assert.deepEqual(
    fs.readdirSync(path.join(outDir, "skills/setup-pstack")),
    ["SKILL.md"],
  );
  // the allowlist entry counts as used
  assert.ok(
    !warn.mock.calls.some((c) => /unused/.test(String(c.arguments[0]))),
    "canonical allowlist entry must not be reported unused",
  );
});

test("overlay paths colliding under case folding are rejected", () => {
  const root = writeFixturePackage(tmpdir(), {});
  const cfg = loadBuildConfig(root);
  const outDir = path.join(tmpdir(), "out");
  // NTFS cannot host both names in one directory, so inject the pair —
  // same pattern as the traversal test above.
  const fake = (name: string): fs.Dirent =>
    ({
      name,
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    }) as fs.Dirent;
  const realReaddir = fs.readdirSync;
  const patched = (p: fs.PathLike, options?: unknown): unknown =>
    String(p) === cfg.overlay.dir
      ? [fake("a/X.md"), fake("a/x.md")]
      : (realReaddir as (a: fs.PathLike, b?: unknown) => unknown)(p, options);
  fs.readdirSync = patched as typeof fs.readdirSync;
  try {
    assert.throws(
      () => applyOverlay(cfg, outDir, new Map()),
      /collision.*case-insensitive.*a\/X\.md.*a\/x\.md/i,
    );
  } finally {
    fs.readdirSync = realReaddir;
  }
  assert.equal(fs.existsSync(outDir), false, "no bytes may be written");
});

test("overlay path traversal is rejected before any write", () => {
  const root = writeFixturePackage(tmpdir(), {});
  const cfg = loadBuildConfig(root);
  const outDir = path.join(tmpdir(), "out");
  // readdir cannot yield ".." or separators on a real filesystem; inject a
  // hostile name to prove each overlay rel path is validated by
  // assertSafeRelPath before any byte is copied.
  const fake = {
    name: "..\\escape.md",
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
  } as fs.Dirent;
  const realReaddir = fs.readdirSync;
  const patched = (p: fs.PathLike, options?: unknown): unknown =>
    String(p) === cfg.overlay.dir
      ? [fake]
      : (realReaddir as (a: fs.PathLike, b?: unknown) => unknown)(p, options);
  fs.readdirSync = patched as typeof fs.readdirSync;
  try {
    assert.throws(
      () => applyOverlay(cfg, outDir, new Map()),
      /unsafe|invalid|traversal/i,
    );
  } finally {
    fs.readdirSync = realReaddir;
  }
  assert.equal(fs.existsSync(outDir), false, "no bytes may be written");
});
