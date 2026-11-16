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
