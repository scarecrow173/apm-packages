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
import { dirname, join, sep } from "node:path";
import {
  checkManifest,
  checkSeparation,
  hasFailures,
  probeCompile,
  probePack,
  runL3Local,
  ToolMissingError,
  COMPILE_NA_PHRASE,
} from "../src/l3-dist.js";
import type { CmdOut, CmdRunner } from "../src/l3-dist.js";

// A minimal valid package tree: the generated `devin-plugin/` carrying its
// manifest, layout entries, and provenance, plus the sibling `.apm/`
// primitive tree. Tests override entries per case; deleting a base file
// happens after fixture() returns.
const PLUGIN_JSON = JSON.stringify({
  name: "pstack",
  version: "0.1.0",
  description: "fixture plugin",
  author: { name: "Fixture Author" },
  license: "MIT",
  keywords: ["fixture"],
  platforms: ["local"],
});

function fixture(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "l3-dist-"));
  const tree: Record<string, string> = {
    "devin-plugin/.devin-plugin/plugin.json": PLUGIN_JSON,
    "devin-plugin/AGENTS.md": "# plugin\n",
    "devin-plugin/agents/poteto-agent.md": "agent\n",
    "devin-plugin/skills/setup-pstack/SKILL.md": "skill\n",
    "devin-plugin/provenance.json": "{}\n",
    "devin-plugin/docs/harness/devin.md": "adapter\n",
    ".apm/skills/setup-pstack-devin/SKILL.md": "apm skill\n",
    ...files,
  };
  for (const [rel, body] of Object.entries(tree)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body, "utf8");
  }
  return root;
}

/** Canned command results keyed by argv — a missing key fails the test so
 *  no unexpected invocation passes silently. */
function fakeRunner(handlers: Record<string, CmdOut>): CmdRunner {
  return (argv) => {
    const out = handlers[argv.join(" ")];
    assert.ok(out !== undefined, `unexpected command: ${argv.join(" ")}`);
    return out;
  };
}

/** apm behaving exactly as recorded against apm 0.33.0 on 2026-11-17 —
 *  pack dry-run names the two ecosystem manifests under the package root
 *  (backslash form, as a Windows binary prints), compile --validate is
 *  the skill-only N/A. */
function okRunner(pkgRoot: string): CmdRunner {
  const win = (rel: string) => `${pkgRoot}${sep}${rel.replace(/\//g, sep)}`;
  return fakeRunner({
    "apm --version": {
      code: 0,
      output: "Agent Package Manager (APM) CLI version 0.33.0\n",
    },
    "apm pack --dry-run": {
      code: 0,
      output:
        `[i] Would write plugin manifest to ${win(".github/plugin/plugin.json")}\n` +
        `[i] Would write plugin manifest to ${win(".claude-plugin/plugin.json")}\n`,
    },
    "apm compile --validate": {
      code: 1,
      output: `[x] ${COMPILE_NA_PHRASE} in .apm/ directory\n`,
    },
  });
}

test("clean fixture with recorded apm behavior produces no findings", () => {
  const root = fixture();
  const r = runL3Local(root, { run: okRunner(root) });
  assert.deepEqual(r.manifest, []);
  assert.deepEqual(r.layout, []);
  assert.deepEqual(r.separation, []);
  assert.equal(r.pack.status, "match");
  assert.deepEqual(r.pack.observed, [
    ".claude-plugin/plugin.json",
    ".github/plugin/plugin.json",
  ]);
  assert.equal(r.compile.status, "expected-na");
  assert.equal(hasFailures(r), false);
});

test("manifest schema drift names the offending field", () => {
  const variants: Array<[Record<string, unknown>, RegExp]> = [
    [{ name: "other" }, /name/],
    [{ version: "v1" }, /version|semver/],
    [{ description: "  " }, /description/],
    [{ author: {} }, /author/],
    [{ license: "Apache-2.0" }, /license/],
    [{ keywords: "pstack" }, /keywords/],
    [{ keywords: [7] }, /keywords/],
    [{ platforms: ["local", "cloud"] }, /platforms/],
    [{ platforms: [] }, /platforms/],
  ];
  for (const [patch, re] of variants) {
    const root = fixture({
      "devin-plugin/.devin-plugin/plugin.json": JSON.stringify({
        ...JSON.parse(PLUGIN_JSON),
        ...patch,
      }),
    });
    const findings = checkManifest(join(root, "devin-plugin"));
    assert.equal(findings.length, 1, `expected one finding for ${re}`);
    assert.match(findings[0].issue, re);
  }
});

test("missing or malformed manifest fails loudly", () => {
  const bad = checkManifest(
    join(fixture({ "devin-plugin/.devin-plugin/plugin.json": "{nope" }),
      "devin-plugin"),
  );
  assert.equal(bad.length, 1);
  assert.match(bad[0].issue, /invalid JSON/);
  const root = fixture();
  rmSync(join(root, "devin-plugin", ".devin-plugin", "plugin.json"));
  assert.equal(checkManifest(join(root, "devin-plugin")).length, 1);
});

test("layout entries must exist with the right shape", () => {
  const root = fixture();
  rmSync(join(root, "devin-plugin", "docs", "harness", "devin.md"));
  rmSync(join(root, "devin-plugin", "agents"), { recursive: true });
  const r = runL3Local(root, { run: okRunner(root) });
  assert.equal(r.layout.length, 2);
  const files = r.layout.map((f) => f.file).sort();
  assert.deepEqual(files, ["agents", "docs/harness/devin.md"]);
});

test("product trees must not conflate", () => {
  const inPlugin = checkSeparation(
    fixture({ "devin-plugin/.apm/skills/x/SKILL.md": "conflated\n" }),
  );
  assert.equal(inPlugin.length, 1);
  assert.match(inPlugin[0].issue, /conflated/);

  const inApm = checkSeparation(
    fixture({ ".apm/devin-plugin/plugin.json": "{}\n" }),
  );
  assert.equal(inApm.length, 1);
  assert.match(inApm[0].issue, /conflated/);

  const manifestDir = checkSeparation(
    fixture({ ".apm/skills/x/.devin-plugin/plugin.json": "{}\n" }),
  );
  assert.equal(manifestDir.length, 1);

  const root = fixture();
  rmSync(join(root, ".apm"), { recursive: true });
  const missing = checkSeparation(root);
  assert.equal(missing.length, 1);
  assert.match(missing[0].issue, /missing/);
});

test("pack drift: a different observed set fails with expected-vs-observed", () => {
  const root = fixture();
  const extra = fakeRunner({
    "apm --version": { code: 0, output: "apm\n" },
    "apm pack --dry-run": {
      code: 0,
      output:
        `[i] Would write plugin manifest to ${root}/.github/plugin/plugin.json\n` +
        `[i] Would write plugin manifest to ${root}/.cursor-plugin/plugin.json\n`,
    },
  });
  const r = probePack(root, extra);
  assert.equal(r.status, "drift");
  assert.deepEqual(r.observed, [
    ".cursor-plugin/plugin.json",
    ".github/plugin/plugin.json",
  ]);
  assert.match(r.note, /EXPECTED_PACK_MANIFESTS/);
});

test("pack drift: writes outside the package or a non-zero exit", () => {
  const root = fixture();
  const outside = probePack(
    root,
    fakeRunner({
      "apm --version": { code: 0, output: "apm\n" },
      "apm pack --dry-run": {
        code: 0,
        output: "[i] Would write plugin manifest to /tmp/evil/plugin.json\n",
      },
    }),
  );
  assert.equal(outside.status, "drift");
  assert.deepEqual(outside.observed, ["/tmp/evil/plugin.json"]);

  const failed = probePack(
    root,
    fakeRunner({
      "apm --version": { code: 0, output: "apm\n" },
      "apm pack --dry-run": { code: 2, output: "boom\n" },
    }),
  );
  assert.equal(failed.status, "drift");
  assert.match(failed.note, /exited 2/);
});

test("compile: only the skill-only N/A shapes are expected", () => {
  const root = fixture();
  const clean = probeCompile(
    root,
    fakeRunner({
      "apm --version": { code: 0, output: "apm\n" },
      "apm compile --validate": { code: 0, output: "validated\n" },
    }),
  );
  assert.equal(clean.status, "unexpected");
  assert.match(clean.note, /skill-only N\/A/);

  const other = probeCompile(
    root,
    fakeRunner({
      "apm --version": { code: 0, output: "apm\n" },
      "apm compile --validate": { code: 1, output: "a different error\n" },
    }),
  );
  assert.equal(other.status, "unexpected");
  assert.match(other.note, /No instruction files found/);
});

test("compile: installed-context zero-primitive exit is the same N/A", () => {
  const root = fixture();
  // apm 0.33.0's post-`apm install` outcome for this package (observed
  // 2026-11-17: apm_modules/ present → context validates, zero of every
  // instruction-shaped kind, exit 0).
  const installed = probeCompile(
    root,
    fakeRunner({
      "apm --version": { code: 0, output: "apm\n" },
      "apm compile --validate": {
        code: 0,
        output:
          "[*] Validating APM context...\n" +
          "[*] All primitives validated successfully!\n" +
          "[i] Validated 0 primitives:\n" +
          "[i]   * 0 chatmodes\n" +
          "[i]   * 0 instructions\n" +
          "[i]   * 0 contexts\n",
      },
    }),
  );
  assert.equal(installed.status, "expected-na");

  // A non-zero primitive count is real content — still unexpected.
  const realPrimitives = probeCompile(
    root,
    fakeRunner({
      "apm --version": { code: 0, output: "apm\n" },
      "apm compile --validate": {
        code: 0,
        output:
          "[i] Validated 1 primitives:\n" +
          "[i]   * 1 instructions\n",
      },
    }),
  );
  assert.equal(realPrimitives.status, "unexpected");
});

test("apm/mise absence skips both probes with an explicit notice", () => {
  const root = fixture();
  const noMise: CmdRunner = () => {
    throw new ToolMissingError("`mise` not found on PATH");
  };
  const r = runL3Local(root, { run: noMise });
  assert.equal(r.pack.status, "skipped");
  assert.match(r.pack.note ?? "", /mise/);
  assert.equal(r.compile.status, "skipped");
  // A skip is reported but never counted as a failure or a pass.
  assert.equal(hasFailures(r), false);

  const noApm = probePack(
    root,
    fakeRunner({ "apm --version": { code: 1, output: "not installed\n" } }),
  );
  assert.equal(noApm.status, "skipped");
  assert.match(noApm.note ?? "", /mise install/);
});

const repoRoot = join(__dirname, "../../..");
const pkgRoot = join(repoRoot, "packages", "pstack-devin");

test("real package tree passes L3 local checks", () => {
  assert.ok(
    existsSync(join(pkgRoot, "devin-plugin")),
    "devin-plugin/ missing — run `pnpm --dir scripts/pstack-devin run build`",
  );
  const r = runL3Local(pkgRoot);
  assert.deepEqual(r.manifest, []);
  assert.deepEqual(r.layout, []);
  assert.deepEqual(r.separation, []);
  // The apm probes run against the real pinned binary when available and
  // report an explicit skip otherwise — neither is a silent pass.
  assert.ok(
    ["match", "skipped"].includes(r.pack.status),
    `pack: ${r.pack.status} — ${r.pack.note}`,
  );
  assert.ok(
    ["expected-na", "skipped"].includes(r.compile.status),
    `compile: ${r.compile.status} — ${r.compile.note}`,
  );
  assert.equal(hasFailures(r), false);
});
