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
  return parsed;
}

function loadManifest(cwd: string, options: StoreOptions = {}): EvidenceStoreManifest | null {
  const resolved = resolveStateRoot(cwd, options);
  const file = path.join(evidenceRootFor(resolved), MANIFEST_FILE);
  if (!fs.existsSync(file)) return null;
  const parsed = readJsonFile(file);
  if (!validateManifest(parsed)) {
    throw new StoreError("corrupt-state", `evidence manifest at ${file} failed validation`, { path: file });
  }
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
    throw error;
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
  derivedFrom?: string | null;
  createdAt?: string;
};

// Build a fully validated canonical record from intake fields — field
// normalization (refs trimmed, digests prefixed, URIs normalized) happens
// once here so the stored form is always canonical. Everything the next
// read would reject is refused NOW as invalid-argument, never corrupt.
function buildRecord(input: EvidenceInput, options: StoreOptions): EvidenceRecordV1 {
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
    environment: input.environment ?? null,
    outcome: input.outcome as EvidenceOutcome,
    retention,
    artifacts,
    derivedFrom: input.derivedFrom ?? null,
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

function putImmutable(
  cwd: string,
  input: EvidenceInput,
  options: StoreOptions = {},
): { stored: boolean; duplicate: boolean; record: EvidenceRecordV1 } {
  const resolved = resolveStateRoot(cwd, options);
  ensureStateRootBoundary(cwd, resolved);
  ensureManifest(resolved, options);
  const record = buildRecord(input, options);
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
// delete and regenerate at any time. Returns the index it wrote.
function rebuildIndex(cwd: string, options: StoreOptions = {}): EvidenceIndex {
  const resolved = resolveStateRoot(cwd, options);
  ensureStateRootBoundary(cwd, resolved);
  ensureManifest(resolved, options);
  const index = buildIndex(scanRecords(resolved));
  atomicWriteFile(path.join(evidenceRootFor(resolved), INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

// ---------------------------------------------------------------------------
// Workspace → commit promotion — only with content-identity proof (#240)
// ---------------------------------------------------------------------------

// The ONLY way a workspace-measured outcome becomes commit evidence: the
// caller supplies the commit plus the commit's tree digest, and it must
// equal the workspace snapshot digest — proof the two subjects have
// identical content. Anything else refuses; there is no guess path.
function promoteToCommit(
  cwd: string,
  evidenceId: string,
  input: { newEvidenceId?: string; commit: string; treeDigest: string },
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
  const treeDigest = normalizeRevisionDigest(input.treeDigest);
  if (treeDigest === null) {
    throw new StoreError("invalid-argument", `tree digest ${JSON.stringify(input.treeDigest)} is not a sha256 digest`);
  }
  if (treeDigest !== source.subject.snapshotDigest) {
    throw new StoreError(
      "subject-mismatch",
      `cannot promote evidence ${evidenceId}: the commit's tree digest does not match the workspace snapshot digest — content identity is unproven`,
      { expected: source.subject.snapshotDigest, got: treeDigest },
    );
  }
  return putImmutable(cwd, {
    evidenceId: input.newEvidenceId ?? generateArtifactId("EVID"),
    claim: source.claim,
    check: source.check,
    subject: { kind: "commit", commit: input.commit.toLowerCase() },
    method: source.method,
    provider: source.provider,
    runId: source.runId,
    environment: source.environment,
    outcome: source.outcome,
    retention: source.retention,
    artifacts: source.artifacts,
    derivedFrom: evidenceId,
    createdAt: nowOf(options),
  }, options);
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
};

export type {
  EvidenceInput,
  EvidenceQuery,
  StoreOptions,
};
