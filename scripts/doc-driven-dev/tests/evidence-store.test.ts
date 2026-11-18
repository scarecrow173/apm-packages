import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  StoreError,
  buildIndex,
  documentRevisionOf,
  getById,
  loadManifest,
  normalizeArtifactUri,
  promoteToCommit,
  putImmutable,
  query,
  rebuildIndex,
  recoverEvidence,
  resolveEvidenceIn,
} from "../src/skills/lib/evidence_store";
import type { EvidenceInput, EvidenceRecordV1 } from "../src/skills/lib/evidence_store";
import { scanKnowledgeGraph } from "../src/skills/lib/knowledge_graph";
import { checkDesignRevision } from "../src/skills/lib/verification_checks";
import type { VerificationCheckV1 } from "../src/skills/lib/verification_checks";

// Evidence Store v1 (Issue #240): immutable verification results under
// `.apm/state/doc-driven-dev/evidence/` — append-once per-record files,
// putImmutable/getById/query, a derived regenerable index, artifact
// normalization, retention classes, and workspace→commit promotion only
// with content-identity proof.

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");
const cli = path.join(skillRoot, "doc-driven-dev-graph", "scripts", "evidence_store.js");

const FIXED_NOW = "2026-01-02T03:04:05.000Z";
const fixedClock = () => FIXED_NOW;

function tempDir(prefix = "evidence-store-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(repo: string, rel: string, content: string): void {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function git(repo: string, args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "" };
}

function gitRepo(): string {
  const repo = tempDir();
  git(repo, ["init", "-q"]);
  writeFile(repo, ".gitignore", "/.apm/state/\n");
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  return repo;
}

function sha256Of(content: string): string {
  return `sha256:${crypto.createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function baseInput(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    evidenceId: "EVID-alpha",
    claim: { ref: "SPEC-abcd::R-01", documentRevision: sha256Of("spec-v1") },
    check: { ref: "VD-efgh::CHK-01", designRevision: sha256Of("vd-v1") },
    subject: { kind: "commit", commit: "0123456789abcdef0123456789abcdef01234567" },
    method: "unit",
    provider: { kind: "repository", name: null },
    runId: "RUN-xyz",
    environment: { os: "linux", runner: "local" },
    outcome: "passed",
    retention: "release",
    artifacts: [],
    ...overrides,
  };
}

function expectStoreError(fn: () => unknown, code: string): StoreError {
  try {
    fn();
  } catch (error: unknown) {
    assert.ok(error instanceof StoreError, `expected StoreError ${code}, got ${String(error)}`);
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  assert.fail(`expected StoreError ${code}, got success`);
}

// ---------------------------------------------------------------------------
// put / get / query
// ---------------------------------------------------------------------------

test("putImmutable stores a record and getById reads it back", () => {
  const repo = gitRepo();
  const { stored, duplicate, record } = putImmutable(repo, baseInput(), { now: fixedClock });
  assert.equal(stored, true);
  assert.equal(duplicate, false);
  const file = path.join(repo, ".apm/state/doc-driven-dev/evidence/records/EVID-alpha.json");
  assert.ok(fs.existsSync(file));
  const loaded = getById(repo, "EVID-alpha");
  assert.deepEqual(loaded, record);
  assert.equal(loaded?.subject.kind, "commit");
});

test("getById returns null for missing and rejects invalid ids", () => {
  const repo = gitRepo();
  assert.equal(getById(repo, "EVID-missing"), null);
  expectStoreError(() => getById(repo, "../escape"), "invalid-argument");
  expectStoreError(() => getById(repo, "a/b"), "invalid-argument");
});

test("putImmutable writes the write-once manifest tracking location and retention", () => {
  const repo = gitRepo();
  putImmutable(repo, baseInput(), { now: fixedClock });
  const manifest = loadManifest(repo);
  assert.ok(manifest !== null);
  assert.equal(manifest.kind, "evidence-store");
  assert.equal(manifest.location, ".apm/state/doc-driven-dev");
  assert.equal(manifest.recordsDir, "records");
  assert.deepEqual(manifest.retentionClasses, ["transient", "release", "durable"]);
});

test("query filters by check, claim, outcome, retention, subject kind, and run", () => {
  const repo = gitRepo();
  const put = (input: Partial<EvidenceInput>) => putImmutable(repo, baseInput(input), { now: fixedClock });
  put({ evidenceId: "EVID-1", outcome: "passed", retention: "durable" });
  put({ evidenceId: "EVID-2", outcome: "failed", check: { ref: "VD-efgh::CHK-02", designRevision: sha256Of("vd-v1") } });
  put({ evidenceId: "EVID-3", outcome: "passed", subject: { kind: "workspace", snapshotDigest: sha256Of("snap") }, runId: "RUN-other" });
  assert.equal(query(repo, { outcome: "passed" }).length, 2);
  assert.equal(query(repo, { outcome: "failed" }).length, 1);
  assert.deepEqual(query(repo, { check: "VD-efgh::CHK-02" }).map((r) => r.evidenceId), ["EVID-2"]);
  assert.deepEqual(query(repo, { claim: "SPEC-abcd::R-01" }).length, 3);
  assert.deepEqual(query(repo, { retention: "durable" }).map((r) => r.evidenceId), ["EVID-1"]);
  assert.deepEqual(query(repo, { subjectKind: "workspace" }).map((r) => r.evidenceId), ["EVID-3"]);
  assert.deepEqual(query(repo, { runId: "RUN-other" }).map((r) => r.evidenceId), ["EVID-3"]);
  assert.equal(query(repo, {}).length, 3);
});

// ---------------------------------------------------------------------------
// Immutability: same-id conflict fails, identical re-put is idempotent
// ---------------------------------------------------------------------------

test("putImmutable fails same-id different-content (record-conflict)", () => {
  const repo = gitRepo();
  putImmutable(repo, baseInput(), { now: fixedClock });
  expectStoreError(() => putImmutable(repo, baseInput({ outcome: "failed" })), "record-conflict");
});

test("putImmutable identical re-put is idempotent (duplicate, no error)", () => {
  const repo = gitRepo();
  const first = putImmutable(repo, baseInput(), { now: fixedClock });
  const second = putImmutable(repo, { ...baseInput(), createdAt: "2026-01-03T00:00:00.000Z" }, { now: fixedClock });
  assert.equal(second.stored, false);
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.record, first.record);
});

test("invalid records are refused as invalid-argument, never corrupt on later read", () => {
  const repo = gitRepo();
  expectStoreError(() => putImmutable(repo, baseInput({ outcome: "maybe" as never })), "invalid-argument");
  expectStoreError(() => putImmutable(repo, baseInput({ retention: "forever" as never })), "invalid-argument");
  expectStoreError(() => putImmutable(repo, baseInput({ method: "vibes" as never })), "invalid-argument");
  expectStoreError(() => putImmutable(repo, baseInput({ claim: { ref: "R-01", documentRevision: sha256Of("x") } })), "invalid-argument");
  expectStoreError(() => putImmutable(repo, baseInput({ check: { ref: "VD-efgh::R-01", designRevision: sha256Of("x") } })), "invalid-argument");
  expectStoreError(() => putImmutable(repo, baseInput({ subject: { kind: "commit", commit: "not-hex" } })), "invalid-argument");
  expectStoreError(() => putImmutable(repo, baseInput({ subject: { kind: "workspace", snapshotDigest: "deadbeef" } })), "invalid-argument");
});

test("a record file binding a different id is corrupt, never adopted", () => {
  const repo = gitRepo();
  putImmutable(repo, baseInput(), { now: fixedClock });
  const recordsDir = path.join(repo, ".apm/state/doc-driven-dev/evidence/records");
  const record = JSON.parse(fs.readFileSync(path.join(recordsDir, "EVID-alpha.json"), "utf8"));
  record.evidenceId = "EVID-alpha";
  writeFile(recordsDir, "EVID-renamed.json", JSON.stringify(record));
  expectStoreError(() => getById(repo, "EVID-renamed"), "corrupt-state");
});

// ---------------------------------------------------------------------------
// Concurrent append: parallel puts share no file
// ---------------------------------------------------------------------------

test("concurrent different-id puts all land, no shared-file contention", async () => {
  const repo = gitRepo();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      new Promise<{ status: number | null; stdout: string }>((resolve, reject) => {
        const record = { ...baseInput({ evidenceId: `EVID-p${i}` }), createdAt: FIXED_NOW };
        const input = path.join(repo, `put-${i}.json`);
        fs.writeFileSync(input, JSON.stringify(record));
        const child = spawn(process.execPath, [cli, "put", "--file", input, "--cwd", repo, "--json"]);
        let stdout = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.on("error", reject);
        child.on("close", (status) => resolve({ status, stdout }));
      })),
  );
  for (const result of results) assert.equal(result.status, 0, result.stdout);
  assert.equal(query(repo, {}).length, 8);
});

test("concurrent same-id same-content puts: one stored, rest idempotent", async () => {
  const repo = gitRepo();
  const record = { ...baseInput(), createdAt: FIXED_NOW };
  const input = path.join(repo, "put.json");
  fs.writeFileSync(input, JSON.stringify(record));
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      new Promise<{ status: number | null; stdout: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [cli, "put", "--file", input, "--cwd", repo, "--json"]);
        let stdout = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.on("error", reject);
        child.on("close", (status) => resolve({ status, stdout }));
      })),
  );
  for (const result of results) assert.equal(result.status, 0, result.stdout);
  assert.equal(query(repo, {}).length, 1, "one record wins; identical duplicates stay idempotent");
});

// ---------------------------------------------------------------------------
// Derived index: deterministic regen, no shared file on append
// ---------------------------------------------------------------------------

test("the aggregate index regenerates deterministically from records", () => {
  const repo = gitRepo();
  putImmutable(repo, baseInput({ evidenceId: "EVID-1", outcome: "passed", retention: "durable" }), { now: fixedClock });
  putImmutable(repo, baseInput({ evidenceId: "EVID-2", outcome: "failed" }), { now: fixedClock });
  putImmutable(repo, baseInput({ evidenceId: "EVID-3", subject: { kind: "workspace", snapshotDigest: sha256Of("snap") } }), { now: fixedClock });
  const index = rebuildIndex(repo);
  const indexFile = path.join(repo, ".apm/state/doc-driven-dev/evidence/index.json");
  const bytes = fs.readFileSync(indexFile, "utf8");
  fs.rmSync(indexFile);
  const regen = rebuildIndex(repo);
  assert.equal(fs.readFileSync(indexFile, "utf8"), bytes, "regeneration is byte-identical");
  assert.deepEqual(regen, index);
  assert.equal(index.recordCount, 3);
  assert.equal(index.counts.byOutcome.passed, 2);
  assert.equal(index.counts.byOutcome.failed, 1);
  assert.equal(index.counts.byRetention.durable, 1);
  assert.equal(index.counts.bySubjectKind.workspace, 1);
  assert.deepEqual(index.checks["VD-efgh::CHK-01"], ["EVID-1", "EVID-2", "EVID-3"]);
  assert.equal(index.claims["SPEC-abcd::R-01"].length, 3);
});

test("buildIndex produces the same shape without touching the store", () => {
  const repo = gitRepo();
  putImmutable(repo, baseInput({ evidenceId: "EVID-1" }), { now: fixedClock });
  const record = getById(repo, "EVID-1") as EvidenceRecordV1;
  const index = buildIndex([record]);
  assert.equal(index.recordCount, 1);
  assert.equal(fs.existsSync(path.join(repo, ".apm/state/doc-driven-dev/evidence/index.json")), false);
});

// ---------------------------------------------------------------------------
// Artifact URI/hash/retention normalization + missing references
// ---------------------------------------------------------------------------

test("artifact URIs normalize; unsafe schemes and escapes refuse", () => {
  assert.equal(normalizeArtifactUri("docs/log.txt"), "docs/log.txt");
  assert.equal(normalizeArtifactUri("a/./b/../c.txt"), "a/c.txt");
  assert.equal(normalizeArtifactUri("FILE://tmp/x.log"), "file:///tmp/x.log", "scheme casing normalizes");
  assert.equal(normalizeArtifactUri("file://tmp/x/../y.log"), "file:///tmp/y.log");
  assert.equal(normalizeArtifactUri("HTTP://Example.COM:80/p"), "http://example.com/p");
  assert.equal(normalizeArtifactUri("javascript:alert(1)"), null);
  assert.equal(normalizeArtifactUri("data:text/plain,hi"), null);
  assert.equal(normalizeArtifactUri("a/../../escape"), null);
  assert.equal(normalizeArtifactUri("/abs/path"), null);
  assert.equal(normalizeArtifactUri("C:\\win\\path"), null);
  assert.equal(normalizeArtifactUri("has space.txt"), null);
});

test("artifacts normalize sha256 spelling and default availability/retention", () => {
  const repo = gitRepo();
  const { record } = putImmutable(repo, baseInput({
    artifacts: [
      { uri: "logs/out.txt", sha256: crypto.createHash("sha256").update("x").digest("hex") },
      { uri: "logs/ref-only.txt" },
    ],
  }), { now: fixedClock });
  assert.equal(record.artifacts[0].availability, "available");
  assert.match(record.artifacts[0].sha256 as string, /^sha256:[0-9a-f]{64}$/);
  assert.equal(record.artifacts[0].retention, "release", "artifact retention defaults to the record's");
  assert.equal(record.artifacts[1].availability, "unverified", "no digest and no availability claim = unverified");
});

test("an available artifact without a digest is refused — unfetched refs cannot claim verified", () => {
  const repo = gitRepo();
  expectStoreError(() => putImmutable(repo, baseInput({
    artifacts: [{ uri: "logs/out.txt", availability: "available", sha256: null }],
  })), "invalid-argument");
});

test("unavailable and unverified artifacts record honestly — never miscounted as passed", () => {
  const repo = gitRepo();
  const { record } = putImmutable(repo, baseInput({
    outcome: "passed",
    artifacts: [
      { uri: "logs/dead-link.txt", availability: "unavailable", expiresAt: "2026-02-01T00:00:00Z" },
      { uri: "logs/pending.txt", availability: "unverified" },
    ],
  }), { now: fixedClock });
  assert.equal(record.artifacts[0].availability, "unavailable");
  assert.equal(record.artifacts[0].expiresAt, "2026-02-01T00:00:00Z");
  assert.equal(record.artifacts[1].availability, "unverified");
  assert.equal(record.artifacts[1].sha256, null);
});

test("artifact expiresAt must be an ISO timestamp when present", () => {
  const repo = gitRepo();
  expectStoreError(() => putImmutable(repo, baseInput({
    artifacts: [{ uri: "logs/x.txt", expiresAt: "not-a-date" }],
  })), "invalid-argument");
});

// ---------------------------------------------------------------------------
// Commit vs workspace: no promotion without content-identity proof
// ---------------------------------------------------------------------------

const SNAP = sha256Of("workspace tree v1");

function workspaceEvidence(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return baseInput({ subject: { kind: "workspace", snapshotDigest: SNAP }, ...overrides });
}

test("workspace evidence stores as-is — never silently becomes commit evidence", () => {
  const repo = gitRepo();
  const { record } = putImmutable(repo, workspaceEvidence(), { now: fixedClock });
  assert.equal(record.subject.kind, "workspace");
  if (record.subject.kind === "workspace") assert.equal(record.subject.snapshotDigest, SNAP);
});

test("promoteToCommit refuses when the tree digest does not prove content identity", () => {
  const repo = gitRepo();
  putImmutable(repo, workspaceEvidence(), { now: fixedClock });
  expectStoreError(
    () => promoteToCommit(repo, "EVID-alpha", { commit: "a".repeat(40), treeDigest: sha256Of("different tree") }),
    "subject-mismatch",
  );
  assert.equal(query(repo, { subjectKind: "commit" }).length, 0, "no commit record was created");
});

test("promoteToCommit creates commit evidence when content identity is proven", () => {
  const repo = gitRepo();
  putImmutable(repo, workspaceEvidence(), { now: fixedClock });
  const commit = "f".repeat(40);
  const { record } = promoteToCommit(repo, "EVID-alpha", { newEvidenceId: "EVID-promoted", commit, treeDigest: SNAP });
  assert.equal(record.subject.kind, "commit");
  if (record.subject.kind === "commit") assert.equal(record.subject.commit, commit);
  assert.equal(record.derivedFrom, "EVID-alpha");
  assert.equal(record.outcome, "passed");
});

test("promoteToCommit refuses for a commit-subject record (no re-promotion)", () => {
  const repo = gitRepo();
  putImmutable(repo, baseInput(), { now: fixedClock });
  expectStoreError(
    () => promoteToCommit(repo, "EVID-alpha", { commit: "b".repeat(40), treeDigest: sha256Of("t") }),
    "invalid-argument",
  );
});

// ---------------------------------------------------------------------------
// Boundary: gitignore coverage, containment, tmp recovery
// ---------------------------------------------------------------------------

test("boundary: writes refuse when .apm/state coverage is unconfigured", () => {
  const repo = tempDir();
  git(repo, ["init", "-q"]);
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init", "--allow-empty"]);
  expectStoreError(() => putImmutable(repo, baseInput()), "boundary-gitignore");
  assert.equal(fs.existsSync(path.join(repo, ".apm")), false);
});

test("boundary: an evidence dir symlinked outside the state root refuses", () => {
  const repo = gitRepo();
  const outside = tempDir("evidence-outside-");
  const stateRoot = path.join(repo, ".apm/state/doc-driven-dev");
  fs.mkdirSync(stateRoot, { recursive: true });
  fs.symlinkSync(outside, path.join(stateRoot, "evidence"));
  expectStoreError(() => putImmutable(repo, baseInput()), "boundary-escape");
});

test("recover removes tmp orphans; a partial write never becomes a record", () => {
  const repo = gitRepo();
  putImmutable(repo, baseInput(), { now: fixedClock });
  const recordsDir = path.join(repo, ".apm/state/doc-driven-dev/evidence/records");
  fs.writeFileSync(path.join(recordsDir, "EVID-partial.json.tmp-1-1"), "{\"schemaVersion\":1");
  const result = recoverEvidence(repo);
  assert.deepEqual(result.removedTmpFiles, ["records/EVID-partial.json.tmp-1-1"]);
  assert.equal(result.records, 1);
});

// ---------------------------------------------------------------------------
// Retention classes
// ---------------------------------------------------------------------------

test("transient/release/durable records coexist and index counts retention", () => {
  const repo = gitRepo();
  putImmutable(repo, baseInput({ evidenceId: "EVID-t", retention: "transient" }), { now: fixedClock });
  putImmutable(repo, baseInput({ evidenceId: "EVID-r", retention: "release" }), { now: fixedClock });
  putImmutable(repo, baseInput({ evidenceId: "EVID-d", retention: "durable" }), { now: fixedClock });
  const index = rebuildIndex(repo);
  assert.equal(index.counts.byRetention.transient, 1);
  assert.equal(index.counts.byRetention.release, 1);
  assert.equal(index.counts.byRetention.durable, 1);
  assert.deepEqual(query(repo, { retention: "transient" }).map((r) => r.evidenceId), ["EVID-t"]);
});

// ---------------------------------------------------------------------------
// Back-resolution: record → claim/check revisions + subject
// ---------------------------------------------------------------------------

function vdCheck(): VerificationCheckV1 {
  return {
    id: "CHK-01",
    target: "SPEC-abcd::R-01",
    method: "unit",
    implementation: "pnpm test",
    preconditions: ["spec exists"],
    passCriteria: { kind: "unit", expect: "tests pass" },
    limitations: [],
    required: true,
  };
}

function knowledgeRepo(): string {
  const repo = gitRepo();
  writeFile(repo, "docs/specs/spec-abcd.md", [
    "---",
    "id: SPEC-abcd",
    "type: spec",
    "status: draft",
    "---",
    "",
    "# Spec",
    "",
    "<!-- claim:R-01 --> The thing must work.",
    "",
  ].join("\n"));
  const check = vdCheck();
  writeFile(repo, "docs/verification/vd-efgh.md", [
    "---",
    "id: VD-efgh",
    "type: verification",
    "status: draft",
    "checks:",
    `  - id: ${check.id}`,
    `    target: ${check.target}`,
    `    method: ${check.method}`,
    `    implementation: ${check.implementation}`,
    "    preconditions:",
    `      - ${check.preconditions[0]}`,
    "    passCriteria:",
    "      kind: unit",
    `      expect: ${check.passCriteria.expect}`,
    "    limitations: []",
    "    required: true",
    "---",
    "",
    "<!-- check:CHK-01 --> Unit check.",
    "",
  ].join("\n"));
  return repo;
}

test("resolveEvidenceIn back-resolves claim/check revisions against the live graph", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  const docBytes = fs.readFileSync(path.join(repo, "docs/specs/spec-abcd.md"), "utf8");
  const record = getById(repo, "EVID-alpha");
  putImmutable(repo, baseInput({
    claim: { ref: "SPEC-abcd::R-01", documentRevision: documentRevisionOf(docBytes) },
    check: { ref: "VD-efgh::CHK-01", designRevision: checkDesignRevision(vdCheck()) },
  }), { now: fixedClock });
  const stored = getById(repo, "EVID-alpha") as EvidenceRecordV1;
  const resolution = resolveEvidenceIn(graph, stored, (p) => fs.readFileSync(path.join(repo, p), "utf8"));
  assert.equal(resolution.claim.status, "resolved");
  assert.equal(resolution.check.status, "resolved");
  assert.equal(resolution.current, true, "pinned revisions match the live graph");
});

test("resolveEvidenceIn reports revision mismatch when the design moved on", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  putImmutable(repo, baseInput({
    check: { ref: "VD-efgh::CHK-01", designRevision: sha256Of("an older design") },
  }), { now: fixedClock });
  const stored = getById(repo, "EVID-alpha") as EvidenceRecordV1;
  const resolution = resolveEvidenceIn(graph, stored, (p) => fs.readFileSync(path.join(repo, p), "utf8"));
  assert.equal(resolution.check.status, "resolved");
  if (resolution.check.status === "resolved") {
    assert.equal(resolution.check.matchesPinned, false, "an edited check no longer matches the pinned design revision");
  }
  assert.equal(resolution.current, false);
});

test("resolveEvidenceIn fails closed on unresolved references", async () => {
  const repo = knowledgeRepo();
  const graph = await scanKnowledgeGraph({ cwd: repo });
  putImmutable(repo, baseInput({ check: { ref: "VD-nope::CHK-01", designRevision: sha256Of("x") } }), { now: fixedClock });
  const stored = getById(repo, "EVID-alpha") as EvidenceRecordV1;
  const resolution = resolveEvidenceIn(graph, stored, (p) => fs.readFileSync(path.join(repo, p), "utf8"));
  assert.equal(resolution.check.status, "unresolved-document");
  assert.equal(resolution.current, false);
});

// ---------------------------------------------------------------------------
// CLI end-to-end (built JS)
// ---------------------------------------------------------------------------

test("cli: put + get + query + reindex + promote round-trip", () => {
  const repo = gitRepo();
  const record = { ...baseInput(), createdAt: FIXED_NOW };
  const input = path.join(repo, "evidence.json");
  fs.writeFileSync(input, JSON.stringify(record));
  const put = spawnSync(process.execPath, [cli, "put", "--file", input, "--cwd", repo, "--json"], { encoding: "utf8" });
  assert.equal(put.status, 0, put.stdout + put.stderr);
  const get = spawnSync(process.execPath, [cli, "get", "EVID-alpha", "--cwd", repo, "--json"], { encoding: "utf8" });
  assert.equal(get.status, 0, get.stdout);
  assert.match(get.stdout, /EVID-alpha/);
  const list = spawnSync(process.execPath, [cli, "query", "--outcome", "passed", "--cwd", repo, "--json"], { encoding: "utf8" });
  assert.equal(list.status, 0);
  assert.match(list.stdout, /EVID-alpha/);
  const reindex = spawnSync(process.execPath, [cli, "reindex", "--cwd", repo, "--json"], { encoding: "utf8" });
  assert.equal(reindex.status, 0);
  const promoted = spawnSync(process.execPath, [cli, "promote", "EVID-alpha", "--commit", "b".repeat(40), "--tree-digest", sha256Of("x"), "--cwd", repo, "--json"], { encoding: "utf8" });
  assert.equal(promoted.status, 1, "commit-subject records cannot promote");
});

test("cli: duplicate-id fixture — second different content is a conflict", () => {
  const repo = gitRepo();
  const input = path.join(repo, "evidence.json");
  fs.writeFileSync(input, JSON.stringify({ ...baseInput(), createdAt: FIXED_NOW }));
  assert.equal(spawnSync(process.execPath, [cli, "put", "--file", input, "--cwd", repo], { encoding: "utf8" }).status, 0);
  fs.writeFileSync(input, JSON.stringify({ ...baseInput({ outcome: "failed" }), createdAt: FIXED_NOW }));
  const second = spawnSync(process.execPath, [cli, "put", "--file", input, "--cwd", repo, "--json"], { encoding: "utf8" });
  assert.equal(second.status, 1);
  assert.match(second.stdout, /record-conflict/);
});
