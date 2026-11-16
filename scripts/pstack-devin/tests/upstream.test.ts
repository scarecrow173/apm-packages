import test from "node:test";
import assert from "node:assert/strict";
import { loadBuildConfig } from "../src/config.js";
import { gitRemote } from "../src/gittools.js";
import type { UpstreamRemote } from "../src/gittools.js";
import { checkUpstream, checkUpstreamMain } from "../src/check-upstream.js";
import { updateReport } from "../src/update-report.js";
import type { BlockingKind } from "../src/update-report.js";
import {
  makeFixtureRepo,
  commitFixture,
  writeFixturePackage,
  tmpdir,
  git,
} from "./helpers.js";
import type { FixtureFile } from "./helpers.js";

const UP = "harness/pstack/claude-code";

const up = (files: Record<string, string>): FixtureFile[] =>
  Object.entries(files).map(([p, content]) => ({ path: `${UP}/${p}`, content }));

const ROLES_JSON = JSON.stringify({ roles: [{ key: "legacy role" }] }) + "\n";

/** Mirror of the real package's overlay payload paths — allowlist entries
 *  (`skills/setup-pstack/SKILL.md` comes from writeFixturePackage's
 *  overlay.yml) plus addition paths like AGENTS.md. */
const OVERLAY: FixtureFile[] = [
  { path: "agents/poteto-agent.md", content: "overlay agent\n" },
  { path: "AGENTS.md", content: "overlay instructions\n" },
  {
    path: "skills/setup-pstack-devin/scripts/roles.json",
    content: ROLES_JSON,
  },
];

const BASE: Record<string, string> = {
  "plugin.json": JSON.stringify({ name: "pstack", version: "9.9.9" }) + "\n",
  "LICENSE": "MIT license text\n",
  "skills/setup-pstack/SKILL.md": "---\nname: setup\n---\nsetup v1\n",
  "skills/x/SKILL.md": "---\nname: x\n---\nx body v1\n",
  "docs/guide/roles.md": "Routing: the `legacy role` model handles it.\n",
  "docs/guide/a.md": "plain guide v1\n",
};

function fixtureCfg(repo: { dir: string; commit: string }) {
  return loadBuildConfig(
    writeFixturePackage(tmpdir(), {
      commit: repo.commit,
      upstreamRepoUrl: repo.dir,
      overlayFiles: OVERLAY,
    }),
  );
}

/** Repo pinned at v1 (`repo.commit`), main moved to a v2 child commit. */
function twoCommitFixture(
  v1: Record<string, string>,
  v2: Record<string, string>,
) {
  const repo = makeFixtureRepo(up(v1));
  const c1 = repo.commit;
  const c2 = commitFixture(repo.dir, up(v2), { parent: c1, updateMain: true });
  return { repo, c1, c2 };
}

// --- check-upstream ---------------------------------------------------

test("check-upstream: identical main is up to date (exit 0)", () => {
  const repo = makeFixtureRepo(up(BASE));
  const cfg = fixtureCfg(repo);
  const out: string[] = [];
  const code = checkUpstreamMain(
    cfg, gitRemote(repo.dir), tmpdir(), (s) => out.push(s),
  );
  assert.equal(code, 0);
  assert.match(out.join(""), /up to date/);
});

test("check-upstream: new commit with identical tree is up to date", () => {
  const repo = makeFixtureRepo(up(BASE));
  const cfg = fixtureCfg(repo);
  commitFixture(repo.dir, up(BASE), { parent: repo.commit, updateMain: true });
  const out: string[] = [];
  const code = checkUpstreamMain(
    cfg, gitRemote(repo.dir), tmpdir(), (s) => out.push(s),
  );
  assert.equal(code, 0);
  assert.match(out.join(""), /up to date/);
});

test("check-upstream: changed tree exits 42 with JSON coordinates", () => {
  const { repo, c1, c2 } = twoCommitFixture(BASE, {
    ...BASE,
    "plugin.json": JSON.stringify({ name: "pstack", version: "10.0.0" }) + "\n",
    "skills/x/SKILL.md": "changed body\n",
  });
  const cfg = fixtureCfg({ dir: repo.dir, commit: c1 });
  const out: string[] = [];
  const code = checkUpstreamMain(
    cfg, gitRemote(repo.dir), tmpdir(), (s) => out.push(s),
  );
  assert.equal(code, 42);
  const json = JSON.parse(out.join(""));
  assert.equal(json.current, c1);
  assert.equal(json.candidate, c2);
  assert.equal(json.candidateTree, git(repo.dir, "rev-parse", `${c2}:${UP}`));
  assert.equal(json.upstreamVersion, "10.0.0");
});

test("check-upstream: upstreamVersion is omitted when no manifest parses", () => {
  const noManifest = { ...BASE };
  delete noManifest["plugin.json"];
  const { repo, c1 } = twoCommitFixture(noManifest, {
    ...noManifest,
    "skills/x/SKILL.md": "changed\n",
  });
  const cfg = fixtureCfg({ dir: repo.dir, commit: c1 });
  const out: string[] = [];
  const code = checkUpstreamMain(
    cfg, gitRemote(repo.dir), tmpdir(), (s) => out.push(s),
  );
  assert.equal(code, 42);
  const json = JSON.parse(out.join(""));
  assert.equal("upstreamVersion" in json, false);
});

test("check-upstream: injected remote short-circuits without fetching", () => {
  const repo = makeFixtureRepo(up(BASE));
  const cfg = fixtureCfg(repo);
  const fake: UpstreamRemote = {
    resolveRef: () => repo.commit,
    fetchCommit: () => {
      throw new Error("must not fetch when the ref equals the pin");
    },
  };
  const res = checkUpstream(cfg, fake, tmpdir());
  assert.equal(res.status, "up-to-date");
  assert.equal(res.current, repo.commit);
  assert.equal(res.candidate, repo.commit);
});

// --- update-report ----------------------------------------------------

test("update-report flags every blocking class", async () => {
  const { repo, c1, c2 } = twoCommitFixture(BASE, {
    ...BASE,
    "LICENSE": "Apache-2.0 text\n",                       // license change
    "skills/setup-pstack/SKILL.md": "upstream rewrite\n", // allowlist path
    "docs/guide/roles.md": "Routing: the `novel role` model now.\n",
    "docs/guide/a.md": "spawn it with `MultiEdit`\n",     // compat unknown
    "AGENTS.md": "upstream now ships this file\n",        // overlay addition path
  });
  const cfg = fixtureCfg({ dir: repo.dir, commit: c1 });
  const rep = await updateReport(
    cfg, gitRemote(repo.dir), c2, { workDir: tmpdir() },
  );

  assert.equal(rep.current, c1);
  assert.equal(rep.candidate, c2);
  const kinds = rep.blocking.map((b) => b.kind);
  const expected: BlockingKind[] = [
    "license", "overlay-path", "compat-unknown", "role-new", "role-removed",
  ];
  for (const k of expected) {
    assert.ok(kinds.includes(k), `expected a ${k} blocking row`);
  }
  const overlayRows = rep.blocking.filter((b) => b.kind === "overlay-path");
  assert.deepEqual(
    overlayRows.map((b) => b.path).sort(),
    ["AGENTS.md", "skills/setup-pstack/SKILL.md"],
  );
  assert.match(rep.markdown, /❌/);
  assert.match(rep.markdown, /skills\/setup-pstack\/SKILL\.md/);
  assert.match(rep.markdown, /LICENSE/);
  assert.match(rep.markdown, /MultiEdit/);
  assert.match(rep.markdown, /novel role/);
  assert.match(rep.markdown, /legacy role/);
});

test("update-report: non-blocking-only changes have no blocking rows", async () => {
  const { repo, c1, c2 } = twoCommitFixture(BASE, {
    ...BASE,
    "skills/x/SKILL.md": "---\nname: x\n---\nrevised but plain\n",
    "docs/guide/a.md": "revised guide, no API tokens\n",
    "docs/guide/new.md": "a brand new page\n",
  });
  const cfg = fixtureCfg({ dir: repo.dir, commit: c1 });
  const rep = await updateReport(
    cfg, gitRemote(repo.dir), c2, { workDir: tmpdir() },
  );

  assert.equal(rep.blocking.length, 0);
  assert.match(rep.markdown, /no blocking findings/i);
  assert.deepEqual(
    rep.changes.filter((c) => c.kind === "added").map((c) => c.path),
    ["docs/guide/new.md"],
  );
  assert.deepEqual(
    rep.changes.filter((c) => c.kind === "changed").map((c) => c.path),
    ["docs/guide/a.md", "skills/x/SKILL.md"],
  );
  const docs = rep.categories.find((c) => c.category === "docs/");
  assert.deepEqual(docs && { a: docs.added, r: docs.removed, c: docs.changed },
    { a: 1, r: 0, c: 1 });
});

test("update-report counts removed files and exec-bit flips as changes", async () => {
  const v1 = [
    ...up(BASE),
    { path: `${UP}/skills/x/run.sh`, content: "#!/bin/sh\necho hi\n", mode: "100755" },
    { path: `${UP}/docs/guide/dropped.md`, content: "going away\n" },
  ];
  const v2 = [
    ...up(BASE),
    { path: `${UP}/skills/x/run.sh`, content: "#!/bin/sh\necho hi\n", mode: "100644" },
  ];
  const repo = makeFixtureRepo(v1);
  const c1 = repo.commit;
  const c2 = commitFixture(repo.dir, v2, { parent: c1, updateMain: true });
  const cfg = fixtureCfg({ dir: repo.dir, commit: c1 });
  const rep = await updateReport(
    cfg, gitRemote(repo.dir), c2, { workDir: tmpdir() },
  );
  const runSh = rep.changes.find((c) => c.path === "skills/x/run.sh");
  assert.equal(runSh?.kind, "changed"); // mode-only flip still counts
  const dropped = rep.changes.find((c) => c.path === "docs/guide/dropped.md");
  assert.equal(dropped?.kind, "removed");
  assert.equal(rep.blocking.length, 0);
});
