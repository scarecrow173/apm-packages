"use strict";

// ---------------------------------------------------------------------------
// Evidence Store v1 — immutable Evidence Records (Issue #240)
// ---------------------------------------------------------------------------
//
// Verification RESULTS live outside Git under
// `.apm/state/doc-driven-dev/evidence/` — a sibling of `runs/` under the
// same state root, covered by the same `/.apm/state/` ignore umbrella and
// boundary rules as the Execution Store. Nothing here is run state:
// records outlive runs (release/durable retention) and are never mutated.
//
// Consistency model:
//   - append-once: `putImmutable` writes `records/<id>.json` through a
//     write-tmp + hardlink commit — the link is the atomic create, so a
//     reader only ever sees a complete record and exactly one of two
//     racing writers wins;
//   - no shared-file writes on the append path — parallel puts touch only
//     their own record file, so concurrent appends cannot create a
//     contention point on a shared index or lock;
//   - identical re-put (canonical content, `createdAt` aside) is an
//     idempotent no-op; same-id different-content is a record-conflict;
//   - `index.json` is a DERIVED aggregate — regenerated deterministically
//     from the records dir by `rebuildIndex`, never consulted on writes;
//   - there is no update or delete path: immutable means immutable.
//
// `manifest.json` is a write-once marker recording where the Git-untracked
// records live and the retention vocabulary — the "durable manifest
// location" the issue asks to track.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { generateArtifactId } from "../artifact_id";
import {
  StoreError,
  atomicWriteFile,
  fsyncDirectory,
  isStoreTmpFile,
  readJsonFile,
  tmpNameFor,
} from "../execution_store/atomic";
import {
  ensureStateRootBoundary,
  resolveStateRoot,
} from "../execution_store/boundary";
import type { ResolvedRoot, StoreRootOptions } from "../execution_store/boundary";
import { canonicalJson, isPlainObject, isValidId } from "../execution_store/types";
import {
  EVIDENCE_INDEX_SCHEMA_VERSION,
  EVIDENCE_MANIFEST_SCHEMA_VERSION,
  EVIDENCE_OUTCOMES,
  EVIDENCE_RETENTIONS,
  normalizeArtifactUri,
  normalizeRevisionDigest,
  validateEvidenceRecord,
  validateIndex,
  validateManifest,
} from "./types";
import type {
  EvidenceIndex,
  EvidenceOutcome,
  EvidenceRecordV1,
  EvidenceRetention,
  EvidenceStoreManifest,
} from "./types";

const EVIDENCE_DIR = "evidence";
const RECORDS_DIR = "records";
const MANIFEST_FILE = "manifest.json";
const INDEX_FILE = "index.json";

type Clock = () => string;
const systemClock: Clock = () => new Date().toISOString();

type StoreOptions = StoreRootOptions & { now?: Clock };

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

// sha256 of a file's canonical bytes, prefixed `sha256:` — the
// document-revision convention shared with check design revisions, so a
// pinned documentRevision survives a later file edit comparison.
export function documentRevisionOf(content: string): string {
  return `sha256:${sha256(content)}`;
}

// ---------------------------------------------------------------------------
// Canonical subject digests — the content-identity algorithm (#240)
// ---------------------------------------------------------------------------
//
// A subject digest is `sha256:` over a namespaced git tree object id:
//
//   sha256("doc-driven-dev:subject-tree:v1:<git-tree-oid-hex>")
//
// Git's tree id IS the repository's native content identity — it covers
// every tracked path, entry mode, and blob content recursively — so two
// subjects carrying the same tree oid are the same bytes by Git's own
// definition. The namespaced sha256 wrapper normalizes repo object format
// (sha1 and sha256 object stores produce different oid widths) into the
// record's fixed `sha256:<64-hex>` slot and keeps a subject digest from
// ever colliding with a document revision or artifact digest.
//
// Both sides of a promotion compute through this one algorithm:
//   commit side    — `treeDigestOf` resolves `<commit>^{tree}` in the
//                    checkout, so the digest is COMPUTED from an object
//                    Git proves exists, never caller-asserted;
//   workspace side — the measuring adapter snapshots the workspace into a
//                    git tree oid (the documented recipe is a temporary
//                    index + `git write-tree`) and publishes
//                    `workspaceDigestOf(treeOid)` as `snapshotDigest`.
//                    The store can never re-observe the measured
//                    workspace, so the snapshot stays adapter-attested —
//                    but it is an attestation bound to one canonical
//                    algorithm, and promotion verifies the two spell the
//                    same content identity.
const SUBJECT_DIGEST_NAMESPACE = "doc-driven-dev:subject-tree:v1";

function subjectTreeDigest(treeOid: string): string {
  return `sha256:${sha256(`${SUBJECT_DIGEST_NAMESPACE}:${treeOid.toLowerCase()}`)}`;
}

// Canonical `subject.snapshotDigest` for a measured workspace, given the
// git tree oid the adapter snapshotted (temp-index `git write-tree`).
// Returns null when the input is not a hex object id — adapters check the
// result instead of trusting their snapshot verbatim.
function workspaceDigestOf(treeOid: unknown): string | null {
  if (typeof treeOid !== "string" || !/^[0-9a-f]{40,64}$/i.test(treeOid.trim())) return null;
  return subjectTreeDigest(treeOid.trim());
}

// ---------------------------------------------------------------------------
// Git probes — the commit side of the promotion proof
// ---------------------------------------------------------------------------

function git(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string; error?: Error } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: (result.stderr ?? "").trim(),
    error: result.error,
  };
}

// Resolve `<commit>^{commit}` then `^{tree}` in the checkout — the only
// verified half of the promotion proof. Returns the FULL commit oid
// alongside the tree: a record's commit subject names the exact object
// the proof ran against, never an abbreviation the caller typed. A value
// that does not name a commit object in this repository has no tree to
// digest, so promotion fails closed as invalid-argument; git itself
// being unavailable is the boundary failure boundary.ts already names.
function requireCommitTreeOid(cwd: string, commit: string): { commitOid: string; treeOid: string } {
  const asCommit = git(["rev-parse", "--verify", "--quiet", `${commit}^{commit}`], cwd);
  if (asCommit.error !== undefined) {
    throw new StoreError(
      "boundary-git-unavailable",
      `cannot run git rev-parse (${asCommit.error.message}) — the commit's content identity cannot be verified`,
    );
  }
  const commitOid = asCommit.stdout.trim();
  if (asCommit.status !== 0 || !/^[0-9a-f]{40,64}$/i.test(commitOid)) {
    throw new StoreError(
      "invalid-argument",
      `commit ${JSON.stringify(commit)} does not resolve to a commit object in this repository — content identity is unprovable`,
      { commit },
    );
  }
  const asTree = git(["rev-parse", "--verify", "--quiet", `${commitOid}^{tree}`], cwd);
  const treeOid = asTree.stdout.trim();
  if (asTree.error !== undefined || asTree.status !== 0 || !/^[0-9a-f]{40,64}$/i.test(treeOid)) {
    throw new StoreError(
      "boundary-git-unavailable",
      `git could not read the tree of commit ${commitOid} — the commit's content identity cannot be verified`,
    );
  }
  return { commitOid: commitOid.toLowerCase(), treeOid: treeOid.toLowerCase() };
}

// The commit side of the canonical digest, or null when `commit` does not
// name a commit object in `cwd`'s repository (or git cannot answer).
// Adapters verify a recorded commit subject with the same algorithm
// promotion enforces.
function treeDigestOf(cwd: string, commit: string): string | null {
  if (typeof commit !== "string" || !/^[0-9a-f]{7,64}$/i.test(commit.trim())) return null;
  try {
    return subjectTreeDigest(requireCommitTreeOid(cwd, commit.trim()).treeOid);
  } catch {
    return null;
  }
}

// The full commit-side subject resolution: the normalized full commit oid
// plus its canonical subject digest, or null when `commit` does not name a
// commit object. Evidence Assessment (#241) uses this to compare a record's
// commit subject — and the caller-declared assessment target — against the
// current checkout's HEAD content. Unlike `treeDigestOf`, which validates a
// RECORDED subject (always a concrete hex oid), the input here is a git
// revision to resolve — `HEAD`, a branch, a tag, `HEAD~2` — so any safe
// revspec spelling goes through `rev-parse` and git itself decides whether
// it names a commit object in this repository.
function isResolvableRevision(commit: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/~^@-]*$/.test(commit.trim());
}

function resolveCommitSubject(cwd: string, commit: string): { commitOid: string; subjectDigest: string } | null {
  if (typeof commit !== "string" || !isResolvableRevision(commit)) return null;
  try {
    const { commitOid, treeOid } = requireCommitTreeOid(cwd, commit.trim());
    return { commitOid, subjectDigest: subjectTreeDigest(treeOid) };
  } catch {
    return null;
  }
}

function nowOf(options: StoreOptions): string {
  return (options.now ?? systemClock)();
}

// ---------------------------------------------------------------------------
// Paths + containment
// ---------------------------------------------------------------------------

// Realpath containment against the resolved state root — same rule as the
// run store: an `evidence/` or `records/` link landing elsewhere inside
// the checkout would write records into committable space the coverage
// gates never covered.
function insideResolvedRoot(resolved: ResolvedRoot, candidate: string): boolean {
  let real: string;
  let realRoot: string;
  try {
    real = fs.realpathSync(candidate);
    realRoot = fs.realpathSync(resolved.root);
  } catch {
    return false;
  }
  const root = path.resolve(realRoot);
  const target = path.resolve(real);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function evidenceRootFor(resolved: ResolvedRoot): string {
  return path.join(resolved.root, EVIDENCE_DIR);
}

function recordsDirFor(resolved: ResolvedRoot): string {
  return path.join(evidenceRootFor(resolved), RECORDS_DIR);
}

// Verify a directory candidate (evidence root or records dir) stays inside
// the resolved root by real path — every write/scan goes through this.
function containedDir(resolved: ResolvedRoot, dir: string, label: string): string {
  if (fs.existsSync(dir)) {
    if (!fs.statSync(dir).isDirectory()) {
      throw new StoreError("corrupt-state", `${dir} is not a directory`);
    }
    if (!insideResolvedRoot(resolved, dir)) {
      throw new StoreError("boundary-escape", `the ${label} under ${resolved.repoRelative ?? resolved.root} escapes the state root through a link`);
    }
  }
  return dir;
}

function recordFileFor(resolved: ResolvedRoot, evidenceId: string): string {
  if (!isValidId(evidenceId)) {
    throw new StoreError("invalid-argument", `invalid evidence id ${JSON.stringify(evidenceId)}`);
  }
  return path.join(recordsDirFor(resolved), `${evidenceId}.json`);
}

// ---------------------------------------------------------------------------
// Manifest — write-once store marker
// ---------------------------------------------------------------------------

// The store manifest tracks where the Git-untracked records live (repo-
// relative inside the checkout, absolute for a declared external root) and
// the retention classes the store honors. It is written once and then only
// validated — a changed manifest is corrupt, not an update.
function ensureManifest(resolved: ResolvedRoot, options: StoreOptions): EvidenceStoreManifest {
  const evidenceDir = containedDir(resolved, evidenceRootFor(resolved), "evidence root");
  fs.mkdirSync(recordsDirFor(resolved), { recursive: true });
  containedDir(resolved, recordsDirFor(resolved), "records dir");
  const file = path.join(evidenceDir, MANIFEST_FILE);
  const manifest: EvidenceStoreManifest = {
    schemaVersion: EVIDENCE_MANIFEST_SCHEMA_VERSION,
    kind: "evidence-store",
    location: resolved.repoRelative ?? resolved.root,
    recordsDir: RECORDS_DIR,
    retentionClasses: [...EVIDENCE_RETENTIONS],
    createdAt: nowOf(options),
  };
  if (!fs.existsSync(file)) {
    // Write-once create through the same link commit as records — racing
    // first-writers each lose cleanly and re-read the winner's manifest.
    if (!appendOnceFile(file, `${JSON.stringify(manifest, null, 2)}\n`)) {
      // Lost the race — the winner's manifest is the store's; read it.
    }
  }
  const parsed = readJsonFile(file);
  if (isPlainObject(parsed) && parsed.schemaVersion !== EVIDENCE_MANIFEST_SCHEMA_VERSION) {
    throw new StoreError(
      "unsupported-version",
      `evidence manifest schemaVersion is ${JSON.stringify(parsed.schemaVersion)}, expected ${EVIDENCE_MANIFEST_SCHEMA_VERSION} — upgrade the toolchain`,
    );
  }
  if (!validateManifest(parsed)) {
    throw new StoreError("corrupt-state", `evidence manifest at ${file} failed validation`, { path: file });
  }
  requireManifestLocation(parsed, resolved, file);
  return parsed;
}

// A manifest must describe the root it was read from: `location` is the
// resolved root's own spelling (repo-relative inside the checkout,
// absolute for a declared external root). A manifest written for another
// root is misplaced state — copied or moved stores are corrupt, never
// silently adopted under the wrong location claim.
function requireManifestLocation(
  manifest: EvidenceStoreManifest,
  resolved: ResolvedRoot,
  file: string,
): void {
  const expected = resolved.repoRelative ?? resolved.root;
  if (manifest.location !== expected) {
    throw new StoreError(
      "corrupt-state",
      `evidence manifest at ${file} declares location ${JSON.stringify(manifest.location)}, expected ${JSON.stringify(expected)} — a manifest only ever describes its own resolved root`,
      { path: file, declared: manifest.location, expected },
    );
  }
}

function loadManifest(cwd: string, options: StoreOptions = {}): EvidenceStoreManifest | null {
  const resolved = resolveStateRoot(cwd, options);
  const file = path.join(evidenceRootFor(resolved), MANIFEST_FILE);
  if (!fs.existsSync(file)) return null;
  const parsed = readJsonFile(file);
  if (!validateManifest(parsed)) {
    throw new StoreError("corrupt-state", `evidence manifest at ${file} failed validation`, { path: file });
  }
  requireManifestLocation(parsed, resolved, file);
  return parsed;
}

// ---------------------------------------------------------------------------
// Append-once record writes
// ---------------------------------------------------------------------------

// Atomic create-if-absent: write a tmp sibling, then hardlink it into
// place — the link either commits a complete file or fails EEXIST, so a
// reader never sees a torn record and racing writers pick exactly one
// winner. A `*.tmp-*` orphan is crash evidence, never content.
function appendOnceFile(file: string, content: string): boolean {
  const tmp = tmpNameFor(file);
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, "w");
    fs.writeSync(fd, content, 0, "utf8");
    fs.fsyncSync(fd);
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* fall through */ }
    }
  }
  try {
    fs.linkSync(tmp, file);
  } catch (error: unknown) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* tmp stays as recovery evidence */ }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    // A link failure that is not "already exists" is still a store error —
    // never let a raw filesystem exception leak past the contract surface.
    throw new StoreError(
      "state-unwritable",
      `cannot commit ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { path: file },
    );
  }
  try { fs.rmSync(tmp, { force: true }); } catch { /* tmp cleanup is best-effort */ }
  fsyncDirectory(path.dirname(file));
  return true;
}

// Semantic equality ignores `createdAt`: re-recording the same logical
// record with a fresh stamp is the idempotent retry, not new content.
function sameRecordContent(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const strip = (value: Record<string, unknown>): Record<string, unknown> => {
    const copy = { ...value };
    delete copy.createdAt;
    return copy;
  };
  return canonicalJson(strip(a)) === canonicalJson(strip(b));
}

function listRecordFiles(recordsDir: string): string[] {
  if (!fs.existsSync(recordsDir)) return [];
  return fs.readdirSync(recordsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(recordsDir, entry.name))
    .sort();
}

function readRecordFile(file: string): EvidenceRecordV1 {
  const parsed = readJsonFile(file);
  if (isPlainObject(parsed) && parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1) {
    throw new StoreError(
      "unsupported-version",
      `${file} carries schemaVersion ${JSON.stringify(parsed.schemaVersion)}, expected 1 — upgrade the toolchain`,
    );
  }
  if (!validateEvidenceRecord(parsed)) {
    throw new StoreError("corrupt-state", `${file} failed evidence record validation`, { path: file });
  }
  const idFromName = path.basename(file, ".json");
  if (parsed.evidenceId !== idFromName) {
    throw new StoreError(
      "corrupt-state",
      `record in ${file} binds evidence ${parsed.evidenceId}, expected ${idFromName} — a record file only ever carries its own id`,
    );
  }
  return parsed;
}

function scanRecords(resolved: ResolvedRoot): EvidenceRecordV1[] {
  const recordsDir = containedDir(resolved, recordsDirFor(resolved), "records dir");
  return listRecordFiles(recordsDir).map(readRecordFile);
}

// ---------------------------------------------------------------------------
// Input normalization — intake shape → canonical record
// ---------------------------------------------------------------------------

type EvidenceInput = {
  evidenceId?: string;
  claim: { ref: string; documentRevision?: string };
  check: { ref: string; designRevision?: string };
  subject:
    | { kind: "commit"; commit: string }
    | { kind: "workspace"; snapshotDigest: string };
  method: string;
  provider?: { kind: string; name?: string | null };
  runId?: string | null;
  environment?: unknown;
  outcome: string;
  retention?: string;
  artifacts?: Array<{
    uri: string;
    sha256?: string | null;
    availability?: string;
    retention?: string;
    expiresAt?: string | null;
  }>;
  // Promotion provenance — reserved: `putImmutable` refuses any non-null
  // value; only `promoteToCommit` writes `derivedFrom`, through the
  // internal append path, after verifying content identity. A record can
  // never claim a lineage at put.
  derivedFrom?: string | null;
  createdAt?: string;
};

// Freeform fields are stored as their JSON round-trip form. Values that
// cannot serialize at all (circular graphs, BigInt, functions) refuse at
// the boundary as invalid-argument instead of surfacing a raw TypeError
// mid-write, and spellings JSON drops (`undefined` properties) or rewrites
// (NaN → null) normalize NOW so an idempotent re-put of the same logical
// input compares byte-identical to the stored record.
function normalizeJsonField(value: unknown, field: string): unknown {
  if (value === undefined || value === null) return null;
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    text = undefined;
  }
  if (text === undefined) {
    throw new StoreError(
      "invalid-argument",
      `${field} must be JSON-serializable — circular or otherwise non-JSON values cannot be recorded verbatim`,
    );
  }
  return JSON.parse(text);
}

// Build a fully validated canonical record from intake fields — field
// normalization (refs trimmed, digests prefixed, URIs normalized) happens
// once here so the stored form is always canonical. Everything the next
// read would reject is refused NOW as invalid-argument, never corrupt.
// `derivedFrom` arrives only through the promotion path — the intake
// field is never adopted.
function buildRecord(input: EvidenceInput, options: StoreOptions, derivedFrom: string | null): EvidenceRecordV1 {
  const evidenceId = input.evidenceId ?? generateArtifactId("EVID");
  if (!isValidId(evidenceId)) {
    throw new StoreError("invalid-argument", `invalid evidence id ${JSON.stringify(evidenceId)}`);
  }
  if (!isPlainObject(input.claim) || typeof input.claim.ref !== "string") {
    throw new StoreError("invalid-argument", "evidence requires claim.ref — a qualified claim reference DOC::KEY");
  }
  const claimRef = input.claim.ref.trim();
  const documentRevision = normalizeRevisionDigest(input.claim.documentRevision);
  if (documentRevision === null) {
    throw new StoreError("invalid-argument", `claim.documentRevision must be a sha256 digest, got ${JSON.stringify(input.claim.documentRevision)}`);
  }
  if (!isPlainObject(input.check) || typeof input.check.ref !== "string") {
    throw new StoreError("invalid-argument", "evidence requires check.ref — a qualified check reference VD-<id>::CHK-NN");
  }
  const checkRef = input.check.ref.trim();
  const designRevision = normalizeRevisionDigest(input.check.designRevision);
  if (designRevision === null) {
    throw new StoreError("invalid-argument", `check.designRevision must be a sha256 digest, got ${JSON.stringify(input.check.designRevision)}`);
  }
  const retention = (input.retention ?? "release") as EvidenceRetention;
  const artifacts = (input.artifacts ?? []).map((artifact) => {
    const uri = normalizeArtifactUri(artifact?.uri);
    if (uri === null) {
      throw new StoreError("invalid-argument", `artifact URI ${JSON.stringify(artifact?.uri)} is not a valid, safe reference`);
    }
    const digest = artifact.sha256 === undefined || artifact.sha256 === null
      ? null
      : normalizeRevisionDigest(artifact.sha256);
    if (artifact.sha256 !== undefined && artifact.sha256 !== null && digest === null) {
      throw new StoreError("invalid-argument", `artifact sha256 ${JSON.stringify(artifact.sha256)} is not a sha256 digest`);
    }
    return {
      uri,
      sha256: digest,
      availability: (artifact.availability ?? (digest === null ? "unverified" : "available")) as EvidenceRecordV1["artifacts"][number]["availability"],
      retention: (artifact.retention ?? retention) as EvidenceRetention,
      expiresAt: artifact.expiresAt ?? null,
    };
  });
  const provider = {
    kind: (input.provider?.kind ?? "repository") as EvidenceRecordV1["provider"]["kind"],
    name: input.provider?.name ?? null,
  };
  const record: EvidenceRecordV1 = {
    schemaVersion: 1,
    evidenceId,
    claim: { ref: claimRef, documentRevision },
    check: { ref: checkRef, designRevision },
    subject: input.subject,
    method: input.method as EvidenceRecordV1["method"],
    provider,
    runId: input.runId ?? null,
    environment: normalizeJsonField(input.environment, "environment"),
    outcome: input.outcome as EvidenceOutcome,
    retention,
    artifacts,
    derivedFrom,
    createdAt: input.createdAt ?? nowOf(options),
  };
  if (!validateEvidenceRecord(record)) {
    throw new StoreError(
      "invalid-argument",
      `evidence ${evidenceId} failed record validation — claim/check refs must be qualified (DOC::KEY, VD-<id>::CHK-NN), outcome one of ${[...EVIDENCE_OUTCOMES].join("|")}, retention one of ${[...EVIDENCE_RETENTIONS].join("|")}, subject commit|workspace(snapshotDigest), and 'available' artifacts must carry a sha256 digest`,
    );
  }
  return record;
}

// ---------------------------------------------------------------------------
// Public API — putImmutable / getById / query
// ---------------------------------------------------------------------------

// The shared append path. `derivedFrom` is promotion provenance the
// internal caller supplies — `putImmutable` always passes null, so the
// field can never be forged through intake.
function putRecord(
  cwd: string,
  input: EvidenceInput,
  derivedFrom: string | null,
  options: StoreOptions,
): { stored: boolean; duplicate: boolean; record: EvidenceRecordV1 } {
  const resolved = resolveStateRoot(cwd, options);
  ensureStateRootBoundary(cwd, resolved);
  ensureManifest(resolved, options);
  const record = buildRecord(input, options, derivedFrom);
  const file = recordFileFor(resolved, record.evidenceId);
  const body = `${JSON.stringify(record, null, 2)}\n`;
  if (!appendOnceFile(file, body)) {
    const existing = readRecordFile(file);
    if (sameRecordContent(existing as unknown as Record<string, unknown>, record as unknown as Record<string, unknown>)) {
      return { stored: false, duplicate: true, record: existing };
    }
    throw new StoreError(
      "record-conflict",
      `evidence ${record.evidenceId} already exists with different content — records are immutable`,
      { evidenceId: record.evidenceId },
    );
  }
  return { stored: true, duplicate: false, record };
}

function putImmutable(
  cwd: string,
  input: EvidenceInput,
  options: StoreOptions = {},
): { stored: boolean; duplicate: boolean; record: EvidenceRecordV1 } {
  // `derivedFrom` names a record this one was promoted from — a lineage
  // only the promotion path can prove. Refuse it outright rather than
  // strip it silently: a caller supplying it is asserting provenance the
  // store cannot verify, and dropping the field would record that lie as
  // an original measurement.
  if (input.derivedFrom !== undefined && input.derivedFrom !== null) {
    throw new StoreError(
      "invalid-argument",
      "derivedFrom is promotion provenance written only by promoteToCommit — original measurements carry null",
      { derivedFrom: input.derivedFrom },
    );
  }
  return putRecord(cwd, input, null, options);
}

function getById(cwd: string, evidenceId: string, options: StoreOptions = {}): EvidenceRecordV1 | null {
  const resolved = resolveStateRoot(cwd, options);
  const recordsDir = containedDir(resolved, recordsDirFor(resolved), "records dir");
  if (!isValidId(evidenceId)) {
    throw new StoreError("invalid-argument", `invalid evidence id ${JSON.stringify(evidenceId)}`);
  }
  const file = path.join(recordsDir, `${evidenceId}.json`);
  if (!fs.existsSync(file)) return null;
  return readRecordFile(file);
}

function requireById(cwd: string, evidenceId: string, options: StoreOptions = {}): EvidenceRecordV1 {
  const record = getById(cwd, evidenceId, options);
  if (record === null) {
    throw new StoreError("evidence-not-found", `evidence ${evidenceId} does not exist under the evidence store`, { evidenceId });
  }
  return record;
}

type EvidenceQuery = {
  check?: string;
  claim?: string;
  outcome?: EvidenceOutcome;
  retention?: EvidenceRetention;
  subjectKind?: "commit" | "workspace";
  runId?: string;
};

// Records are filtered from a fresh scan of the records dir — the same
// derived-data path the aggregate index uses, so a query answer is always
// reproducible from the canonical records.
function query(cwd: string, filter: EvidenceQuery = {}, options: StoreOptions = {}): EvidenceRecordV1[] {
  const resolved = resolveStateRoot(cwd, options);
  const records = scanRecords(resolved);
  return records
    .filter((record) => {
      if (filter.check !== undefined && record.check.ref !== filter.check) return false;
      if (filter.claim !== undefined && record.claim.ref !== filter.claim) return false;
      if (filter.outcome !== undefined && record.outcome !== filter.outcome) return false;
      if (filter.retention !== undefined && record.retention !== filter.retention) return false;
      if (filter.subjectKind !== undefined && record.subject.kind !== filter.subjectKind) return false;
      if (filter.runId !== undefined && record.runId !== filter.runId) return false;
      return true;
    })
    .sort((a, b) => a.createdAt === b.createdAt
      ? a.evidenceId.localeCompare(b.evidenceId)
      : a.createdAt.localeCompare(b.createdAt));
}

// ---------------------------------------------------------------------------
// Derived index — regenerated from records, never written on append
// ---------------------------------------------------------------------------

function buildIndex(records: EvidenceRecordV1[]): EvidenceIndex {
  const ordered = [...records].sort((a, b) => a.createdAt === b.createdAt
    ? a.evidenceId.localeCompare(b.evidenceId)
    : a.createdAt.localeCompare(b.createdAt));
  const group = (select: (record: EvidenceRecordV1) => string | null): Record<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const record of ordered) {
      const key = select(record);
      if (key === null) continue;
      const bucket = map.get(key) ?? [];
      bucket.push(record.evidenceId);
      map.set(key, bucket);
    }
    return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
  };
  const byOutcome = Object.fromEntries([...EVIDENCE_OUTCOMES].map((outcome) => [outcome, 0])) as EvidenceIndex["counts"]["byOutcome"];
  const byRetention = Object.fromEntries([...EVIDENCE_RETENTIONS].map((retention) => [retention, 0])) as EvidenceIndex["counts"]["byRetention"];
  const bySubjectKind = { commit: 0, workspace: 0 };
  for (const record of ordered) {
    byOutcome[record.outcome] += 1;
    byRetention[record.retention] += 1;
    bySubjectKind[record.subject.kind] += 1;
  }
  return {
    schemaVersion: EVIDENCE_INDEX_SCHEMA_VERSION,
    generated: "evidence-index",
    // The newest record stamp — derived input, so the same records always
    // produce byte-identical index output.
    generatedAt: ordered.length === 0 ? null : ordered[ordered.length - 1].createdAt,
    recordCount: ordered.length,
    counts: { byOutcome, byRetention, bySubjectKind },
    checks: group((record) => record.check.ref),
    claims: group((record) => record.claim.ref),
    runs: group((record) => record.runId),
  };
}

// Rebuild `index.json` from the records dir — a derived artifact, safe to
// delete and regenerate at any time. The built projection is validated
// before it lands: a derived artifact that would fail the contract read
// is corrupt output, never a file to persist. Returns the index it wrote.
function rebuildIndex(cwd: string, options: StoreOptions = {}): EvidenceIndex {
  const resolved = resolveStateRoot(cwd, options);
  ensureStateRootBoundary(cwd, resolved);
  ensureManifest(resolved, options);
  const index = buildIndex(scanRecords(resolved));
  if (!validateIndex(index)) {
    throw new StoreError("corrupt-state", "rebuilt evidence index failed validation — refusing to persist a projection the contract would reject");
  }
  atomicWriteFile(path.join(evidenceRootFor(resolved), INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

// ---------------------------------------------------------------------------
// Workspace → commit promotion — only with verified content identity (#240)
// ---------------------------------------------------------------------------

// The ONLY way a workspace-measured outcome becomes commit evidence: the
// caller names the commit, the store resolves `<commit>^{tree}` through
// Git — an object that must provably exist — and digests it with the
// canonical subject algorithm. The computed digest must equal the
// workspace snapshotDigest the measuring adapter attested through the
// same algorithm: the two subjects then name identical content by Git's
// own tree identity. Anything else refuses; there is no guess path and
// no caller-asserted digest.
function promoteToCommit(
  cwd: string,
  evidenceId: string,
  input: { newEvidenceId?: string; commit: string },
  options: StoreOptions = {},
): { stored: boolean; duplicate: boolean; record: EvidenceRecordV1 } {
  const source = requireById(cwd, evidenceId, options);
  if (source.subject.kind !== "workspace") {
    throw new StoreError(
      "invalid-argument",
      `evidence ${evidenceId} is already subject ${source.subject.kind} — only workspace evidence promotes to a commit`,
    );
  }
  if (!/^[0-9a-f]{7,64}$/i.test(input.commit)) {
    throw new StoreError("invalid-argument", `commit ${JSON.stringify(input.commit)} is not a hex object id`);
  }
  const { commitOid, treeOid } = requireCommitTreeOid(cwd, input.commit);
  const treeDigest = subjectTreeDigest(treeOid);
  if (treeDigest !== source.subject.snapshotDigest) {
    throw new StoreError(
      "subject-mismatch",
      `cannot promote evidence ${evidenceId}: the commit's tree digest does not match the workspace snapshot digest — content identity is unproven`,
      { expected: source.subject.snapshotDigest, got: treeDigest },
    );
  }
  return putRecord(cwd, {
    evidenceId: input.newEvidenceId ?? generateArtifactId("EVID"),
    claim: source.claim,
    check: source.check,
    subject: { kind: "commit", commit: commitOid },
    method: source.method,
    provider: source.provider,
    runId: source.runId,
    environment: source.environment,
    outcome: source.outcome,
    retention: source.retention,
    artifacts: source.artifacts,
    createdAt: nowOf(options),
  }, evidenceId, options);
}

// ---------------------------------------------------------------------------
// Recovery — `*.tmp-*` orphans are crash evidence, never content
// ---------------------------------------------------------------------------

function recoverEvidence(
  cwd: string,
  options: StoreOptions = {},
): { removedTmpFiles: string[]; records: number; recovered: boolean } {
  const resolved = resolveStateRoot(cwd, options);
  ensureStateRootBoundary(cwd, resolved);
  const evidenceDir = containedDir(resolved, evidenceRootFor(resolved), "evidence root");
  const removed: string[] = [];
  const visit = (dir: string, rel = ""): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(abs, relPath);
      else if (entry.isFile() && isStoreTmpFile(entry.name)) {
        fs.rmSync(abs, { force: true });
        removed.push(relPath);
      }
    }
  };
  visit(evidenceDir);
  const records = scanRecords(resolved).length;
  return { removedTmpFiles: removed.sort(), records, recovered: true };
}

export {
  buildIndex,
  getById,
  loadManifest,
  promoteToCommit,
  putImmutable,
  query,
  rebuildIndex,
  recoverEvidence,
  requireById,
  resolveCommitSubject,
  treeDigestOf,
  workspaceDigestOf,
};

export type {
  EvidenceInput,
  EvidenceQuery,
  StoreOptions,
};
