import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import matter from "gray-matter";

import {
  parseDashboardArgs,
  writeDashboard,
  writeDashboardWithOperations,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_cli";

const sourceCli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/build_dashboard.ts");
const generatedCli = path.resolve(
  __dirname,
  "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/build_dashboard.js",
);
const graphDirectory = path.resolve(
  __dirname,
  "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs",
);
const canonicalGraph = path.join(graphDirectory, "doc-driven-dev.yaml");
const tsxCli = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");

function runCli(cli: string, cwd: string, args: string[], source = false) {
  const result = spawnSync(process.execPath, source ? [tsxCli, cli, ...args] : [cli, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function createFixture(prefix = "dashboard cli 日本語 "): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const write = (relative: string, data: Record<string, unknown>) => {
    const file = path.join(cwd, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, matter.stringify("# Example\n", {
      title: "Example",
      created: "2026-09-21",
      updated: "2026-09-21",
      owners: [],
      relations: {},
      ...data,
    }));
  };
  const planPath = "docs/plans/example.md";
  write(planPath, { id: "PLAN-0001", type: "plan", status: "draft" });
  write("docs/tasks/example.md", {
    id: "TASK-0001",
    type: "task",
    status: "todo",
    relations: { implements: [planPath] },
  });
  return cwd;
}

function normalizeHtml(html: string): string {
  return html.replace(/<strong>開始:<\/strong> [^<]+/, "<strong>開始:</strong> TIME")
    .replace(/<strong>生成時点:<\/strong> [^<]+/, "<strong>生成時点:</strong> TIME");
}

test("parses defaults and resolves cwd and output from their documented bases", () => {
  const processCwd = path.resolve("process-base");
  const parsed = parseDashboardArgs(["--cwd", "target", "--focus", "PLAN-1", "--signal", "ready"], processCwd);
  assert.deepEqual(parsed, {
    cwd: path.resolve(processCwd, "target"),
    graph: undefined,
    focus: ["PLAN-1"],
    current: undefined,
    signals: ["ready"],
    out: path.resolve(processCwd, "target", "reports/doc-driven-dev/index.html"),
    force: false,
    help: false,
  });
});

test("requires values and rejects unknown or positional arguments", () => {
  assert.throws(() => parseDashboardArgs(["--focus"], process.cwd()), /Missing value/);
  assert.throws(() => parseDashboardArgs(["--current", "--force"], process.cwd()), /Missing value/);
  assert.throws(() => parseDashboardArgs(["--unknown"], process.cwd()), /Unknown option/);
  assert.throws(() => parseDashboardArgs(["extra"], process.cwd()), /Unexpected argument/);
});

test("requires explicit overwrite and keeps output inside the repository", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-write-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const file = writeDashboard(cwd, "reports/dashboard.html", "first", false);
  assert.throws(() => writeDashboard(cwd, "reports/dashboard.html", "second", false), /exist/i);
  assert.equal(fs.readFileSync(file, "utf8"), "first");
  writeDashboard(cwd, "reports/dashboard.html", "second", true);
  assert.equal(fs.readFileSync(file, "utf8"), "second");
  assert.throws(() => writeDashboard(cwd, "../escape.html", "bad", true), /outside/i);
  assert.throws(() => writeDashboard(cwd, "docs/specs/a.md", "bad", true), /html/i);
});

test("rejects directories and ancestor links that leave the repository", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-protection-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-outside-"));
  t.after(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(cwd, "directory.html"));
  assert.throws(() => writeDashboard(cwd, "directory.html", "bad", true), /regular HTML file/i);

  const linked = path.join(cwd, "linked");
  try {
    fs.symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`directory link unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  assert.throws(() => writeDashboard(cwd, "linked/escape.html", "bad", true), /outside repository/i);
  assert.equal(fs.existsSync(path.join(outside, "escape.html")), false);
});

test("rejects a symlink output when the platform permits creating one", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-output-link-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.writeFileSync(path.join(cwd, "target.html"), "old");
  try {
    fs.symlinkSync(path.join(cwd, "target.html"), path.join(cwd, "report.html"), "file");
  } catch (error) {
    t.skip(`file symlink unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  assert.throws(() => writeDashboard(cwd, "report.html", "new", true), /symbolic link/i);
  assert.equal(fs.readFileSync(path.join(cwd, "target.html"), "utf8"), "old");
  fs.unlinkSync(path.join(cwd, "target.html"));
  assert.throws(() => writeDashboard(cwd, "report.html", "new", true), /symbolic link/i);
});

test("help performs no repository I/O", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-help-"));
  const missing = path.join(cwd, "missing");
  const result = runCli(sourceCli, cwd, ["--help", "--cwd", missing, "--out", "made.html"], true);
  fs.rmSync(cwd, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /relative to process cwd/i);
  assert.equal(fs.existsSync(missing), false);
});

test("source CLI validates callers before writing and preserves an existing report", (t) => {
  const cwd = createFixture();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const output = path.join(cwd, "report.html");
  fs.writeFileSync(output, "old report");
  for (const args of [
    ["--current", "unknown-node"],
    ["--signal", "unknown-signal"],
  ]) {
    const result = runCli(sourceCli, cwd, ["--cwd", cwd, "--graph", canonicalGraph, "--out", "report.html", "--force", ...args], true);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown graph node|Unknown signal/);
    assert.equal(fs.readFileSync(output, "utf8"), "old report");
  }
  const missing = runCli(sourceCli, cwd, ["--cwd", path.join(cwd, "missing")], true);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /does not exist/i);
  const unreadable = runCli(sourceCli, cwd, [
    "--cwd", cwd,
    "--graph", path.join(cwd, "missing-graph.yaml"),
    "--out", "report.html",
    "--force",
  ], true);
  assert.notEqual(unreadable.status, 0);
  assert.equal(fs.readFileSync(output, "utf8"), "old report");
});

test("invalid focus remains visible as a blocker in a successful report", (t) => {
  const cwd = createFixture();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const result = runCli(sourceCli, cwd, [
    "--cwd", cwd,
    "--graph", canonicalGraph,
    "--focus", "docs/plans/missing.md",
    "--out", "blocked.html",
  ], true);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(path.join(cwd, "blocked.html"), "utf8");
  assert.match(html, /docs\/plans\/missing\.md/);
  assert.match(html, /focus|未解決/i);
});

test("write failures do not leave temporary dashboard files", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-write-failure-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.writeFileSync(path.join(cwd, "blocked"), "not a directory");
  assert.throws(() => writeDashboard(cwd, "blocked/report.html", "new", true));
  assert.deepEqual(fs.readdirSync(cwd), ["blocked"]);
});

test("partial temporary writes are removed while the old report stays byte-identical", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-partial-write-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const output = path.join(cwd, "report.html");
  const original = Buffer.from([0x6f, 0x6c, 0x64, 0x00, 0xff]);
  fs.writeFileSync(output, original);

  assert.throws(() => writeDashboardWithOperations(cwd, "report.html", "replacement", true, {
    randomUUID: () => "partial-write",
    openExclusive: (file) => fs.openSync(file, "wx"),
    write: (fd) => {
      fs.writeSync(fd, "partial");
      throw new Error("injected partial write failure");
    },
    close: (fd) => fs.closeSync(fd),
    link: (from, to) => fs.linkSync(from, to),
    rename: (from, to) => fs.renameSync(from, to),
    unlink: (file) => fs.unlinkSync(file),
  }), /injected partial write failure/);

  assert.deepEqual(fs.readFileSync(output), original);
  assert.deepEqual(fs.readdirSync(cwd), ["report.html"]);
});

test("exclusive temporary-name collisions preserve the foreign file", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-temp-collision-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const temp = path.join(cwd, ".report.html.collision.tmp");
  fs.writeFileSync(temp, "foreign");

  assert.throws(() => writeDashboardWithOperations(cwd, "report.html", "new", false, {
    randomUUID: () => "collision",
    openExclusive: (file) => fs.openSync(file, "wx"),
    write: (fd, html) => fs.writeFileSync(fd, html, "utf8"),
    close: (fd) => fs.closeSync(fd),
    link: (from, to) => fs.linkSync(from, to),
    rename: (from, to) => fs.renameSync(from, to),
    unlink: (file) => fs.unlinkSync(file),
  }), /EEXIST|exist/i);

  assert.equal(fs.readFileSync(temp, "utf8"), "foreign");
  assert.equal(fs.existsSync(path.join(cwd, "report.html")), false);
});

test("source and generated CLIs produce equivalent HTML", (t) => {
  const sourceRepo = createFixture("dashboard source 日本語 ");
  const bundleRepo = createFixture("dashboard bundle 日本語 ");
  t.after(() => {
    fs.rmSync(sourceRepo, { recursive: true, force: true });
    fs.rmSync(bundleRepo, { recursive: true, force: true });
  });
  const args = ["--graph", canonicalGraph, "--focus", "docs/plans/example.md", "--out", "result.html"];
  const source = runCli(sourceCli, sourceRepo, ["--cwd", sourceRepo, ...args], true);
  const bundle = runCli(generatedCli, bundleRepo, ["--cwd", bundleRepo, ...args]);
  assert.equal(source.status, 0, source.stderr);
  assert.equal(bundle.status, 0, bundle.stderr);
  const sourceHtml = normalizeHtml(fs.readFileSync(path.join(sourceRepo, "result.html"), "utf8"));
  const bundleHtml = normalizeHtml(fs.readFileSync(path.join(bundleRepo, "result.html"), "utf8"));
  assert.equal(bundleHtml.replace(path.basename(bundleRepo), "REPOSITORY"), sourceHtml.replace(path.basename(sourceRepo), "REPOSITORY"));
  assert.match(sourceHtml, /TASK-0001/);
});

test("distributed CLI resolves its sibling graph for an external consumer", (t) => {
  const consumer = createFixture("dashboard consumer ");
  const skill = path.join(consumer, "installed", "doc-driven-dev-graph");
  t.after(() => fs.rmSync(consumer, { recursive: true, force: true }));
  fs.mkdirSync(path.join(skill, "scripts"), { recursive: true });
  fs.cpSync(graphDirectory, path.join(skill, "graphs"), { recursive: true });
  fs.copyFileSync(generatedCli, path.join(skill, "scripts", "build_dashboard.js"));
  const result = runCli(path.join(skill, "scripts", "build_dashboard.js"), consumer, [
    "--cwd", consumer,
    "--focus", "docs/plans/example.md",
    "--out", "external.html",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(path.join(consumer, "external.html"), "utf8"), /TASK-0001/);
});
