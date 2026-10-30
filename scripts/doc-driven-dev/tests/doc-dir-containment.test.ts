import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const skillsRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-dir-containment-"));
}

function runScript(skill: string, name: string, args: string[], options: { cwd?: string } = {}) {
  const result = spawnSync(
    process.execPath,
    [path.join(skillsRoot, skill, "scripts", name), ...args],
    {
      cwd: options.cwd || tempRepo(),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * --dir classification (Issue #156): every doc CLI takes --dir as a directory
 * selector for a scan root and/or a write target, and all resolve it through
 * the one shared boundary (findDocumentDir/implDir -> resolveContainedDir).
 * Read-only scanners must never scan outside the checkout; writers may place
 * custom directories inside the checkout but must never write outside it —
 * so the boundary rejects escapes for both classes uniformly.
 */
const scannerClis: Array<[skill: string, script: string, extraArgs: string[]]> = [
  ["doc-status", "list_docs.js", ["--type", "spec"]],
  ["doc-status", "doc_status.js", ["list", "--type", "spec"]],
  ["doc-status", "audit_docs.js", ["--type", "spec"]],
  ["adr-doc", "list_adrs.js", []],
  ["adr-doc", "audit_adr.js", []],
  ["adr-doc", "check_code_links.js", []],
  ["adr-doc", "migrate_report.js", []],
  ["adr-doc", "review_adr.js", []],
  ["impl-doc", "audit_impl_record.js", []],
  ["impl-doc", "audit_experiment_log.js", []],
];

const writerClis: Array<[skill: string, script: string, extraArgs: string[]]> = [
  ["adr-doc", "new_adr.js", ["--title", "X"]],
  ["adr-doc", "update_index.js", []],
  ["adr-doc", "relate_adr.js", ["--from", "a", "--to", "b", "--relation", "related"]],
  ["doc-maintenance", "doc_maintenance.js", ["plan", "--type", "spec"]],
  ["design-doc", "new_design.js", ["--title", "X"]],
  ["discovery-doc", "new_discovery.js", ["--title", "X"]],
  ["idea-doc", "new_idea.js", ["--title", "X"]],
  // new_plan/new_test_spec run a doc-gate before --dir resolution, so the
  // fixture below seeds an approved design and a spec to verify; the gate
  // passes and the containment boundary still sees the escaping --dir.
  ["plan-doc", "new_plan.js", ["--title", "X", "--design", "docs/designs/0001-design.md"]],
  ["spec-doc", "new_spec.js", ["--title", "X"]],
  ["task-doc", "new_task.js", ["--title", "X"]],
  ["test-spec-doc", "new_test_spec.js", ["--title", "X", "--verifies", "docs/specs/0001-spec.md"]],
  ["impl-doc", "new_impl_record.js", ["--title", "X"]],
  ["impl-doc", "new_experiment_log.js", ["--title", "X"]],
];

test("read-only scanners reject a --dir that escapes the checkout", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/specs"), { recursive: true });
  for (const [skill, script, extraArgs] of scannerClis) {
    for (const dir of ["../outside", `${repo}/../outside`, "..\\outside"]) {
      const result = runScript(skill, script, [...extraArgs, "--dir", dir], { cwd: repo });
      assert.notEqual(result.status, 0, `${script} --dir ${dir} must fail`);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /--dir escapes the checkout/,
        `${script} --dir ${dir} must report the containment error`,
      );
    }
  }
});

test("write-target CLIs reject a --dir that escapes the checkout", () => {
  const repo = tempRepo();
  // `../outside` resolves next to the repo inside the shared temp root.
  const escapedTarget = path.join(path.dirname(repo), "outside");
  // Gate fixtures for the gated writers (see the per-CLI args above).
  fs.mkdirSync(path.join(repo, "docs/designs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/designs/overview.md"), "# Designs\n", "utf8");
  fs.writeFileSync(path.join(repo, "docs/designs/0001-design.md"), [
    "---", "id: DESIGN-0001", "type: design", 'status: approved', 'title: "Design"',
    'created: "2026-01-01"', 'updated: "2026-01-01"', "owners: []", "relations: {}",
    "---", "", "# Design", "",
  ].join("\n"), "utf8");
  fs.mkdirSync(path.join(repo, "docs/specs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/specs/0001-spec.md"), [
    "---", "id: SPEC-0001", "type: spec", 'status: approved', 'title: "Spec"',
    'created: "2026-01-01"', 'updated: "2026-01-01"', "owners: []", "relations: {}",
    "---", "", "# Spec", "",
  ].join("\n"), "utf8");
  for (const [skill, script, extraArgs] of writerClis) {
    const result = runScript(skill, script, [...extraArgs, "--dir", "../outside"], { cwd: repo });
    assert.notEqual(result.status, 0, `${script} --dir ../outside must fail`);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /--dir escapes the checkout/,
      `${script} --dir ../outside must report the containment error`,
    );
  }
  assert.equal(fs.existsSync(escapedTarget), false, "no CLI may write outside the checkout");
});

test("a --dir that escapes through a link is rejected for scanners and writers", (t) => {
  const repo = tempRepo();
  const outside = tempRepo();
  const linkPath = path.join(repo, "docs-link");
  try {
    fs.symlinkSync(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch (error: unknown) {
    t.skip(`cannot create symlinks/junctions here: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  for (const [skill, script, extraArgs] of [
    ["adr-doc", "list_adrs.js", []],
    ["spec-doc", "new_spec.js", ["--title", "X"]],
  ] as Array<[string, string, string[]]>) {
    const result = runScript(skill, script, [...extraArgs, "--dir", "docs-link"], { cwd: repo });
    assert.notEqual(result.status, 0, `${script} --dir docs-link must fail`);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /--dir escapes the checkout/,
      `${script} --dir docs-link must report the containment error`,
    );
  }
});

test("a contained custom --dir still scans and writes inside the checkout", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "custom/specs"), { recursive: true });

  const listed = runScript("doc-status", "list_docs.js", ["--type", "spec", "--dir", "custom/specs"], { cwd: repo });
  assert.equal(listed.status, 0, listed.stderr);

  const created = runScript("spec-doc", "new_spec.js", ["--title", "Custom Dir", "--dir", "custom/specs"], { cwd: repo });
  assert.equal(created.status, 0, created.stderr);
  assert.equal(fs.readdirSync(path.join(repo, "custom/specs")).some((file) => file.endsWith(".md")), true);
});

test("migrate_docs rejects a --from root that escapes the checkout", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  for (const from of ["../outside", `${repo}/../outside`]) {
    const result = runScript("doc-maintenance", "migrate_docs.js", ["--from", from], { cwd: repo });
    assert.notEqual(result.status, 0, `migrate_docs --from ${from} must fail`);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /--from escapes the checkout/,
      `migrate_docs --from ${from} must report the containment error`,
    );
  }
});
