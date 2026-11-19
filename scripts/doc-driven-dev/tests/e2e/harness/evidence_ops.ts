/**
 * Deterministic evidence/store helpers for the e2e harness — synchronous
 * building blocks used by mutators, ops, and the validator. Every write goes
 * through the real library boundaries (putImmutable, the store's own
 * revision/subject digests); the harness only adds a fixed clock and a
 * fixture-local sync pin for claim/check revisions (the CLI's `--resolve`
 * logic re-expressed without the async Knowledge Graph scan).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";
import {
  documentRevisionOf,
  putImmutable,
  resolveCommitSubject,
  workspaceDigestOf,
} from "../../../src/skills/lib/evidence_store";
import type {
  EvidenceInput,
  EvidenceRecordV1,
} from "../../../src/skills/lib/evidence_store";
import {
  checkDesignRevision,
  parseVerificationChecks,
} from "../../../src/skills/lib/verification_checks";
import { validateEvidenceRecord } from "../../../src/skills/lib/evidence_store/types";

/** One fixed stamp for every harness-driven store write — no wall clock. */
export const FIXED_NOW = "2026-08-24T00:00:00.000Z";

const CLAIM_REF = /^([A-Z][A-Z0-9-]*)::([A-Za-z0-9][A-Za-z0-9._-]*)$/;

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** Locate the durable doc whose front-matter `id` equals `docId`. */
function docPathById(repo: string, docId: string): string | null {
  const docsRoot = path.join(repo, "docs");
  if (!fs.existsSync(docsRoot)) return null;
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== ".doc-driven-dev") visit(abs);
      } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") {
        try {
          const data = matter(fs.readFileSync(abs, "utf8")).data;
          if (data.id === docId) found.push(path.relative(repo, abs).split(path.sep).join("/"));
        } catch { /* unreadable docs are not candidates */ }
      }
    }
  };
  visit(docsRoot);
  return found.length === 1 ? found[0] : null;
}

/**
 * The sync counterpart of evidence_store.ts `resolvePinnedRevisions`:
 * pin `claim.documentRevision` to the claim document's live content digest
 * and `check.designRevision` to the check's canonical design digest, both
 * computed through the same library functions the CLI uses. A ref that
 * does not resolve throws — evidence only records real claims/checks.
 */
function pinRevisions(repo: string, input: EvidenceInput): void {
  const claimRef = CLAIM_REF.exec(input.claim.ref);
  if (claimRef === null) {
    throw new Error(`claim ref ${JSON.stringify(input.claim.ref)} is not a DOC-ID::KEY reference`);
  }
  const claimPath = docPathById(repo, claimRef[1]);
  if (claimPath === null) {
    throw new Error(`claim document ${claimRef[1]} does not resolve in the fixture`);
  }
  input.claim.documentRevision = documentRevisionOf(fs.readFileSync(path.join(repo, claimPath), "utf8"));

  const checkRef = CLAIM_REF.exec(input.check.ref);
  if (checkRef === null) {
    throw new Error(`check ref ${JSON.stringify(input.check.ref)} is not a DOC-ID::CHK-NN reference`);
  }
  const checkPath = docPathById(repo, checkRef[1]);
  if (checkPath === null) {
    throw new Error(`check document ${checkRef[1]} does not resolve in the fixture`);
  }
  const parsed = parseVerificationChecks(
    matter(fs.readFileSync(path.join(repo, checkPath), "utf8")).data.checks,
  );
  const check = parsed.checks.find((entry) => entry.id === checkRef[2]);
  if (check === undefined) {
    throw new Error(`check ${input.check.ref} is not declared by ${checkPath}`);
  }
  if (check.target !== input.claim.ref.trim()) {
    throw new Error(`check ${input.check.ref} targets ${check.target}, not ${input.claim.ref}`);
  }
  input.check.designRevision = checkDesignRevision(check);
}

/**
 * Harness intake shape: the store's `EvidenceInput` plus a
 * `{kind:"workspace", tree:"<revspec>"}` subject spelling that snapshots the
 * tree oid of a git revision through the store's own digest algorithm.
 */
export type HarnessEvidenceInput = Omit<EvidenceInput, "subject"> & {
  subject:
    | { kind: "commit"; commit: string }
    | { kind: "workspace"; snapshotDigest: string }
    | { kind: "workspace"; tree: string };
};

/**
 * Write one immutable Evidence Record through the real store boundary.
 * `resolve` pins live claim/check revisions (a record measured NOW);
 * omit it to record deliberately stale pins. Subject spellings:
 * `{kind:"commit", commit:"HEAD"}`/`"HEAD~1"` resolve through git;
 * `{kind:"workspace", snapshotDigest:"…"}` records verbatim;
 * `{kind:"workspace", tree:"HEAD"}` snapshots the tree oid of a revspec.
 */
export function writeEvidenceRecord(
  repo: string,
  input: HarnessEvidenceInput,
  options: { resolve?: boolean } = {},
): EvidenceRecordV1 {
  const normalized = JSON.parse(JSON.stringify(input)) as HarnessEvidenceInput;
  if (options.resolve === true) pinRevisions(repo, normalized as EvidenceInput);
  if (normalized.subject.kind === "commit") {
    const resolved = resolveCommitSubject(repo, normalized.subject.commit);
    if (resolved === null) {
      throw new Error(`evidence subject ${normalized.subject.commit} does not resolve in the fixture repo`);
    }
    normalized.subject = { kind: "commit", commit: resolved.commitOid };
  } else if ("tree" in normalized.subject) {
    const spec = normalized.subject.tree;
    const treeOid = git(repo, ["rev-parse", "--verify", "--quiet", `${spec}^{tree}`]);
    const snapshotDigest = workspaceDigestOf(treeOid);
    if (snapshotDigest === null) throw new Error(`workspace tree ${spec} does not digest`);
    normalized.subject = { kind: "workspace", snapshotDigest };
  }
  return putImmutable(repo, normalized as EvidenceInput, { now: () => FIXED_NOW }).record;
}

/** Re-read every Evidence Record file under the store — validator-facing. */
export function readEvidenceRecords(repo: string): EvidenceRecordV1[] {
  const dir = path.join(repo, ".apm", "state", "doc-driven-dev", "evidence", "records");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      if (!validateEvidenceRecord(parsed)) {
        throw new Error(`evidence record ${name} failed schema validation`);
      }
      return parsed;
    });
}

/**
 * The single run id in the fixture's Execution Store — the `$run:only`
 * placeholder target. Fails when zero or several runs exist (a case that
 * cannot name its run exactly is not deterministic).
 */
export function onlyRunId(repo: string): string {
  const dir = path.join(repo, ".apm", "state", "doc-driven-dev", "runs");
  const ids = fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    : [];
  if (ids.length !== 1) {
    throw new Error(`$run:only requires exactly one Execution Store run, found ${ids.length}: ${ids.join(", ")}`);
  }
  return ids[0];
}
