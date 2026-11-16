import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkLinks } from "../src/link-check.js";

/** Fixture plugin tree at `<tmp>/repo/packages/pstack-devin/devin-plugin` so
 *  package- and repo-level path fallbacks stay inside the fixture and never
 *  touch the real tree or the shared temp dir. */
function fixture(
  files: Record<string, string>,
  opts: { pkg?: Record<string, string>; repo?: Record<string, string> } = {},
): string {
  const repo = mkdtempSync(join(tmpdir(), "link-check-"));
  const root = join(repo, "packages", "pstack-devin", "devin-plugin");
  const write = (base: string, map: Record<string, string>): void => {
    for (const [rel, body] of Object.entries(map)) {
      const p = join(base, rel);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, body, "utf8");
    }
  };
  write(root, files);
  write(join(repo, "packages", "pstack-devin"), opts.pkg ?? {});
  write(repo, opts.repo ?? {});
  return root;
}

const SHIPPED = {
  "skills/alpha/SKILL.md": "# alpha\n",
  "skills/alpha/playbooks/run.md": "# run\n",
  "skills/alpha/references/notes.md": "# notes\n",
  "agents/helper.md": "# helper\n",
  "docs/guide/intro.md": "# intro\n",
};

test("good mdlink, slash, pstack:, path, and mention refs all resolve", () => {
  const root = fixture({
    ...SHIPPED,
    "docs/guide/intro.md": [
      "[playbook](../../skills/alpha/playbooks/run.md)",
      "[anchor](./intro.md#top)",
      "run `/alpha` and `/pstack:alpha`",
      "spawn `pstack:helper`",
      "the **alpha** skill",
      "the **build-the-lever** principle",
      "see `docs/guide/intro.md`",
      "skip: `https://x.dev/y`, `~/.cursor/rules/`, `/loop`, `/deslop`, `/name`",
    ].join("\n"),
    "skills/alpha/SKILL.md": "read `references/notes.md`\n",
    "skills/principle-build-the-lever/SKILL.md": "# principle\n",
  });
  const r = checkLinks(root);
  assert.deepEqual(r.broken, []);
  assert.deepEqual(r.unresolved, []);
  assert.ok(r.checked > 0);
  const kinds = r.skipped.map((s) => s.kind);
  assert.ok(kinds.includes("url") && kinds.includes("runtime"));
  assert.ok(kinds.includes("builtin") && kinds.includes("external"));
  assert.ok(kinds.includes("placeholder"));
});

test("broken mdlink is named", () => {
  const root = fixture({
    ...SHIPPED,
    "docs/guide/intro.md": "[missing](./nope.md)\n",
  });
  const r = checkLinks(root);
  assert.equal(r.broken.length, 1);
  assert.equal(r.broken[0].kind, "mdlink");
  assert.equal(r.broken[0].ref, "./nope.md");
  assert.equal(r.broken[0].file, "docs/guide/intro.md");
});

test("pstack:<agent> naming a missing agent is broken", () => {
  const root = fixture({
    ...SHIPPED,
    "docs/guide/intro.md": "spawn `pstack:nonexistent` for the task\n",
  });
  const r = checkLinks(root);
  assert.equal(r.broken.length, 1);
  assert.equal(r.broken[0].kind, "agent");
  assert.equal(r.broken[0].ref, "pstack:nonexistent");
});

test("/pstack:<skill> naming a missing skill is broken", () => {
  const root = fixture({
    ...SHIPPED,
    "docs/guide/intro.md": "run `/pstack:ghost` next\n",
  });
  const r = checkLinks(root);
  assert.equal(r.broken.length, 1);
  assert.equal(r.broken[0].kind, "skill");
  assert.equal(r.broken[0].ref, "/pstack:ghost");
});

test("unknown mdlink scheme is unresolved, not silently passed", () => {
  const root = fixture({
    ...SHIPPED,
    "docs/guide/intro.md": "[x](weird://thing)\n",
  });
  const r = checkLinks(root);
  assert.equal(r.broken.length, 0);
  assert.equal(r.unresolved.length, 1);
  assert.equal(r.unresolved[0].kind, "mdlink");
  assert.equal(r.unresolved[0].ref, "weird://thing");
});

test("unclassified slash command is unresolved, not silently passed", () => {
  const root = fixture({
    ...SHIPPED,
    "docs/guide/intro.md": "run `/brand-new-thing` now\n",
  });
  const r = checkLinks(root);
  assert.equal(r.broken.length, 0);
  assert.equal(r.unresolved.length, 1);
  assert.equal(r.unresolved[0].kind, "skill");
  assert.equal(r.unresolved[0].ref, "/brand-new-thing");
});

test("marked mention of an unshipped, unclassified skill is broken", () => {
  const root = fixture({
    ...SHIPPED,
    "docs/guide/intro.md": "hand it to the **newskill** skill\n",
  });
  const r = checkLinks(root);
  assert.equal(r.broken.length, 1);
  assert.equal(r.broken[0].kind, "skill");
  assert.equal(r.broken[0].ref, "newskill");
});

test("skill-dir anchored path resolves from a nested playbook file", () => {
  const root = fixture({
    ...SHIPPED,
    "skills/alpha/playbooks/run.md":
      "read `playbooks/run.md` and `references/notes.md`\n",
  });
  const r = checkLinks(root);
  assert.deepEqual(r.broken, []);
  assert.deepEqual(r.unresolved, []);
});

test("path into the source package resolves at package level", () => {
  const root = fixture(
    { ...SHIPPED, "docs/harness/devin.md": "see `docs/decision.md` in the package\n" },
    { pkg: { "docs/decision.md": "# decision\n" } },
  );
  const r = checkLinks(root);
  assert.deepEqual(r.broken, []);
  assert.deepEqual(r.unresolved, []);
});

test("path into the repo resolves at repo level", () => {
  const root = fixture(
    { ...SHIPPED, "AGENTS.md": "generated by `scripts/harness`\n" },
    { repo: { "scripts/harness/x.ts": "// x\n" } },
  );
  const r = checkLinks(root);
  assert.deepEqual(r.broken, []);
  assert.deepEqual(r.unresolved, []);
});

test("non-anchored consumer paths classify as runtime", () => {
  const root = fixture({
    ...SHIPPED,
    "docs/guide/intro.md":
      "the workspace `agent-transcripts/` dir, `.cursor/skills/`, `%APPDATA%\\x\\`, `/tmp/y`\n",
  });
  const r = checkLinks(root);
  assert.deepEqual(r.broken, []);
  assert.deepEqual(r.unresolved, []);
  assert.ok(r.skipped.every((s) => s.kind === "runtime"));
});

test("glob and metavar tokens classify as placeholder", () => {
  const root = fixture({
    ...SHIPPED,
    "docs/guide/intro.md":
      "`<pstack>/skills/<name>/SKILL.md`, `agents/*.md`, `/pstack:<name>`, `pstack:<agent>`\n",
  });
  const r = checkLinks(root);
  assert.deepEqual(r.broken, []);
  assert.deepEqual(r.unresolved, []);
  assert.ok(r.skipped.length > 0 && r.skipped.every((s) => s.kind === "placeholder"));
});

test("generated devin-plugin tree has no broken or unresolved refs", () => {
  const repoRoot = resolve(__dirname, "../../..");
  const root = join(repoRoot, "packages", "pstack-devin", "devin-plugin");
  assert.ok(
    existsSync(root),
    "packages/pstack-devin/devin-plugin missing — run `pnpm --dir scripts/pstack-devin run build`",
  );
  const r = checkLinks(root);
  assert.deepEqual(
    r.unresolved,
    [],
    "unclassified refs — add a real ref kind, never a blanket skip",
  );
  assert.deepEqual(r.broken, [], "dangling refs in the shipped tree");
});
