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
import { scanSafety, SECRET_PATTERNS } from "../src/safety-scan.js";

// A minimal valid generated tree: the Devin manifest, provenance naming one
// shebang-script executable, and the script itself. Tests override entries
// per case; deleting a base file happens after fixture() returns.
const PLUGIN_JSON = JSON.stringify({
  name: "pstack",
  version: "0.1.0",
  platforms: ["local"],
});
const PROVENANCE = JSON.stringify({
  schema: "pstack-devin/provenance@1",
  executables: ["scripts/run.sh"],
});

function fixture(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "safety-scan-"));
  const tree: Record<string, string> = {
    ".devin-plugin/plugin.json": PLUGIN_JSON,
    "provenance.json": PROVENANCE,
    "scripts/run.sh": "#!/bin/sh\necho ok\n",
    "docs/readme.md": "hello\n",
    ...files,
  };
  for (const [rel, body] of Object.entries(tree)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body, "utf8");
  }
  return root;
}

/** One firing sample per SECRET_PATTERNS label — a pattern without a sample
 *  fails the table test, so every shipped rule is proven to fire. */
const SECRET_SAMPLES: Record<string, string> = {
  "github-pat": `ghp_${"a".repeat(36)}`,
  "github-oauth": "gho_16charslongtoken",
  "github-fine-grained-pat": "github_pat_11ABCDEFG0_xxxxxxxx",
  "openai-key": `sk-${"a".repeat(20)}`,
  "aws-access-key": "AKIAIOSFODNN7EXAMPLE",
  "private-key": "BEGIN RSA PRIVATE KEY",
  "slack-token": "xoxb-1234567890",
  "google-api-key": `AIza${"a".repeat(35)}`,
  "pem-begin": "-----BEGIN CERTIFICATE-----",
  jwt: `eyJ${"a".repeat(10)}.${"b".repeat(10)}.c`,
};

test("clean fixture produces no findings", () => {
  const r = scanSafety(fixture());
  assert.deepEqual(r.secrets, []);
  assert.deepEqual(r.oversized, []);
  assert.deepEqual(r.execMismatch, []);
  assert.deepEqual(r.pluginJson, []);
});

test("every secret pattern fires with its label", () => {
  for (const { label } of SECRET_PATTERNS) {
    const sample = SECRET_SAMPLES[label];
    assert.ok(sample, `no firing sample registered for label ${label}`);
    const r = scanSafety(
      fixture({ "docs/x.md": `token: ${sample}\n` }),
    );
    const hit = r.secrets.find((f) => f.label === label);
    assert.ok(hit, `label ${label} did not fire on ${JSON.stringify(sample)}`);
    assert.equal(hit.file, "docs/x.md");
    assert.equal(hit.line, 1);
    // The finding must name the rule that fired but never echo the token.
    assert.ok(!hit.match.includes(sample.slice(-8)), "match leaks token tail");
  }
});

test("token-shaped text inside a longer word is not a secret", () => {
  // `desk-…`/`mask-…` contain `sk-`; identifier boundaries keep prose safe.
  const r = scanSafety(
    fixture({ "docs/x.md": `desk-${"a".repeat(20)} and mask-${"b".repeat(20)}\n` }),
  );
  assert.deepEqual(r.secrets, []);
});

test("file over the byte cap is flagged; file at the cap is not", () => {
  const over = scanSafety(
    fixture({ "big.bin": "x".repeat(101) }),
    { maxBytes: 100 },
  );
  assert.deepEqual(over.oversized, [{ file: "big.bin", size: 101 }]);
  const at = scanSafety(
    fixture({ "ok.bin": "x".repeat(100) }),
    { maxBytes: 100 },
  );
  assert.deepEqual(at.oversized, []);
});

test("provenance executable missing on disk is flagged", () => {
  const root = fixture({
    "provenance.json": JSON.stringify({ executables: ["scripts/gone.sh"] }),
  });
  const r = scanSafety(root);
  assert.equal(r.execMismatch.length, 1);
  assert.match(r.execMismatch[0].issue, /missing|does not exist/);
  assert.equal(r.execMismatch[0].file, "scripts/gone.sh");
});

test("listed executable without shebang or binary signature is flagged", () => {
  const r = scanSafety(fixture({ "scripts/run.sh": "echo ok\n" }));
  assert.equal(r.execMismatch.length, 1);
  assert.match(r.execMismatch[0].issue, /shebang|signature|exec/i);
});

test("listed executable with binary magic is accepted", () => {
  const r = scanSafety(fixture({ "scripts/run.sh": "\x7fELF\x02\x01" }));
  assert.deepEqual(r.execMismatch, []);
});

test("shebang file absent from provenance is not flagged", () => {
  // Provenance is the authority: upstream and the overlay ship mode-644
  // scripts (invoked via an interpreter) whose exec bit must stay unset.
  const r = scanSafety(fixture({ "scripts/extra.sh": "#!/bin/sh\necho hi\n" }));
  assert.deepEqual(r.execMismatch, []);
});

test("missing or invalid provenance.json cannot verify executables", () => {
  const invalid = scanSafety(fixture({ "provenance.json": "{not json" }));
  assert.equal(invalid.execMismatch.length, 1);
  const root = fixture();
  rmSync(join(root, "provenance.json"));
  const missing = scanSafety(root);
  assert.equal(missing.execMismatch.length, 1);
});

test("unsafe path in provenance.executables is flagged, not traversed", () => {
  const r = scanSafety(
    fixture({
      "provenance.json": JSON.stringify({ executables: ["../escape.sh"] }),
    }),
  );
  assert.equal(r.execMismatch.length, 1);
  assert.match(r.execMismatch[0].issue, /unsafe|invalid/);
});

test("manifest drift: name, platforms, version, malformed JSON", () => {
  const wrongName = scanSafety(
    fixture({
      ".devin-plugin/plugin.json": JSON.stringify({
        name: "other", version: "0.1.0", platforms: ["local"],
      }),
    }),
  );
  assert.equal(wrongName.pluginJson.length, 1);
  assert.match(wrongName.pluginJson[0].issue, /name/);

  const nonLocal = scanSafety(
    fixture({
      ".devin-plugin/plugin.json": JSON.stringify({
        name: "pstack", version: "0.1.0", platforms: ["local", "cloud"],
      }),
    }),
  );
  assert.equal(nonLocal.pluginJson.length, 1);
  assert.match(nonLocal.pluginJson[0].issue, /platforms/);

  const badVersion = scanSafety(
    fixture({
      ".devin-plugin/plugin.json": JSON.stringify({
        name: "pstack", version: "v1", platforms: ["local"],
      }),
    }),
  );
  assert.equal(badVersion.pluginJson.length, 1);
  assert.match(badVersion.pluginJson[0].issue, /version|semver/);

  const malformed = scanSafety(
    fixture({ ".devin-plugin/plugin.json": "{not json" }),
  );
  assert.equal(malformed.pluginJson.length, 1);

  const root = fixture();
  rmSync(join(root, ".devin-plugin", "plugin.json"));
  assert.equal(scanSafety(root).pluginJson.length, 1);
});

test("allowlist suppresses only the justified file+label", () => {
  const token = `ghp_${"a".repeat(36)}`;
  const tree = { "docs/x.md": `token: ${token}\n` };
  const flagged = scanSafety(fixture(tree));
  assert.equal(flagged.secrets.length, 1);
  const allowed = scanSafety(fixture(tree), {
    allowlist: [{
      path: "docs/x.md",
      label: "github-pat",
      justification: "documented example, not a credential",
    }],
  });
  assert.deepEqual(allowed.secrets, []);
  // A different label in the same file must not be suppressed.
  const wrongLabel = scanSafety(
    fixture({ "docs/x.md": `token: ${token} xoxb-1234567890\n` }),
    {
      allowlist: [{
        path: "docs/x.md",
        label: "github-pat",
        justification: "documented example",
      }],
    },
  );
  assert.equal(wrongLabel.secrets.length, 1);
  assert.equal(wrongLabel.secrets[0].label, "slack-token");
  // An entry with no justification suppresses nothing.
  const unjustified = scanSafety(fixture(tree), {
    allowlist: [{ path: "docs/x.md", label: "github-pat", justification: "  " }],
  });
  assert.equal(unjustified.secrets.length, 1);
});

const repoRoot = join(__dirname, "../../..");
const PLUGIN_DIR = join(repoRoot, "packages", "pstack-devin", "devin-plugin");

test("real generated tree is clean", () => {
  assert.ok(
    existsSync(PLUGIN_DIR),
    "devin-plugin/ missing — run `pnpm --dir scripts/pstack-devin run build`",
  );
  const r = scanSafety(PLUGIN_DIR);
  assert.deepEqual(r.secrets, []);
  assert.deepEqual(r.oversized, []);
  assert.deepEqual(r.execMismatch, []);
  assert.deepEqual(r.pluginJson, []);
});
